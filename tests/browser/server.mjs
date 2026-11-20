// Isolated browser fixture: serves the real built app with a local fake identity
// and database. Browser tests never contact or write to the live Firebase project.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createHash } from 'node:crypto';
const origin = 'http://127.0.0.1:8766';
const csp = (await readFile('deploy/Caddyfile.app','utf8')).match(/Content-Security-Policy "([^"]+)"/)[1];
let events, revoked, offlineMode;
const seed = () => {
  revoked = false; offlineMode = false;
  events = {
    trip: { name: 'Shared test trip', type: 'shared', owner: 'owner', currency: 'NZD', createdAt: Date.now(), categories: ['Food'], members: { owner: { name: 'Owner' } }, expenses: { meal: { description: 'Dinner', category: 'Food', amount: 100, date: '2026-11-20', paidBy: 'owner', createdAt: 1 } } },
    personal: { name: 'Personal test event', type: 'personal', owner: 'owner', currency: 'NZD', createdAt: Date.now(), categories: ['Food'], members: { owner: { name: 'Owner' } } }
  };
}; seed();
const authModule = `
const account = () => { const uid = localStorage.getItem('fixture-account') || 'owner'; return uid === 'signed-out' ? null : { uid, email: uid+'@example.test', getIdToken: async () => 'test-'+uid }; };
const auth = { currentUser: account() };
export const indexedDBLocalPersistence = {};
export const setPersistence = async () => {};
export const getAuth = () => auth;
export const onAuthStateChanged = (_auth, cb) => { const update = () => { auth.currentUser=account(); cb(auth.currentUser); }; queueMicrotask(update); window.addEventListener('fixture-account',update); return () => window.removeEventListener('fixture-account',update); };
export const signOut = async () => { localStorage.setItem('fixture-account','signed-out'); window.dispatchEvent(new Event('fixture-account')); };
export class GoogleAuthProvider { setCustomParameters() {} }
export const signInWithPopup = async () => { localStorage.setItem('fixture-account','owner'); window.dispatchEvent(new Event('fixture-account')); };
export const signInWithEmailAndPassword = signInWithPopup;
export const createUserWithEmailAndPassword = signInWithPopup;
`;
const databaseModule = `
export const getDatabase = () => ({});
export const ref = (_db,path) => ({ path });
export const push = () => ({ key: 'expense-'+crypto.randomUUID() });
export const serverTimestamp = () => ({ '.sv':'timestamp' });
export const onValue = (reference, cb, fail) => {
  let closed=false;
  const emit = async () => {
    if (closed) return;
    if (reference.path === '.info/connected') { cb({ val: () => navigator.onLine }); return; }
    if (!navigator.onLine) return;
    try {
      const response = await fetch('/test-db/'+reference.path+'.json?auth=test-'+(localStorage.getItem('fixture-account') || 'owner'));
      if (closed) return;
      if (!response.ok) { fail?.(new Error('Permission denied')); return; }
      const value=await response.json(); if (!closed) cb({ val:()=>value, exists:()=>value!==null });
    } catch {}
  };
  queueMicrotask(emit); window.addEventListener('online',emit); window.addEventListener('offline',emit);
  return () => { closed=true; window.removeEventListener('online',emit); window.removeEventListener('offline',emit); };
};
export const set = async () => { throw new Error('Online management is not mocked in this offline browser fixture.'); };
export const update = set; export const remove = set; export const runTransaction = set;
`;
const server = http.createServer(async (request, response) => {
  try {
    response.setHeader('Content-Security-Policy',csp);
    const url = new URL(request.url, origin);
    const json = (value, status = 200, headers = {}) => { response.writeHead(status, { 'Content-Type': 'application/json', ...headers }); response.end(JSON.stringify(value)); };
    let body = ''; if (request.method !== 'GET') for await (const chunk of request) body += chunk;
    if (url.pathname === '/test-control') {
      if (request.method === 'POST') {
        const action=JSON.parse(body); if (action.reset) seed();
        if (action.amount) events.trip.expenses.meal.amount=action.amount;
        if (action.revoke) revoked=true;
        if ('offline' in action) offlineMode=action.offline;
      }
      json(events); return;
    }
    if (offlineMode) { json({ error:'Test network unavailable' },503); return; }
    if (url.pathname.startsWith('/test-db/')) {
      const path=url.pathname.slice(9).replace(/\.json$/,'').split('/');
      const uid=url.searchParams.get('auth')?.replace('test-','');
      if (path[0] === 'userEvents') { json(uid === 'owner' && !revoked ? { trip:true, personal:true } : {}); return; }
      if (uid !== 'owner' || revoked) { json({ error:'Permission denied' },401); return; }
      const event=events[path[1]];
      if (path.length === 2) { json(event || null); return; }
      if (path[2] !== 'expenses') { json(null); return; }
      event.expenses ||= {};
      const current=event.expenses[path[3]] || null;
      const etag='"'+createHash('sha256').update(JSON.stringify(current)).digest('hex')+'"';
      if (request.method === 'PUT') {
        if (request.headers['if-match'] !== etag) { json({ error:'Conflict' },412); return; }
        const value=JSON.parse(body); if (typeof value.createdAt === 'object') value.createdAt=Date.now();
        event.expenses[path[3]]=value; json(value); return;
      }
      json(current,200,{ ETag:etag }); return;
    }
    if (url.pathname.startsWith('/test-sdk/')) {
      const file=url.pathname.split('/').at(-1);
      response.writeHead(200,{ 'Content-Type':'text/javascript' });
      response.end(file === 'firebase-app.js' ? 'export const initializeApp = () => ({});' : file === 'firebase-auth.js' ? authModule : databaseModule); return;
    }
    if (url.pathname === '/firebase-config.js') {
      response.writeHead(200,{ 'Content-Type':'text/javascript' }); response.end(`export const firebaseConfig = ${JSON.stringify({ apiKey:'browser-fixture', projectId:'demo-roam', authDomain:'example.test', appId:'fixture', databaseURL:origin+'/test-db' })};`); return;
    }
    const file=resolve('dist', '.'+(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(resolve('dist')+'/')) { response.writeHead(404); response.end(); return; }
    let content=await readFile(file);
    const types={ '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css', '.webmanifest':'application/manifest+json', '.png':'image/png' };
    if (['/index.js','/service-worker.js'].includes(url.pathname)) content=content.toString().replaceAll('https://www.gstatic.com/firebasejs/12.6.0/',origin+'/test-sdk/');
    response.writeHead(200,{ 'Content-Type':types[extname(file)] || 'application/octet-stream', 'Cache-Control':'no-store' }); response.end(content);
  } catch { response.writeHead(404); response.end(); }
});
server.listen(8766,'127.0.0.1',()=>console.log('Offline browser fixture: '+origin));
