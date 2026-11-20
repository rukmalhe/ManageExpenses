import 'fake-indexeddb/auto';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { OfflineStore } from '../offline-store.js';
import { FirebaseTransport, SyncEngine, SyncError } from '../sync-engine.js';

const databases = [];
const expense = { description: 'Dinner', amount: 100, category: 'Food', date: '2026-11-20', paidBy: 'owner', createdAt: 1 };
async function setup() {
  const store = new OfflineStore(`test-${crypto.randomUUID()}`); databases.push(store);
  await store.saveEvent('owner', 'trip', { name: 'Trip', owner: 'owner', members: { owner: { name: 'Owner' } }, expenses: { meal: expense } });
  return store;
}
afterEach(async () => { for (const store of databases.splice(0)) { store.db.close(); await store.db.delete(); } });
function server(initial = null) {
  let record = initial, version = 1, writes = 0, loseResponse = false;
  const fetcher = vi.fn(async (_url, options) => {
    if (options.method !== 'PUT') return new Response(JSON.stringify(record), { headers: { ETag: `"${version}"` } });
    if (options.headers['If-Match'] !== `"${version}"`) return new Response('{}', { status: 412 });
    record = JSON.parse(options.body); if (typeof record.createdAt === 'object') record.createdAt = 12345;
    version++; writes++;
    if (loseResponse) { loseResponse = false; throw new TypeError('Network response lost'); }
    return new Response(JSON.stringify(record));
  });
  return { fetcher, get record() { return record; }, get writes() { return writes; }, loseNextResponse() { loseResponse = true; }, replace(value) { record = value; version++; } };
}
const transportFor = mock => new FirebaseTransport({ databaseURL: 'https://example.firebaseio.com', getToken: async () => 'test-token', fetcher: mock.fetcher });

describe('persistent offline storage', () => {
  it('restores cached events and queued changes after closing and reopening the database', async () => {
    const store = await setup();
    await store.queue('owner', 'trip', 'new', expense);
    const name = store.db.name; store.db.close();
    const reopened = new OfflineStore(name); databases.push(reopened);
    expect((await reopened.events('owner')).trip.expenses.new).toMatchObject({ ...expense, pending: true });
    expect((await reopened.changes('owner'))).toHaveLength(1);
  });
  it('keeps caches, pending changes, and sync timestamps separate by account', async () => {
    const store = await setup(); await store.queue('owner', 'trip', 'new', expense); await store.markSynced('owner');
    expect(await store.events('other')).toEqual({}); expect(await store.changes('other')).toEqual([]); expect(await store.account('other')).toBeUndefined();
    await expect(store.queue('other', 'trip', 'new', expense)).rejects.toThrow('Connect first');
  });
  it('merges edits to a pending creation without assigning another ID', async () => {
    const store = await setup(); await store.queue('owner', 'trip', 'new', expense);
    await store.queue('owner', 'trip', 'new', { ...expense, amount: 200 }, expense);
    const changes = await store.changes('owner'); expect(changes).toHaveLength(1); expect(changes[0]).toMatchObject({ expenseId: 'new', kind: 'create', baseline: null, record: { amount: 200 } });
  });
  it('keeps an edit queued when an earlier upload finishes after the user changes it again', async () => {
    const store = await setup(); await store.queue('owner', 'trip', 'new', expense);
    const original = (await store.changes('owner'))[0];
    await store.queue('owner', 'trip', 'new', { ...expense, amount: 300 });
    await store.acknowledge(original, { ...expense, createdAt: 12345 });
    expect((await store.changes('owner'))[0]).toMatchObject({ kind: 'edit', baseline: { createdAt: 12345 }, record: { amount: 300 } });
  });
  it('lets the user explicitly keep the server version or retry their amount/date against the new version', async () => {
    const store = await setup(); await store.queue('owner', 'trip', 'meal', { ...expense, amount: 300 }, expense);
    const change = (await store.changes('owner'))[0], remote = { ...expense, amount: 250 };
    await store.patch(change, { state: 'conflict', remote });
    await store.resolve({ ...change, remote }, true);
    expect((await store.changes('owner'))[0]).toMatchObject({ baseline: remote, record: { amount: 300 }, state: 'pending' });
    await store.resolve({ ...change, remote }, false);
    expect(await store.changes('owner')).toEqual([]); expect((await store.events('owner')).trip.expenses.meal.amount).toBe(250);
  });
});

