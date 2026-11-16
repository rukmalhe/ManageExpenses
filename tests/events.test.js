import { readFile } from 'node:fs/promises';
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import * as api from 'firebase/database';
import { createEvent, removeTraveler, addTraveler } from '../event-actions.js';

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
