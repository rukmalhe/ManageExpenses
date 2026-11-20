import Dexie from './vendor/dexie.mjs';

export class OfflineStore {
  constructor(name = 'roam-offline-v1') {
    this.db = new Dexie(name);
    const schema = { events: '[uid+id], uid', changes: '[uid+eventId+expenseId], uid', accounts: 'uid' };
    this.db.version(1).stores(schema);
    // Keep deletions separate so older app versions cannot treat them as edits.
    this.db.version(2).stores({ ...schema, deletions: '[uid+eventId+expenseId], uid' });
  }
  async events(uid) {
    const rows = await this.db.events.where('uid').equals(uid).toArray();
    const result = Object.fromEntries(rows.map(row => [row.id, structuredClone(row.data)]));
    for (const change of await this.changes(uid)) {
      const event = result[change.eventId];
      if (!event || change.state === 'blocked') continue;
      event.expenses ||= {};
      if (change.kind === 'delete') delete event.expenses[change.expenseId];
      else event.expenses[change.expenseId] = { ...change.record, pending: true };
    }
    return result;
  }
  saveEvent(uid, id, data) { return this.db.events.put({ uid, id, data }); }
  async removeEvent(uid, id) {
    await this.db.transaction('rw', this.db.events, this.db.changes, this.db.deletions, async () => {
      await this.db.events.delete([uid, id]);
      for (const table of [this.db.changes, this.db.deletions]) await table.where('uid').equals(uid).filter(c => c.eventId === id).modify({ state: 'blocked', error: 'Event access is unavailable. Reconnect or sign in again before retrying.' });
    });
  }
  async changes(uid) {
    const [changes, deletions] = await Promise.all([this.db.changes.where('uid').equals(uid).toArray(), this.db.deletions.where('uid').equals(uid).toArray()]);
    const removed = new Set(deletions.map(c => `${c.eventId}/${c.expenseId}`));
    return [...changes.filter(c => !removed.has(`${c.eventId}/${c.expenseId}`)), ...deletions].sort((a,b) => a.queuedAt-b.queuedAt);
  }
  account(uid) { return this.db.accounts.get(uid); }
  async markSynced(uid) { await this.db.accounts.put({ uid, lastSynced: Date.now() }); }
  async queue(uid, eventId, expenseId, record, baseline = null) {
    await this.db.transaction('rw', this.db.events, this.db.changes, this.db.deletions, async () => {
      const event = await this.db.events.get([uid, eventId]);
      if (!event) throw new Error('Connect first to download this event before adding offline expenses.');
      const previous = await this.db.changes.get([uid, eventId, expenseId]);
      if (await this.db.deletions.get([uid, eventId, expenseId])) throw new Error('This expense is already queued for deletion.');
      if (previous && previous.state !== 'pending') throw new Error('Resolve this expense’s sync issue before editing it again.');
      await this.db.changes.put({ uid, eventId, expenseId, record: structuredClone(record),
        baseline: previous ? previous.baseline : baseline, kind: previous?.kind || (baseline ? 'edit' : 'create'),
        queuedAt: previous?.queuedAt || Date.now(), state: 'pending' });
    });
  }
  // Keep a tombstone even for a pending creation: it may already be uploading.
  async queueDelete(uid, eventId, expenseId, record) {
    const { pending, ...saved } = record;
    await this.db.transaction('rw', this.db.events, this.db.changes, this.db.deletions, async () => {
      if (!await this.db.events.get([uid, eventId])) throw new Error('This event is no longer available.');
      const key = [uid, eventId, expenseId];
      const previous = await this.db.deletions.get(key) || await this.db.changes.get(key);
      if (previous && previous.state !== 'pending') throw new Error('Resolve this expense’s sync issue before deleting it.');
      await this.db.deletions.put({ uid, eventId, expenseId, kind: 'delete', record: previous?.record || saved,
        baseline: previous ? previous.baseline : saved, queuedAt: previous?.queuedAt || Date.now(), state: 'pending' });
      await this.db.changes.delete(key);
    });
  }
  async patch(change, patch) { await (change.kind === 'delete' ? this.db.deletions : this.db.changes).update([change.uid, change.eventId, change.expenseId], patch); }
  async acknowledge(change, record) {
    await this.db.transaction('rw', this.db.events, this.db.changes, this.db.deletions, async () => {
      const event = await this.db.events.get([change.uid, change.eventId]);
      if (event) {
        event.data.expenses ||= {};
        if (record === null) delete event.data.expenses[change.expenseId];
        else event.data.expenses[change.expenseId] = record;
        await this.db.events.put(event);
      }
      // A create/edit may finish after Delete was clicked. Update the deletion's
      // baseline, keeping it hidden until its conditional delete is acknowledged.
      const key = [change.uid, change.eventId, change.expenseId];
      const deletion = await this.db.deletions.get(key);
      if (change.kind !== 'delete' && deletion) {
        await this.db.deletions.update(key, { baseline: record });
        await this.db.changes.delete(key);
        return;
      }
      const table = change.kind === 'delete' ? this.db.deletions : this.db.changes;
      const current = await table.get(key);
      if (current && JSON.stringify(current.record) === JSON.stringify(change.record)) {
        await table.delete(key);
        if (change.kind === 'delete') await this.db.changes.delete(key);
      } else if (current) {
        await table.update(key, { baseline: record, kind: change.kind === 'delete' ? 'delete' : 'edit' });
      }
    });
  }
  async resolve(change, keepLocal) {
    if (keepLocal) {
      if (!change.remote || change.kind !== 'edit') throw new Error('This expense cannot overwrite a deleted or unrelated server record.');
      await this.patch(change, { baseline: change.remote, record: { ...change.remote, amount: change.record.amount, date: change.record.date }, state: 'pending', error: null, remote: null });
    } else {
      await this.db.changes.delete([change.uid, change.eventId, change.expenseId]);
      if (change.kind === 'delete') await this.db.deletions.delete([change.uid, change.eventId, change.expenseId]);
      const event = await this.db.events.get([change.uid, change.eventId]);
      if (event) {
        const restored = change.state === 'conflict' ? change.remote : change.remote || change.baseline;
        if (restored) { event.data.expenses ||= {}; event.data.expenses[change.expenseId] = restored; }
        else if (event.data.expenses) delete event.data.expenses[change.expenseId];
        await this.db.events.put(event);
      }
    }
  }
}
