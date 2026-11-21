import { OfflineStore } from './offline-store.js';
import { FirebaseTransport, SyncEngine } from './sync-engine.js';
import { monthlyEntries, groupExpenses, parseExpenseAmount, expenditureThroughDate } from './expense-utils.js';
import { removeTraveler, addTraveler, visibleEvents } from './event-actions.js';
// Firebase web configuration. These identify the project; database rules control access.
import { firebaseConfig } from './firebase-config.js';

const $ = (selector) => document.querySelector(selector);
let toastTimer;
const status = (message = '', kind = 'success') => {
  clearTimeout(toastTimer);
  const toast = $('#status');
  toast.replaceChildren();
  if (!$('#auth-panel').hidden) $('#auth-status').textContent = message;
  if (!message) { if (toast.matches(':popover-open')) toast.hidePopover(); return; }
  toast.dataset.kind = kind;
  toast.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  toast.setAttribute('aria-live', kind === 'error' ? 'assertive' : 'polite');
  const text = document.createElement('span'); text.textContent = message;
  const close = document.createElement('button'); close.type = 'button'; close.className = 'quiet'; close.textContent = 'Dismiss'; close.onclick = () => status();
  toast.append(text, close);
  if (toast.showPopover) toast.showPopover();
  if (kind === 'error') { toast.tabIndex = -1; toast.focus({ preventScroll: true }); }
  else toastTimer = setTimeout(() => status(), 6500);
};
const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let user, db, auth, api, selectedId, eventData;
let editing = null;
let selectedTab = null, selectionGeneration = 0;
const offline = new OfflineStore();
let syncEngine, serverConnected = false, syncState = 'offline', syncError = '', sessionVersion = 0, viewVersion = 0;
let stopIndex = () => {}, stopEvent = () => {};
let eventListeners = [];
let eventTab = "active", eventCache = {}, personalMonth = localDate().slice(0,7);
function localDate() { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0,10); }
function isArchived(data) { const cutoff = new Date(data.createdAt); const day = cutoff.getDate(); cutoff.setDate(1); cutoff.setMonth(cutoff.getMonth()+3); const end = new Date(cutoff.getFullYear(), cutoff.getMonth()+1, 0).getDate(); cutoff.setDate(Math.min(day,end)); return data.type !== "personal" && Date.now() >= cutoff.getTime(); }
function renderEventList() {
  $("#event-list").replaceChildren();
  const events = visibleEvents(eventCache, user?.uid, eventTab).filter(([,d]) => eventTab === "personal" || isArchived(d) === (eventTab === "archived"));
  // A selection belongs to the visible tab, not to the last downloaded event.
  if (selectedId && (selectedTab !== eventTab || !events.some(([id]) => id === selectedId))) clearSelectedEvent(false);
  events.forEach(([id,d]) => {
    const b = document.createElement('button');
    b.dataset.id = id;
    b.setAttribute('aria-pressed', String(id === selectedId));
    const name = document.createElement('span'); name.className = 'event-name'; name.textContent = d.name;
    const total = document.createElement('strong'); total.className = 'event-total';
    total.textContent = new Intl.NumberFormat(undefined, { style: 'currency', currency: d.currency, currencyDisplay: 'code' }).format(expenditureThroughDate(d, localDate()) / 100);
    const label = document.createElement('small'); label.className = 'event-total-label'; label.textContent = 'Total through today';
    if (d.type === 'personal') label.title = 'Includes recurring payments due through today, not confirmed payments.';
    b.append(name, total, label);
    const tab = eventTab, generation = selectionGeneration;
    b.onclick = () => {
      if (tab === eventTab && generation === selectionGeneration) selectEvent(id);
    };
    $('#event-list').append(b);
  });
  if (!$("#event-list").children.length) $("#event-list").textContent = "No " + (eventTab === "active" ? "shared" : eventTab) + " events.";
}
function switchEventTab(tab) {
  eventTab = tab;
  clearSelectedEvent(false);
  for (const name of ['active', 'personal', 'archived']) {
    $('#'+name+'-events').setAttribute('aria-pressed', String(name === tab));
  }
  renderEventList();
}
for (const tab of ['active', 'personal', 'archived']) {
  $('#'+tab+'-events').onclick = () => switchEventTab(tab);
}
setInterval(() => { renderEventList(); }, 60000);
const money = (cents) => new Intl.NumberFormat(undefined, { style: 'currency', currency: eventData.currency }).format(cents / 100);
async function perform(form, action) {
  const buttons = [...form.querySelectorAll('button')];
  const disabled = buttons.map(button => button.disabled);
  buttons.forEach((b) => b.disabled = true);
  status();
  try { await action(); } catch (error) { status(error.message || 'Something went wrong. Please try again.', 'error'); }
  finally { buttons.forEach((b, index) => b.disabled = disabled[index]); }
}

