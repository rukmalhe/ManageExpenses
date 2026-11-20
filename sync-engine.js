// Conditional REST writes use server ETags to avoid silently replacing another
// device's changes. All requests still pass through Firebase Security Rules.
export class SyncError extends Error {
  constructor(message, kind, remote = null) { super(message); this.kind = kind; this.remote = remote; }
}
const same = (a, b) => JSON.stringify(Object.entries(a || {}).sort()) === JSON.stringify(Object.entries(b || {}).sort());
const expenseFields = record => Object.fromEntries(Object.entries(record || {}).filter(([key]) => !['createdAt', 'pending'].includes(key)));
export class FirebaseTransport {
  constructor({ databaseURL, getToken, fetcher = fetch }) { this.base = new URL(databaseURL); this.getToken = getToken; this.fetcher = (...args) => fetcher(...args); }
  async request(path, options = {}, uid) {
    const token = await this.getToken(uid);
    if (!token) throw new SyncError('Sign in again to synchronize your saved changes.', 'blocked');
    const url = new URL(this.base);
    url.pathname = `${url.pathname.replace(/\/$/, '')}/${path}.json`; url.searchParams.set('auth', token);
    const response = await this.fetcher(url.toString(), { ...options, cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (response.status === 401 || response.status === 403) throw new SyncError('Permission denied. Sign in again or ask the organizer to restore access.', 'blocked');
    if (response.status === 412) throw new SyncError('This expense changed on another device. Review both versions.', 'retry');
    if (!response.ok) throw new SyncError('Could not synchronize. Your changes remain saved on this device.', 'retry');
    return response;
  }
  async eventIds(uid) { return (await (await this.request(`userEvents/${uid}`, {}, uid)).json()) || {}; }
  async event(id, uid) { return (await (await this.request(`events/${id}`, {}, uid)).json()); }
  async remove({ uid, eventId, collection, key, baseline, record }) {
    if (!['expenses', 'recurring'].includes(collection)) throw new Error('Invalid record type.');
    const path = `events/${eventId}/${collection}/${key}`;
    const response = await this.request(path, { headers: { 'X-Firebase-ETag': 'true' } }, uid);
    const remote = await response.json();
    if (remote === null) return null; // Already deleted, including a retry after a lost response.
    const matchesPending = collection === 'expenses' && record && same(expenseFields(remote), expenseFields(record)) && (!baseline || remote.createdAt === baseline.createdAt);
    if (!same(remote, baseline) && !matchesPending) throw new SyncError('This expense changed on another device. Keep the server version, review it, and delete again if needed.', 'conflict', remote);
    const etag = response.headers.get('ETag');
    if (!etag) throw new SyncError('Could not confirm the saved version before deleting. Try syncing again.', 'retry');
    await this.request(path, { method: 'DELETE', headers: { 'If-Match': etag } }, uid);
    return null;
  }
  async upload(change) {
    if (change.kind === 'delete') return this.remove({ ...change, collection: 'expenses', key: change.expenseId });
    const path = `events/${change.eventId}/expenses/${change.expenseId}`;
    // Retry a conditional write if the server changed after the GET.
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await this.request(path, { headers: { 'X-Firebase-ETag': 'true' } }, change.uid);
      const remote = await response.json();
      const desired = expenseFields(change.record);
      if (remote && same(expenseFields(remote), desired) && (change.kind === 'create' || remote.createdAt === change.baseline?.createdAt)) return remote;
      if (change.kind === 'create' ? remote !== null : !remote || !same(remote, change.baseline)) {
        throw new SyncError('This expense was changed or deleted on another device.', 'conflict', remote);
      }
      const payload = change.kind === 'create' ? { ...desired, createdAt: { '.sv': 'timestamp' } } : { ...remote, amount: change.record.amount, date: change.record.date };
      const etag = response.headers.get('ETag');
      if (!etag) throw new SyncError('The server did not return a version for this expense. Try again.', 'retry');
      try {
        const saved = await this.request(path, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': etag }, body: JSON.stringify(payload) }, change.uid);
        return await saved.json();
      } catch (error) { if (error.kind !== 'retry' || attempt === 2) throw error; }
    }
  }
}
export class SyncEngine {
  constructor({ store, transport, getUid, isOnline, onChange = () => {} }) { Object.assign(this, { store, transport, getUid, isOnline, onChange }); }
  async run() {
    const uid = this.getUid();
    if (this.running) {
      if (this.activeUid !== uid && uid) return this.running.then(() => this.run());
      this.again = true;
      return this.running;
    }
    if (!uid || !this.isOnline()) return;
    this.activeUid = uid;
    const work = () => this.drain(uid);
    this.running = (globalThis.navigator?.locks ? navigator.locks.request(`roam-sync-${uid}`, work) : work()).finally(() => {
      this.running = null;
      if (this.again) { this.again = false; queueMicrotask(() => this.run()); }
    });
    return this.running;
  }
  async drain(uid) {
    this.onChange('syncing');
    try {
      for (const change of await this.store.changes(uid)) {
        if (uid !== this.getUid() || !this.isOnline()) break;
        if (change.state === 'conflict') continue;
        try { await this.store.acknowledge(change, await this.transport.upload(change)); }
        catch (error) {
          if (error.kind === 'blocked') await this.store.removeEvent(uid, change.eventId);
          await this.store.patch(change, { state: error.kind === 'conflict' ? 'conflict' : error.kind === 'blocked' ? 'blocked' : 'pending', error: error.message, remote: error.remote || null });
          if (!error.kind || error.kind === 'retry') throw error;
        }
      }
      if (uid !== this.getUid() || !this.isOnline()) return;
      const ids = await this.transport.eventIds(uid);
      if (uid !== this.getUid() || !this.isOnline()) return;
      const cached = await this.store.db.events.where('uid').equals(uid).toArray();
      for (const row of cached) if (!ids[row.id]) await this.store.removeEvent(uid, row.id);
      for (const id of Object.keys(ids)) {
        if (uid !== this.getUid()) return;
        try {
          const event = await this.transport.event(id, uid);
          if (event) await this.store.saveEvent(uid, id, event); else await this.store.removeEvent(uid, id);
        } catch (error) { if (error.kind === 'blocked') await this.store.removeEvent(uid, id); else throw error; }
      }
      const remaining = await this.store.changes(uid);
      if (uid !== this.getUid()) return;
      if (!remaining.length) await this.store.markSynced(uid);
      this.onChange(remaining.length ? 'attention' : 'synced');
    } catch (error) { this.onChange('failed', error.message); }
    finally { this.onChange('refresh'); }
  }
}