describe('conditional upload and retry safety', () => {
  it('uploads a stable expense ID once even if the server saved it but the response was lost', async () => {
    const mock = server(); mock.loseNextResponse(); const transport = transportFor(mock);
    const change = { uid: 'owner', eventId: 'trip', expenseId: 'stable', kind: 'create', record: expense };
    await expect(transport.upload(change)).rejects.toThrow('lost');
    expect(await transport.upload(change)).toMatchObject({ ...expense, createdAt: 12345 });
    expect(mock.writes).toBe(1);
  });
  it('detects changed and deleted expenses instead of overwriting or recreating them', async () => {
    const change = { uid: 'owner', eventId: 'trip', expenseId: 'meal', kind: 'edit', baseline: expense, record: { ...expense, amount: 300 } };
    const mock = server({ ...expense, amount: 200 }), transport = transportFor(mock);
    await expect(transport.upload(change)).rejects.toMatchObject({ kind: 'conflict', remote: { amount: 200 } });
    mock.replace(null); await expect(transport.upload(change)).rejects.toMatchObject({ kind: 'conflict', remote: null }); expect(mock.writes).toBe(0);
  });
  it('rechecks the version if another device writes between the GET and PUT', async () => {
    const mock = server(expense); let raced = false;
    const fetcher = async (url, options) => { if (options.method === 'PUT' && !raced) { raced = true; mock.replace({ ...expense, amount: 500 }); } return mock.fetcher(url, options); };
    const transport = new FirebaseTransport({ databaseURL: 'https://example.firebaseio.com', getToken: async () => 'token', fetcher });
    await expect(transport.upload({ uid: 'owner', eventId: 'trip', expenseId: 'meal', kind: 'edit', baseline: expense, record: { ...expense, amount: 300 } })).rejects.toMatchObject({ kind: 'conflict' }); expect(mock.record.amount).toBe(500);
  });
  it('rejects expired sessions and passes the expected account to the token provider', async () => {
    const getToken = vi.fn(async () => null), fetcher = vi.fn();
    const transport = new FirebaseTransport({ databaseURL: 'https://example.firebaseio.com', getToken, fetcher });
    await expect(transport.eventIds('owner')).rejects.toMatchObject({ kind: 'blocked' }); expect(getToken).toHaveBeenCalledWith('owner'); expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('synchronization states', () => {
  it('retains changes offline and after network failures', async () => {
    const store = await setup(); await store.queue('owner', 'trip', 'new', expense); let online = false;
    const upload = vi.fn(async () => { throw new TypeError('Disconnected'); }), onChange = vi.fn();
    const engine = new SyncEngine({ store, transport: { upload }, getUid: () => 'owner', isOnline: () => online, onChange });
    await engine.run(); expect(upload).not.toHaveBeenCalled(); online = true; await engine.run();
    expect(await store.changes('owner')).toHaveLength(1); expect(onChange).toHaveBeenCalledWith('failed', 'Disconnected');
  });
  it('blocks inaccessible events without discarding their pending changes', async () => {
    const store = await setup(); await store.queue('owner', 'trip', 'new', expense);
    const engine = new SyncEngine({ store, transport: { upload: async () => { throw new SyncError('Access revoked', 'blocked'); }, eventIds: async () => ({}) }, getUid: () => 'owner', isOnline: () => true });
    await engine.run(); expect(await store.events('owner')).toEqual({}); expect((await store.changes('owner'))[0].state).toBe('blocked');
  });
  it('drains pending changes and records the last successful synchronization', async () => {
    const store = await setup(); await store.queue('owner', 'trip', 'new', expense);
    const engine = new SyncEngine({ store, transport: { upload: async () => expense, eventIds: async () => ({ trip: true }), event: async () => ({ expenses: { new: expense } }) }, getUid: () => 'owner', isOnline: () => true });
    await Promise.all([engine.run(), engine.run()]); expect(await store.changes('owner')).toEqual([]); expect((await store.account('owner')).lastSynced).toBeGreaterThan(0);
  });
});


it('starts synchronization for the new account after an in-flight session finishes', async () => {
  const store = await setup();
  let uid = 'owner', finish;
  const first = new Promise(resolve => { finish = resolve; });
  const eventIds = vi.fn(async current => { if (current === 'owner') await first; return {}; });
  const engine = new SyncEngine({ store, transport: { eventIds }, getUid: () => uid, isOnline: () => true });
  const oldRun = engine.run();
  uid = 'other'; const newRun = engine.run(); finish();
  await Promise.all([oldRun,newRun]);
  expect(eventIds).toHaveBeenCalledWith('other');
});