async function initialize() {
  if (!firebaseConfig.apiKey || !firebaseConfig.databaseURL) {
    status('Setup needed: add your Firebase configuration in index.js, enable Email/Password Authentication, and deploy database.rules.json.');
    $('#auth-form').querySelectorAll('button').forEach((b) => b.disabled = true);
    return;
  }
  const base = 'https://www.gstatic.com/firebasejs/12.6.0/';
  const [appModule, authModule, databaseModule] = await Promise.all([
    import(`${base}firebase-app.js`), import(`${base}firebase-auth.js`), import(`${base}firebase-database.js`)
  ]);
  api = { ...authModule, ...databaseModule };
  const app = appModule.initializeApp(firebaseConfig);
  auth = api.getAuth(app); db = api.getDatabase(app);
  clearTimeout(window.authLoadingTimer);
  $('#google-signin').disabled = false;
  $('#google-signin').textContent = 'Sign in with Google';
  status();
  await api.setPersistence(auth, api.indexedDBLocalPersistence);
  syncEngine = new SyncEngine({ store: offline,
    transport: new FirebaseTransport({ databaseURL: firebaseConfig.databaseURL, getToken: async uid => {
      const account = auth.currentUser;
      if (account?.uid !== uid) return null;
      const token = await account.getIdToken();
      return auth.currentUser?.uid === uid ? token : null;
    } }),
    getUid: () => user?.uid,
    isOnline: () => navigator.onLine,
    onChange: (state, message) => {
      if (syncEngine?.activeUid !== user?.uid) return;
      if (state !== 'refresh') { syncState = state; syncError = message || ''; }
      refreshClient().catch(error => status(error.message, 'error'));
    }
  });
  api.onValue(api.ref(db, '.info/connected'), snapshot => {
    serverConnected = !!snapshot.val();
    renderSyncPanel().catch(error => status(error.message, 'error'));
    if (serverConnected && user) syncEngine.run();
  });
  api.onAuthStateChanged(auth, nextUser => loadSession(nextUser).catch(error => {
    syncState = 'failed'; syncError = error.message;
    $('#sync-state').textContent = 'Local storage unavailable';
    $('#sync-detail').textContent = 'Allow website storage and reload to finish offline setup.';
    status(`Local storage is unavailable: ${error.message}. Allow website storage and reload.`, 'error');
  }));

}

$('#google-signin').onclick = () => perform($('#auth-form'), async () => {
  if (!navigator.onLine) throw new Error('Connect to the internet to sign in.');
  if (!auth) throw new Error('Firebase is still loading. Please try again shortly.');
  const provider = new api.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  $('#google-signin').textContent = 'Opening Google…';
  status('Finish signing in in the Google popup. If it does not appear, check whether your browser blocked it.');
  try {
    await api.signInWithPopup(auth, provider);
    $('#password').value = '';
    status();
  } catch (error) {
    const messages = {
      'auth/operation-not-allowed': 'Enable Google under Firebase Authentication → Sign-in method.',
      'auth/unauthorized-domain': 'Add this website’s domain under Firebase Authentication → Settings → Authorized domains. For local testing, add localhost.',
      'auth/popup-blocked': 'Allow popups for this website, then try Google sign-in again.',
      'auth/popup-closed-by-user': 'Google sign-in was cancelled. You can try again.',
      'auth/account-exists-with-different-credential': 'This email already uses another sign-in method. Please sign in using that method.',
      'auth/network-request-failed': 'Could not connect to Google sign-in. Check your internet connection and try again.'
    };
    throw new Error(messages[error.code] || error.message);
  } finally {
    $('#google-signin').textContent = 'Sign in with Google';
  }
});

