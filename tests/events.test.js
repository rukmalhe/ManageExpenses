import { FirebaseTransport } from '../sync-engine.js';
import { createMockUserToken } from '@firebase/util';
import { readFile } from 'node:fs/promises';
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import * as api from 'firebase/database';
import { createEvent, removeTraveler, addTraveler, editExpenseValues } from '../event-actions.js';

let env;
const details = { name: 'Trip', type: 'shared', currency: 'NZD', categories: ['Food'], ownerName: 'Organizer' };
beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-roam', database: { rules: await readFile('database.rules.json', 'utf8'), host: '127.0.0.1', port: 9000 } });
}, 30000);
beforeEach(async () => env.clearDatabase());
afterAll(async () => { await env?.cleanup(); });

describe('reported event regressions', () => {
  it.each(['shared', 'personal'])('creates a %s event and its discovery index without permission denied', async type => {
    const db = env.authenticatedContext('owner').database();
    const id = await createEvent(api, db, 'owner', { ...details, type });
    expect((await api.get(api.ref(db, `events/${id}`))).val()).toMatchObject({ name: 'Trip', owner: 'owner', type });
    expect((await api.get(api.ref(db, `userEvents/owner/${id}`))).val()).toBe(true);
  });

  it('removes a traveler with an empty transaction cache, transfers payments and revokes access', async () => {
    await env.withSecurityRulesDisabled(async context => {
      await api.set(api.ref(context.database()), {
        events: { trip: { name: 'Trip', type: 'shared', owner: 'owner', currency: 'NZD', categories: ['Food'], createdAt: 1,
          members: { owner: { name: 'Organizer' }, traveler: { name: 'Traveler' }, other: { name: 'Other' } },
          expenses: { meal: { description: 'Meal', amount: 900, category: 'Food', date: '2026-11-16', paidBy: 'traveler', createdAt: 1 },
            coffee: { description: 'Coffee', amount: 300, category: 'Food', date: '2026-11-16', paidBy: 'other', createdAt: 1 } } } },
        userEvents: { owner: { trip: true }, traveler: { trip: true }, other: { trip: true } }
      });
    });
    const db = env.authenticatedContext('owner').database();
    await removeTraveler(api, db, 'trip', 'owner', 'traveler');
    const event = (await api.get(api.ref(db, 'events/trip'))).val();
    expect(Object.keys(event.members).sort()).toEqual(['other', 'owner']);
    expect(event.expenses.meal.paidBy).toBe('owner');
    expect(event.expenses.coffee.paidBy).toBe('other');
    expect(Object.values(event.expenses).reduce((sum,e) => sum + e.amount, 0) / Object.keys(event.members).length).toBe(600);
    const removedDb = env.authenticatedContext('traveler').database();
    expect((await api.get(api.ref(removedDb, 'userEvents/traveler/trip'))).exists()).toBe(false);
    await assertFails(api.get(api.ref(removedDb, 'events/trip')));
  });
});


describe('recurring schedule permissions', () => {
  it.each(['monthly', 'weekly', 'fortnightly'])('saves a %s schedule for a personal event', async frequency => {
    const db = env.authenticatedContext('owner').database();
    const id = await createEvent(api, db, 'owner', { ...details, type: 'personal' });
    const schedule = { description: 'Car payment', amount: 1200, category: 'Food', paidBy: 'owner', createdAt: api.serverTimestamp(), frequency,
      ...(frequency === 'monthly' ? { start: '2026-01', end: '2027-12', day: 31 } : { startDate: '2026-01-01', endDate: '2027-12-31' }) };
    await api.set(api.ref(db, `events/${id}/recurring/payment`), schedule);
    expect((await api.get(api.ref(db, `events/${id}/recurring/payment/frequency`))).val()).toBe(frequency);
    await assertFails(api.set(api.ref(db, `events/${id}/recurring/invalid`), { ...schedule, frequency: 'daily' }));
  });
});


