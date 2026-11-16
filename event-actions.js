// Shared by the browser and the Firebase emulator regression tests.
export async function createEvent(api, db, uid, details) {
  const { ownerName, ...eventDetails } = details;
  const eventRef = api.push(api.ref(db, 'events'));
  await api.set(eventRef, { ...eventDetails, owner: uid, createdAt: api.serverTimestamp(), members: { [uid]: { name: ownerName } } });
  await api.set(api.ref(db, `userEvents/${uid}/${eventRef.key}`), true);
  return eventRef.key;
}

export async function removeTraveler(api, db, eventId, ownerId, travelerId) {
  const result = await api.runTransaction(api.ref(db, `events/${eventId}`), current => {
    // Firebase may call the updater with an empty local cache before reading the server.
    if (current === null) return current;
    if (current.owner !== ownerId || travelerId === current.owner) return;
    delete current.members[travelerId];
    Object.values(current.expenses || {}).forEach(expense => {
      if (expense.paidBy === travelerId) expense.paidBy = current.owner;
    });
    return current;
  }, { applyLocally: false });
  if (!result.committed) throw new Error('Traveler removal was not saved. Please reload and try again.');
  await api.remove(api.ref(db, `userEvents/${travelerId}/${eventId}`));
}

export async function addTraveler(api, db, eventId, ownerId, travelerId, name) {
  let reason;
  const result = await api.runTransaction(api.ref(db, `events/${eventId}`), current => {
    if (current === null) return current;
    if (current.owner !== ownerId) { reason = 'Only the organizer can add travelers.'; return; }
    if (current.type === 'personal') { reason = 'Personal expenses are private. Travelers cannot be added.'; return; }
    if (current.members?.[travelerId]) { reason = 'This account ID is already a traveler in this event.'; return; }
    current.members[travelerId] = { name };
    return current;
  }, { applyLocally: false });
  if (!result.committed) throw new Error(reason || 'Traveler was not added. Please reload and try again.');
  await api.set(api.ref(db, `userEvents/${travelerId}/${eventId}`), true);
}

export function visibleEvents(cache, uid, tab) {
  return Object.entries(cache).filter(([, event]) => {
    if (event.type === 'personal') return event.owner === uid && tab === 'personal';
    return tab !== 'personal';
  });
}