$('#auth-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const action = event.submitter.value;
  perform(event.currentTarget, async () => {
    if (!navigator.onLine) throw new Error('Connect to the internet to sign in.');
  if (!auth) throw new Error('Firebase is still loading. Please try again shortly.');
    const email = $('#email').value.trim(); const password = $('#password').value;
    if (action === 'register') await api.createUserWithEmailAndPassword(auth, email, password);
    else await api.signInWithEmailAndPassword(auth, email, password);
    $('#password').value = ''; status();
  });
});
$('#logout').onclick = () => perform($('#account'), async () => {
  const changes = await offline.changes(user.uid);
  if (changes.length && !confirm(`${changes.length} unsynced change(s) remain on this device. Sign out? They will sync only after you sign back into this same account.`)) return;
  await api.signOut(auth);
});
$('#copy-id').onclick = async () => {
  try { await navigator.clipboard.writeText(user.uid); status('Account ID copied.'); }
  catch { status('Select and copy the account ID displayed above.'); }
};
function updateEventTypeHelp() {
  $('#event-type-help').textContent = $('#event-form').elements.type.value === 'personal'
    ? 'Private to your account. No travelers can be added; other accounts can create their own personal events.'
    : 'Expenses are split equally among current members. Adding a member recalculates everyone’s share.';
}
$('#event-form').elements.type.onchange = updateEventTypeHelp;
$('#new-event').onclick = () => { updateEventTypeHelp(); $('#event-dialog').showModal(); };
$('[data-close]').onclick = () => $('#event-dialog').close();
let eventCreation;
$('#event-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  perform(form, async () => {
    if (!navigator.onLine) throw new Error('Connect to the internet to create an event.');
    const values = new FormData(form);
    const name = values.get('name').trim();
    const categories = [...new Set(values.get('categories').split(',').map((c) => c.trim()).filter(Boolean))];
    if (!name || !categories.length || categories.length > 20 || categories.some((c) => c.length > 40)) throw new Error('Enter a name and 1–20 categories of up to 40 characters.');
    const type = values.get('type');
    const uid = user.uid, version = sessionVersion;
    const details = { name, type, currency: values.get('currency'), categories, ownerName: user.email };
    const signature = JSON.stringify([uid, details]);
    if (eventCreation?.signature !== signature) {
      eventCreation = { signature, id: api.push(api.ref(db, 'events')).key };
    }
    const eventId = eventCreation.id;
    let saved;
    try {
      saved = await syncEngine.transport.createEvent(uid, eventId, details);
    } catch {
      throw new Error('Could not confirm event creation. Check your connection and retry.');
    }
    eventCreation = null;
    if (version !== sessionVersion) return;
    $('#event-dialog').close(); form.reset();
    syncEngine.run();
    await offline.saveEvent(uid, eventId, saved);
    if (version !== sessionVersion) return;
    eventCache[eventId] = saved;
    $('#'+(type === 'personal' ? 'personal' : 'active')+'-events').click(); selectEvent(eventId);
    status(type === 'personal' ? 'Personal event created. Only you can access these expenses.' : 'Event created. Add travelers using their account IDs.');
  });
});
function clearSelectedEvent(renderList = true) {
  stopEvent();
  selectedId = null; selectedTab = null; eventData = null; editing = null;
  selectionGeneration++;
  const detail = $('#event-detail');
  detail.replaceChildren(); detail.hidden = true;
  $('.workspace').classList.remove('has-event');
  $('.account-id').hidden = eventTab === 'personal';
  if (renderList) renderEventList();
}
function selectEvent(id) {
  editing = null; selectedId = id; selectedTab = eventTab; personalMonth = localDate().slice(0,7);
  eventData = eventCache[id];
  renderEventList();
  if (!selectedId || !eventData) { clearSelectedEvent(); return; }
  $('.account-id').hidden = eventData.type === 'personal';
  refreshSelectedEvent();
}