describe('personal privacy and duplicate traveler regressions', () => {
  it('keeps each account’s personal event private and rejects travelers and shared indexes', async () => {
    const owner = env.authenticatedContext('owner').database();
    const other = env.authenticatedContext('other').database();
    const id = await createEvent(api, owner, 'owner', { ...details, type: 'personal' });
    const otherId = await createEvent(api, other, 'other', { ...details, type: 'personal' });
    await assertFails(api.get(api.ref(other, `events/${id}`)));
    await assertFails(api.get(api.ref(owner, `events/${otherId}`)));
    await expect(addTraveler(api, owner, id, 'owner', 'other', 'Other')).rejects.toThrow('Personal expenses are private');
    await assertFails(api.set(api.ref(owner, `events/${id}/members/other`), { name: 'Other' }));
    await assertFails(api.set(api.ref(owner, `userEvents/other/${id}`), true));
    expect((await api.get(api.ref(owner, `events/${id}/members`))).val()).toEqual({ owner: { name: 'Organizer' } });
  });

  it('denies personal data access even when old data contains a traveler and stale index', async () => {
    await env.withSecurityRulesDisabled(async context => {
      await api.set(api.ref(context.database(), 'events/legacy-personal'), {
        owner: 'owner', type: 'personal', name: 'Private', currency: 'NZD', categories: ['Food'], createdAt: 1,
        members: { owner: { name: 'Owner' }, other: { name: 'Other' } }
      });
      await api.set(api.ref(context.database(), 'userEvents/other/legacy-personal'), true);
    });
    const other = env.authenticatedContext('other').database();
    await assertFails(api.get(api.ref(other, 'events/legacy-personal')));
    await assertFails(api.set(api.ref(other, 'events/legacy-personal/expenses/meal'), {
      description: 'Meal', amount: 100, category: 'Food', paidBy: 'other', date: '2026-11-16', createdAt: api.serverTimestamp()
    }));
  });

  it('warns on a duplicate account ID and preserves the original traveler', async () => {
    const owner = env.authenticatedContext('owner').database();
    const id = await createEvent(api, owner, 'owner', details);
    await addTraveler(api, owner, id, 'owner', 'traveler', 'Original name');
    await expect(addTraveler(api, owner, id, 'owner', 'traveler', 'Changed name')).rejects.toThrow('already a traveler');
    await expect(addTraveler(api, owner, id, 'owner', 'owner', 'Duplicate organizer')).rejects.toThrow('already a traveler');
    expect((await api.get(api.ref(owner, `events/${id}/members`))).val()).toEqual({ owner: { name: 'Organizer' }, traveler: { name: 'Original name' } });
    const traveler = env.authenticatedContext('traveler').database();
    expect((await api.get(api.ref(traveler, `userEvents/traveler/${id}`))).val()).toBe(true);
  });
});


