import { it, expect } from 'vitest';
import { visibleEvents } from '../event-actions.js';

it('separates personal expenses from shared events and hides another account’s cached personal data', () => {
  const cache = {
    shared: { type: 'shared', owner: 'other' },
    legacyShared: { owner: 'owner' },
    personal: { type: 'personal', owner: 'owner' },
    otherPersonal: { type: 'personal', owner: 'other' }
  };
  expect(visibleEvents(cache, 'owner', 'personal').map(([id]) => id)).toEqual(['personal']);
  expect(visibleEvents(cache, 'owner', 'active').map(([id]) => id)).toEqual(['shared', 'legacyShared']);
  expect(visibleEvents(cache, 'owner', 'archived').map(([id]) => id)).toEqual(['shared', 'legacyShared']);
  expect(visibleEvents(cache, undefined, 'personal')).toEqual([]);
});