function renderEvent() {
  // Keep entered text intact when another member adds an expense.
  const draft = {};
  document.querySelectorAll('#event-detail input, #event-detail select').forEach((input) => { draft[input.name] = input.value; });
  const data = eventData;
  const members = Object.entries(data.members);
  const expenses = Object.entries(data.expenses || {}).sort((a,b) => b[1].createdAt - a[1].createdAt);
  const total = expenses.reduce((sum, [,expense]) => sum + expense.amount, 0);
  const ownTotal = expenses.filter(([,expense]) => expense.paidBy === user.uid).reduce((sum,[,expense]) => sum + expense.amount, 0);
  const owner = data.owner === user.uid;
  // Allocate remainder cents deterministically so balances add up to zero.
  const memberIds = members.map(([id]) => id).sort();
  const share = (id) => Math.floor(total / members.length) + (memberIds.indexOf(id) < total % members.length ? 1 : 0);
  $('#event-detail').innerHTML = `
    <div class="event-heading"><div><p class="eyebrow">SHARED ADVENTURE · ${escapeHTML(data.currency)}</p><h2>${escapeHTML(data.name)}</h2></div><span class="muted">${members.length} traveler${members.length === 1 ? '' : 's'}</span></div>
    <div class="stats"><div class="stat"><small>Total spent</small><strong>${money(total)}</strong></div><div class="stat"><small>Your share</small><strong>${money(share(user.uid))}</strong></div><div class="stat"><small>You paid</small><strong>${money(ownTotal)}</strong></div></div>
    <div class="forms"><form id="expense-form"><h3>Add your expense</h3><label>Description<input name="description" required maxlength="120" placeholder="Dinner by the beach"></label><label>Amount (${escapeHTML(data.currency)})<input name="amount" type="text" maxlength="300" required placeholder="24.69+56.71+209.67" aria-describedby="amount-total"></label><label>Category<select name="category">${data.categories.map((c) => `<option>${escapeHTML(c)}</option>`).join('')}</select></label><label>Date<input name="date" type="date" required></label><button>Add expense</button></form><div><h3>Travelers & balances</h3><p class="muted">Positive: should receive. Negative: owes. All expenses are shared equally.</p><div id="balances">${members.map(([id,member]) => {
      const paid = expenses.filter(([,e]) => e.paidBy === id).reduce((sum,[,e]) => sum + e.amount, 0);
      return `<div class="balance-row"><span>${escapeHTML(member.name)}${id === user.uid ? ' (you)' : ''}${owner ? `<small class="member-account-id">ID: ${escapeHTML(id)}</small>${id !== data.owner ? `<button type="button" class="quiet" data-remove-member="${escapeHTML(id)}">Remove</button>` : ''}` : ''}</span><strong>${money(paid - share(id))}</strong></div>`;
    }).join('')}</div>${owner ? '<form id="member-form"><h3>Add a traveler</h3><button id="repair-access" type="button" class="quiet">Refresh team access</button><label>Name<input name="memberName" required maxlength="80"></label><label>Account ID<input name="memberId" required maxlength="128" pattern="[A-Za-z0-9_-]+"></label><button class="secondary">Add member</button><p class="muted">Use the account ID displayed after the traveler signs in, not their email. Use Refresh team access to restore event listings for existing travelers.</p></form>' : ''}</div></div>
    <h3 class="table-title">Expense activity</h3><div id="expenses">${expenses.length ? groupedExpenseHTML(expenses, ([id,e]) => `<div class="expense-row"><div class="expense-description"><strong>${escapeHTML(e.description)}</strong><small>${e.pending ? '<span class="pending-label">Pending sync · </span>' : ''}${escapeHTML(e.category)} · ${escapeHTML(e.date)} · ${escapeHTML(data.members[e.paidBy]?.name || 'Traveler')}</small></div><div class="expense-controls"><strong class="expense-amount">${money(e.amount)}</strong><div class="expense-actions">${e.paidBy === user.uid || owner ? `<button type="button" class="quiet" data-edit-expense="${escapeHTML(id)}">Edit</button><button class="quiet" data-delete="${escapeHTML(id)}" aria-label="Delete ${escapeHTML(e.description)}">Delete</button>` : ''}</div></div></div>`) : '<p class="muted">No expenses yet. Start with the first coffee.</p>'}</div>`;
  const date = new Date(); date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  $('#expense-form [name=date]').value = date.toISOString().slice(0,10);
  Object.entries(draft).forEach(([name,value]) => { const input = document.querySelector(`#event-detail [name="${name}"]`); if(input) input.value = value; });
  configureExpenseEditor($('#expense-form'));
  attachAmountPreview($('#expense-form'));
  bindEditButtons();
  $('#expense-form').onsubmit = (event) => {
    event.preventDefault(); const form = event.currentTarget;
    const id = selectedId; const values = new FormData(form);
    const edit = editing;
    perform(form, async () => {
      if (edit) { await saveExpenseEdit(edit, values); return; }
      const amount = parseExpenseAmount(values.get('amount'));
      const description = values.get('description').trim();
      if (!description || !Number.isSafeInteger(amount) || amount <= 0 || amount > 100000000) throw new Error('Enter a description and an amount between 0.01 and 1,000,000.');
      await queueExpense(id, {
        description, amount, category: values.get('category'), date: values.get('date'), paidBy: user.uid, createdAt: Date.now()
      });
      const current = $('#expense-form'); if (selectedId === id) { current.reset(); current.elements.date.value = date.toISOString().slice(0,10); refreshSelectedEvent(); }
      status('Expense saved on this device. Pending changes sync when connected.');
    });
  };
  document.querySelectorAll('[data-remove-member]').forEach(button => button.onclick = () => {
    if (!confirm("Remove this traveler? Their recorded payments will transfer to the organizer and shares will be recalculated.")) return;
    const id = selectedId, uid = button.dataset.removeMember;
    perform($('#event-detail'), async () => {
      requireOnline('remove a traveler');
      await removeTraveler(api, db, id, user.uid, uid);
      status('Traveler removed; remaining team shares recalculated.');
    });
  });
  if (owner) $('#member-form').onsubmit = (event) => {
    event.preventDefault(); const form = event.currentTarget; const id = selectedId;
    const values = new FormData(form); const uid = values.get('memberId').trim(); const name = values.get('memberName').trim();
    perform(form, async () => {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid) || !name) throw new Error('Enter a valid account ID and traveler name.');
      requireOnline('add a traveler');
      await addTraveler(api, db, id, user.uid, uid, name);
      if (selectedId === id) $('#member-form').reset(); status('Traveler added.');
    });
  };
  if (owner) $('#repair-access').onclick = (event) => {
    const button = event.currentTarget;
    const id = selectedId;
    const updates = Object.fromEntries(members.map(([uid]) => [`userEvents/${uid}/${id}`, true]));
    perform(button.parentElement, async () => {
      requireOnline('refresh team access');
      await api.update(api.ref(db), updates);
      status('Team event listings refreshed. Each traveler must sign in with the account ID shown beside their name.');
    });
  };
  document.querySelectorAll('[data-delete]').forEach((button) => button.onclick = () => {
    if (!confirm('Delete this expense?')) return;
    const id = selectedId;
    perform($('#expenses'), async () => { await deleteOneOffExpense(id, button.dataset.delete); });
  });
}
initialize().catch((error) => {
  clearTimeout(window.authLoadingTimer);
  $('#google-signin').textContent = 'Sign-in unavailable';
  status(`Could not initialize Firebase: ${error.message}. Check your connection and reload the page.`, 'error');
});

