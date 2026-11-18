import { readFile } from 'node:fs/promises';
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


it('labels the shared, personal, and archived tabs correctly in the page', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  expect(html).toMatch(/id="active-events"[^>]*>Shared<\/button>/);
  expect(html).toMatch(/id="personal-events"[^>]*>Personal<\/button>/);
  expect(html).toMatch(/id="archived-events"[^>]*>Archived<\/button>/);
});
