import Dexie from './vendor/dexie.mjs';

export class OfflineStore {
  constructor(name = 'roam-offline-v1') {
    this.db = new Dexie(name);
    this.db.version(1).stores({ events: '[uid+id], uid', changes: '[uid+eventId+expenseId], uid', accounts: 'uid' });
  }
  async events(uid) {
    const rows = await this.db.events.where('uid').equals(uid).toArray();
    const result = Object.fromEntries(rows.map(row => [row.id, structuredClone(row.data)]));
    for (const change of await this.changes(uid)) {
      const event = result[change.eventId];
      if (!event || change.state === 'blocked') continue;
      event.expenses ||= {};
      event.expenses[change.expenseId] = { ...change.record, pending: true };
    }
    return result;
  }
  saveEvent(uid, id, data) { return this.db.events.put({ uid, id, data }); }
  async removeEvent(uid, id) {
    await this.db.transaction('rw', this.db.events, this.db.changes, async () => {
      await this.db.events.delete([uid, id]);
      await this.db.changes.where('uid').equals(uid).filter(c => c.eventId === id).modify({ state: 'blocked', error: 'Event access is unavailable. Reconnect or sign in again before retrying.' });
    });
  }
  changes(uid) { return this.db.changes.where('uid').equals(uid).sortBy('queuedAt'); }
  account(uid) { return this.db.accounts.get(uid); }
  async markSynced(uid) { await this.db.accounts.put({ uid, lastSynced: Date.now() }); }
  async queue(uid, eventId, expenseId, record, baseline = null) {
    await this.db.transaction('rw', this.db.events, this.db.changes, async () => {
      const event = await this.db.events.get([uid, eventId]);
      if (!event) throw new Error('Connect first to download this event before adding offline expenses.');
      const previous = await this.db.changes.get([uid, eventId, expenseId]);
      if (previous && previous.state !== 'pending') throw new Error('Resolve this expense’s sync issue before editing it again.');
      await this.db.changes.put({ uid, eventId, expenseId, record: structuredClone(record),
        baseline: previous ? previous.baseline : baseline, kind: previous?.kind || (baseline ? 'edit' : 'create'),
        queuedAt: previous?.queuedAt || Date.now(), state: 'pending' });
    });
  }
  async patch(change, patch) { await this.db.changes.update([change.uid, change.eventId, change.expenseId], patch); }
  async acknowledge(change, record) {
    await this.db.transaction('rw', this.db.events, this.db.changes, async () => {
      const event = await this.db.events.get([change.uid, change.eventId]);
      if (event) {
        event.data.expenses ||= {};
        event.data.expenses[change.expenseId] = record;
        await this.db.events.put(event);
      }
      // Do not drop an edit made while the request was in flight.
      const current = await this.db.changes.get([change.uid, change.eventId, change.expenseId]);
      if (current && JSON.stringify(current.record) === JSON.stringify(change.record)) {
        await this.db.changes.delete([change.uid, change.eventId, change.expenseId]);
      } else if (current) {
        await this.db.changes.update([change.uid, change.eventId, change.expenseId], { baseline: record, kind: 'edit' });
      }
    });
  }
  async resolve(change, keepLocal) {
    if (keepLocal) {
      if (!change.remote || change.kind !== 'edit') throw new Error('This expense cannot overwrite a deleted or unrelated server record.');
      await this.patch(change, { baseline: change.remote, record: { ...change.remote, amount: change.record.amount, date: change.record.date }, state: 'pending', error: null, remote: null });
    } else {
      await this.db.changes.delete([change.uid, change.eventId, change.expenseId]);
      const event = await this.db.events.get([change.uid, change.eventId]);
      if (event) {
        if (change.remote) { event.data.expenses ||= {}; event.data.expenses[change.expenseId] = change.remote; }
        else if (event.data.expenses) delete event.data.expenses[change.expenseId];
        await this.db.events.put(event);
      }
    }
  }
}