function attachEventDelete() {
  if (eventData.owner !== user.uid) return;
  const button = document.createElement('button'); button.className = 'quiet'; button.textContent = 'Delete event';
  button.disabled = !!Object.keys(eventData.expenses || {}).length || !!Object.keys(eventData.recurring || {}).length;
  button.title = 'Only events without expenses or recurring schedules can be deleted.';
  $('#event-detail').append(button);
  button.onclick = () => {
    if (!confirm('Delete this empty event?')) return;
    const id = selectedId, members = Object.keys(eventData.members);
    perform($('#event-detail'), async () => {
      const updates = Object.fromEntries(members.map(uid => [`userEvents/${uid}/${id}`, null]));
      requireOnline('delete an event');
      updates[`events/${id}`] = null; await api.update(api.ref(db), updates); status('Event deleted.');
    });
  };
}
function renderPersonal() {
  const draft = readExpenseDraft($('#personal-form'));
  const data = eventData, id = selectedId;
  const entries = monthlyEntries(data, personalMonth);
  $('#event-detail').innerHTML = `<div class="event-heading"><div><p class="eyebrow">PERSONAL EXPENSES · ${escapeHTML(data.currency)}</p><p class="muted">Private to you. No travelers or shared balances.</p><h2>${escapeHTML(data.name)}</h2></div></div>
    <label>View month<input id="personal-month" type="month" value="${personalMonth}" required></label>
    <div class="stat"><small>Monthly total (including scheduled payments)</small><strong>${money(entries.reduce((sum,[,e]) => sum+e.amount,0))}</strong></div>
    <form id="personal-form"><h3>Add an expense or recurring payment</h3>
    <label>Description<input name="description" required maxlength="120"></label><label>Amount<input name="amount" type="text" maxlength="300" required placeholder="24.69+56.71+209.67" aria-describedby="amount-total"></label>
    <label>Category<select name="category">${data.categories.map(c=>`<option>${escapeHTML(c)}</option>`).join('')}</select></label>
    <label>Date / first payment<input name="date" type="date" value="${localDate()}" required></label>
    <label>Repeat<select name="repeat"><option value="once">Once</option><option value="monthly">Monthly</option><option value="weekly">Weekly</option><option value="fortnightly">Fortnightly</option></select></label>
    <label id="repeat-end" hidden>Last payment date<input name="end" type="date"></label><button>Save expense</button></form>
    <h3>Expenses for ${escapeHTML(personalMonth)}</h3><div id="personal-expenses">${groupedExpenseHTML(entries, ([key,e])=>`<div class="expense-row"><div class="expense-description"><strong>${escapeHTML(e.description)}</strong><small>${e.pending ? '<span class="pending-label">Pending sync · </span>' : ''}${escapeHTML(e.date)} · ${escapeHTML(e.category)}${e.scheduled ? ` · Scheduled ${escapeHTML(e.frequency || 'monthly')}` : ''}</small></div><div class="expense-controls"><strong class="expense-amount">${money(e.amount)}</strong><div class="expense-actions">${!e.scheduled ? `<button type="button" class="quiet" data-edit-expense="${escapeHTML(key)}">Edit</button><button class="quiet" data-personal-delete="${escapeHTML(key)}">Delete</button>` : ''}</div></div></div>`) || '<p class="muted">No expenses this month.</p>'}</div>
    <h3>Recurring schedules</h3><p class="muted">Recurring payments cannot be edited. To make a correction, delete the schedule and create a replacement. Deleting removes its amounts from every month, including earlier months.</p>
    ${Object.entries(data.recurring || {}).map(([key,r])=>`<div class="expense-row"><div>${escapeHTML(r.description)}<small>${escapeHTML(r.startDate || r.start)} to ${escapeHTML(r.endDate || r.end)} · ${escapeHTML(r.frequency || 'monthly')} · ${money(r.amount)}</small></div><div class="expense-controls"><div class="expense-actions"><button class="quiet" data-schedule-delete="${escapeHTML(key)}">Delete schedule</button></div></div></div>`).join('') || '<p class="muted">No recurring schedules.</p>'}`;
  $('#personal-month').onchange = e => { if (/^\d{4}-\d{2}$/.test(e.target.value)) { personalMonth = e.target.value; renderPersonal(); attachEventDelete(); } };
  const form = $('#personal-form');
  restoreExpenseDraft(form, draft);
  configureExpenseEditor(form);
  attachAmountPreview(form);
  bindEditButtons();
  form.elements.repeat.onchange = () => { const recurring = form.elements.repeat.value !== 'once'; $('#repeat-end').hidden = !recurring; form.elements.end.required = recurring; };
  form.elements.repeat.onchange();
  form.onsubmit = e => { e.preventDefault(); const values = new FormData(form); const edit = editing; perform(form, async () => {
    if (edit) { await saveExpenseEdit(edit, values); return; }
    const amount = parseExpenseAmount(values.get('amount')), description = values.get('description').trim(), date = values.get('date');
    if (!description || !Number.isSafeInteger(amount) || amount <= 0 || amount > 100000000) throw new Error('Enter a valid description and amount.');
    const record = {description, amount, category: values.get('category'), paidBy: user.uid, createdAt: api.serverTimestamp()};
    const repeat = values.get('repeat') !== 'once';
    if (repeat) requireOnline('create a recurring schedule');
    if (repeat) {
      const end = values.get('end');
      if (!end || end < date) throw new Error('Last payment date must be on or after the first payment.');
      record.frequency = values.get('repeat');
      if (record.frequency === 'monthly') {
        record.start = date.slice(0,7); record.end = end.slice(0,7); record.day = Number(date.slice(8));
        if (end.slice(0,7) !== date.slice(0,7) && Number(end.slice(8)) < Math.min(record.day, new Date(Number(end.slice(0,4)),Number(end.slice(5,7)),0).getDate())) {
          const previous = new Date(`${end.slice(0,7)}-01T00:00:00Z`); previous.setUTCMonth(previous.getUTCMonth()-1); record.end = previous.toISOString().slice(0,7);
        }
      } else { record.startDate = date; record.endDate = end; }
    }
    else record.date = date;
    if (repeat) await api.set(api.push(api.ref(db, `events/${id}/recurring`)), record);
    else await queueExpense(id, { ...record, createdAt: Date.now() });
    if (selectedId === id && !editing) { $('#personal-form').reset(); refreshSelectedEvent(); }
    status(repeat ? 'Recurring schedule saved.' : 'Expense saved on this device. Pending changes sync when connected.');
  }); };
  document.querySelectorAll('[data-personal-delete], [data-schedule-delete]').forEach(b => b.onclick = () => {
    if(!confirm(b.dataset.scheduleDelete ? 'Delete this schedule and its amounts from every month?' : 'Delete this expense?')) return;
    perform($('#event-detail'), async () => { if (b.dataset.scheduleDelete) await deleteRecurringSchedule(id, b.dataset.scheduleDelete); else await deleteOneOffExpense(id, b.dataset.personalDelete); });
  });
}