describe('editing saved expenses', () => {
  async function setup(type = 'shared') {
    const db = env.authenticatedContext('owner').database();
    const id = await createEvent(api, db, 'owner', { ...details, type });
    if (type === 'shared') await addTraveler(api, db, id, 'owner', 'traveler', 'Traveler');
    const payer = type === 'shared' ? env.authenticatedContext('traveler').database() : db;
    await api.set(api.ref(payer, `events/${id}/expenses/meal`), {
      description: 'Meal', category: 'Food', amount: 100, date: '2026-11-16', paidBy: type === 'shared' ? 'traveler' : 'owner', createdAt: 1
    });
    return { db, id, payer };
  }
  it.each(['shared', 'personal'])('updates amount and date in place for %s expenses', async type => {
    const { db, id, payer } = await setup(type);
    await editExpenseValues(api, payer, id, 'expenses', 'meal', 29107, '2026-12-02');
    const record = (await api.get(api.ref(db, `events/${id}/expenses/meal`))).val();
    expect(record).toEqual({ description: 'Meal', category: 'Food', amount: 29107, date: '2026-12-02', paidBy: type === 'shared' ? 'traveler' : 'owner', createdAt: 1 });
    expect(Object.keys((await api.get(api.ref(db, `events/${id}/expenses`))).val())).toEqual(['meal']);
  });
  it('lets the organizer edit another traveler’s amount without changing attribution', async () => {
    const { db, id } = await setup();
    await editExpenseValues(api, db, id, 'expenses', 'meal', 550, '2026-11-17');
    expect((await api.get(api.ref(db, `events/${id}/expenses/meal/paidBy`))).val()).toBe('traveler');
  });
  it('rejects edits to someone else’s expense by an ordinary member', async () => {
    const { db, id } = await setup();
    await addTraveler(api, db, id, 'owner', 'other', 'Other');
    const other = env.authenticatedContext('other').database();
    await assertFails(editExpenseValues(api, other, id, 'expenses', 'meal', 500, '2026-11-18'));
  });
  it('rejects invalid amounts and dates and does not recreate deleted records', async () => {
    const { db, id } = await setup('personal');
    await expect(editExpenseValues(api, db, id, 'expenses', 'meal', 0, '2026-11-18')).rejects.toThrow('amount');
    await expect(editExpenseValues(api, db, id, 'expenses', 'meal', 100, '2026-02-30')).rejects.toThrow('date');
    await api.remove(api.ref(db, `events/${id}/expenses/meal`));
    await expect(editExpenseValues(api, db, id, 'expenses', 'meal', 100, '2026-11-18')).rejects.toThrow('no longer available');
    expect((await api.get(api.ref(db, `events/${id}/expenses/meal`))).exists()).toBe(false);
  });
  it.each(['monthly', 'weekly', 'fortnightly'])('allows creating and deleting %s schedules but rejects edits', async frequency => {
    const { db, id } = await setup('personal');
    const record = { description: 'Loan', category: 'Food', amount: 100, frequency, paidBy: 'owner', createdAt: 1,
      ...(frequency === 'monthly' ? { start: '2026-01', end: '2027-12', day: 31 } : { startDate: '2026-01-01', endDate: '2027-12-31' }) };
    const schedule = api.ref(db, `events/${id}/recurring/loan`);
    await api.set(schedule, record);
    await expect(editExpenseValues(api, db, id, 'recurring', 'loan', 200, '2026-02-15')).rejects.toThrow('Recurring payments cannot be edited');
    await assertFails(api.update(schedule, { amount: 200 }));
    await assertFails(api.update(schedule, frequency === 'monthly' ? { day: 15 } : { startDate: '2026-02-15' }));
    await assertFails(api.update(api.ref(db, `events/${id}`), { 'recurring/loan/amount': 200 }));
    await assertFails(api.update(schedule, { frequency: null }));
    expect((await api.get(schedule)).val()).toEqual(record);
    await api.remove(schedule);
    expect((await api.get(schedule)).exists()).toBe(false);
    await api.set(schedule, { ...record, amount: 200 });
    expect((await api.get(schedule)).val().amount).toBe(200);
  });
});


describe('offline queue writes against real Firebase rules', () => {
  const transportFor = uid => new FirebaseTransport({ databaseURL: 'http://127.0.0.1:9000?ns=demo-roam', getToken: async () => createMockUserToken({ sub: uid }, 'demo-roam') });
  it('uses stable conditional creates and edits without duplicate writes', async () => {
    const db = env.authenticatedContext('owner').database();
    const eventId = await createEvent(api, db, 'owner', details);
    const transport = transportFor('owner');
    const record = { description: 'Offline meal', category: 'Food', amount: 8140, date: '2026-11-20', paidBy: 'owner', createdAt: 1 };
    const change = { uid: 'owner', eventId, expenseId: 'stable-offline-id', kind: 'create', record };
    const saved = await transport.upload(change);
    expect(saved.createdAt).toBeGreaterThan(1);
    expect(await transport.upload(change)).toEqual(saved);
    const edited = await transport.upload({ ...change, kind: 'edit', baseline: saved, record: { ...saved, amount: 29107, date: '2026-11-21' } });
    expect(edited).toEqual({ ...saved, amount: 29107, date: '2026-11-21' });
    expect(Object.keys((await api.get(api.ref(db, `events/${eventId}/expenses`))).val())).toEqual(['stable-offline-id']);
  });
  it('blocks queued uploads when membership has been revoked', async () => {
    const db = env.authenticatedContext('owner').database();
    const eventId = await createEvent(api, db, 'owner', details);
    await expect(transportFor('outsider').upload({ uid:'outsider', eventId, expenseId:'blocked', kind:'create', record:{ description:'Meal', category:'Food', amount:100, date:'2026-11-20', paidBy:'outsider', createdAt:1 } })).rejects.toMatchObject({ kind:'blocked' });
    expect((await api.get(api.ref(db, `events/${eventId}/expenses/blocked`))).exists()).toBe(false);
  });
});