function groupedExpenseHTML(entries, row) {
  return groupExpenses(entries).map(group => `<section class="expense-group"><div class="group-heading"><h4>${escapeHTML(group.category)}</h4><strong>${money(group.total)}</strong></div>${group.entries.map(row).join('')}</section>`).join('');
}

// Keep a visible total beside the expression and use native form validation.
function attachAmountPreview(form) {
  const input = form.elements.amount;
  const output = document.createElement('output');
  output.id = 'amount-total'; output.className = 'amount-total';
  output.setAttribute('aria-live', 'polite');
  input.insertAdjacentElement('afterend', output);
  const update = () => {
    input.setCustomValidity('');
    if (!input.value.trim()) { output.textContent = 'Enter an amount, or add several with +.'; return; }
    try {
      output.textContent = `Total: ${money(parseExpenseAmount(input.value))}`;
      output.dataset.kind = 'success';
    } catch (error) {
      input.setCustomValidity(error.message);
      output.textContent = error.message; output.dataset.kind = 'error';
    }
  };
  input.addEventListener('input', update);
  form.addEventListener('reset', () => setTimeout(update, 0));
  update();
}

function readExpenseDraft(form) {
  return form ? Object.fromEntries([...form.elements].filter(input => input.name).map(input => [input.name, input.value])) : {};
}
function restoreExpenseDraft(form, draft) {
  Object.entries(draft).forEach(([name, value]) => { if (form.elements[name]) form.elements[name].value = value; });
}
function refreshSelectedEvent() {
  if (!selectedId || selectedTab !== eventTab || !eventData || !eventCache[selectedId] || (eventData.type === 'personal') !== (eventTab === 'personal')) { clearSelectedEvent(false); return; }
  $('#event-detail').hidden = false;
  $('.workspace').classList.add('has-event');
  if (eventData.type === 'personal') renderPersonal(); else renderEvent();
  attachEventDelete();
  const back = document.createElement('button');
  back.type = 'button'; back.className = 'quiet event-back'; back.textContent = '← Back to events';
  back.onclick = () => {
    const id = selectedId;
    clearSelectedEvent();
    [...document.querySelectorAll('#event-list button')].find(button => button.dataset.id === id)?.focus();
  };
  $('#event-detail').prepend(back);
}
function configureExpenseEditor(form) {
  if (!editing || editing.eventId !== selectedId) return;
  if (!eventData[editing.collection]?.[editing.key]) {
    editing = null; form.reset();
    status('The expense being edited is no longer available.', 'error');
    return;
  }
  form.querySelector('h3').textContent = 'Edit expense';
  // Only amount and date are editable; attribution and other saved fields stay intact.
  [...form.elements].filter(input => input.name && !['amount', 'date'].includes(input.name)).forEach(input => input.disabled = true);
  form.querySelector('button:not([type="button"])').textContent = 'Save changes';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'quiet'; cancel.textContent = 'Cancel edit';
  cancel.onclick = () => { editing = null; form.reset(); refreshSelectedEvent(); };
  form.append(cancel);

}
function bindEditButtons() {
  document.querySelectorAll('[data-edit-expense]').forEach(button => button.onclick = () => {
    const collection = 'expenses';
    const key = button.dataset.editExpense;
    const record = eventData[collection]?.[key];
    if (!record) { status('This expense is no longer available.', 'error'); return; }
    editing = { eventId: selectedId, collection, key, baseline: structuredClone(record) };
    refreshSelectedEvent();
    const form = $('#personal-form') || $('#expense-form');
    form.elements.description.value = record.description;
    form.elements.category.value = record.category;
    form.elements.amount.value = (record.amount / 100).toFixed(2);
    form.elements.date.value = record.date;
    form.elements.amount.dispatchEvent(new Event('input'));
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    form.elements.amount.focus({ preventScroll: true });
  });
}
async function saveExpenseEdit(edit, values) {
  const record = edit.baseline;
  const amount = parseExpenseAmount(values.get('amount')), date = values.get('date');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Enter a valid date.');
  const { pending, ...saved } = record;
  await offline.queue(user.uid, edit.eventId, edit.key, { ...saved, amount, date }, saved);
  await refreshClient(false);
  syncEngine.run();
  if (selectedId === edit.eventId && editing === edit) {
    editing = null;
    const form = $('#personal-form') || $('#expense-form');
    form.reset();
    refreshSelectedEvent();
  }
  status('Expense changes saved on this device. They will sync when connected.');
}


// Account-scoped offline state. Never restore one user's events into another session.
async function loadSession(nextUser) {
  const version = ++sessionVersion;
  stopIndex(); stopEvent(); eventListeners.forEach(off => off()); eventListeners = [];
  selectedId = null; eventData = null; editing = null; eventCache = {}; user = nextUser;
  syncState = 'offline'; syncError = '';
  $('.account-id').hidden = false;
  $('#auth-panel').hidden = !!user; $('#app').hidden = !user; $('#account').hidden = !user;
  $('#event-list').replaceChildren(); $('#sync-issues').replaceChildren(); $('#sync-issues').hidden = true;
  clearSelectedEvent(false);
  if (!user) { if (!navigator.onLine) status('Connect to sign in. First setup requires an internet connection.', 'error'); return; }
  const uid = user.uid;
  $('#sync-state').textContent = 'Loading saved events…';
  $('#sync-detail').textContent = 'Checking device storage…';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Device storage did not respond. Close other app tabs and reload.')), 10000);
    offline.db.open().then(resolve, reject).finally(() => clearTimeout(timer));
  });
  if (version !== sessionVersion) return;
  $('#identity').textContent = user.email; $('#uid').textContent = uid;
  await refreshClient();
  if (version !== sessionVersion) return;
  stopIndex = api.onValue(api.ref(db, `userEvents/${uid}`), async snapshot => {
    if (version !== sessionVersion) return;
    eventListeners.forEach(off => off()); eventListeners = [];
    for (const id of Object.keys(snapshot.val() || {})) {
      eventListeners.push(api.onValue(api.ref(db, `events/${id}`), snapshot => {
        if (version !== sessionVersion) return;
        const persist = snapshot.exists() ? offline.saveEvent(uid, id, snapshot.val()) : offline.removeEvent(uid, id);
        persist.then(() => refreshClient()).catch(error => status(error.message, 'error'));
      }, error => {
        if (version !== sessionVersion) return;
        offline.removeEvent(uid, id).then(() => refreshClient()).catch(error => status(error.message, 'error'));
        status('An event is no longer accessible. Pending changes remain on this device for review.', 'error');
      }));
    }
    syncEngine.run();
  }, error => { if (version === sessionVersion) status(error.message, 'error'); });
  if (navigator.onLine) syncEngine.run();
}
async function refreshClient(renderDetail = true) {
  if (!user) return;
  const uid = user.uid, version = ++viewVersion;
  const events = await offline.events(uid);
  if (uid !== user?.uid || version !== viewVersion) return;
  eventCache = events;
  renderEventList();
  if (selectedId) {
    eventData = eventCache[selectedId];
    if (eventData && renderDetail) refreshSelectedEvent();
    else if (!eventData) clearSelectedEvent(false);
  }
  await renderSyncPanel();
}
function requireOnline(action) {
  if (!navigator.onLine) throw new Error(`Connect to the internet to ${action}. One-off expenses can be added, edited, and deleted offline.`);
  if (!serverConnected) throw new Error('The live connection is reconnecting. You can still sync, add, edit, and delete one-off expenses. Retry this action shortly.');
}
async function queueExpense(eventId, record) {
  const expenseId = api.push(api.ref(db, `events/${eventId}/expenses`)).key;
  await offline.queue(user.uid, eventId, expenseId, record);
  navigator.storage?.persist?.().catch(() => {});
  await refreshClient(false);
  syncEngine.run();
}
async function deleteOneOffExpense(eventId, expenseId) {
  const record = eventCache[eventId]?.expenses?.[expenseId];
  if (!record) throw new Error('This expense is no longer available.');
  await offline.queueDelete(user.uid, eventId, expenseId, record);
  if (editing?.key === expenseId && editing.eventId === eventId) editing = null;
  await refreshClient();
  syncEngine.run();
  status('Expense removed on this device. Deletion will sync when connected.');
}
async function deleteRecurringSchedule(eventId, key) {
  if (!navigator.onLine) throw new Error('Connect to delete a recurring schedule.');
  const uid = user.uid, baseline = eventCache[eventId]?.recurring?.[key];
  if (!baseline) throw new Error('This schedule is no longer available.');
  await syncEngine.transport.remove({ uid, eventId, collection: 'recurring', key, baseline });
  const data = await syncEngine.transport.event(eventId, uid);
  if (data) await offline.saveEvent(uid, eventId, data);
  await refreshClient();
  syncEngine.run();
  status('Recurring schedule deleted.');
}

async function renderSyncPanel() {
  if (!user) return;
  const uid = user.uid;
  const [changes, account] = await Promise.all([offline.changes(uid), offline.account(uid)]);
  if (uid !== user?.uid) return;
  const connected = navigator.onLine;
  const state = !connected ? 'Offline' : syncState === 'syncing' ? 'Syncing…' : syncState === 'failed' ? 'Sync failed' : changes.some(c => c.state !== 'pending') ? 'Needs attention' : changes.length ? 'Changes pending' : account?.lastSynced ? 'Synced' : 'Ready to sync';
  $('#sync-state').textContent = state;
  $('#sync-toolbar').dataset.state = connected ? syncState : 'offline';
  $('#sync-now').disabled = !connected || syncState === 'syncing';
  $('#sync-detail').textContent = `${changes.length} pending change${changes.length === 1 ? '' : 's'}. ${account?.lastSynced ? 'Last sync: ' + new Date(account.lastSynced).toLocaleString() : 'Connect to download your events.'}${syncError ? ' ' + syncError : ''}`;
  const issues = $('#sync-issues'); issues.replaceChildren();
  for (const change of changes.filter(c => c.state !== 'pending' || c.error)) {
    const row = document.createElement('div'); row.className = 'sync-issue';
    const text = document.createElement('p');
    text.textContent = `${change.record.description}: ${change.error || 'Review this pending change.'}`;
    row.append(text);
    if (change.state === 'conflict' && change.remote) {
      const compare = document.createElement('p'); compare.className = 'muted';
      compare.textContent = `${change.kind === 'delete' ? 'Deletion requested for' : 'Your change:'} ${(change.record.amount/100).toFixed(2)} on ${change.record.date}. Server: ${(change.remote.amount/100).toFixed(2)} on ${change.remote.date}.`;
      row.append(compare);
    }
    const discard = document.createElement('button'); discard.type = 'button'; discard.className = 'quiet';
    discard.textContent = change.state === 'conflict' ? 'Use server version' : 'Discard local change';
    discard.onclick = () => perform(row, async () => { if (!confirm('Discard this unsynced change?')) return; await offline.resolve(change, false); await refreshClient(); syncEngine.run(); });
    row.append(discard);
    if (change.state === 'conflict' && change.remote && change.kind === 'edit') {
      const keep = document.createElement('button'); keep.type = 'button'; keep.className = 'secondary'; keep.textContent = 'Apply my amount and date';
      keep.onclick = () => perform(row, async () => { await offline.resolve(change, true); await refreshClient(); syncEngine.run(); });
      row.append(keep);
    }
    issues.append(row);
  }
  issues.hidden = !issues.children.length;
}
$('#sync-now').onclick = () => syncEngine?.run();
window.addEventListener('offline', () => { renderSyncPanel().catch(error => status(error.message, 'error')); });
window.addEventListener('online', () => { syncEngine?.run(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && user) syncEngine?.run(); });
document.addEventListener('offline-shell-ready', () => { $('#offline-ready').textContent = 'Ready for offline use after your events finish syncing.'; });
if ('serviceWorker' in navigator) navigator.serviceWorker.ready.then(() => { $('#offline-ready').textContent = 'Ready for offline use after your events finish syncing.'; });

setInterval(() => {
  if (!document.hidden && user && navigator.onLine) {
    const uid = user.uid;
    offline.changes(uid).then(changes => { if (user?.uid === uid && (!serverConnected || changes.some(change => change.state === 'pending'))) syncEngine?.run(); }).catch(error => status(error.message, 'error'));
  }
}, 30000);
