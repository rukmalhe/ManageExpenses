// The build replaces this token with a content hash. A new cache becomes active
// only after every required file (including the Firebase SDK) is downloaded.
const CACHE = 'roam-shell-__BUILD_VERSION__';
const SDK = 'https://www.gstatic.com/firebasejs/12.6.0/';
const FILES = ['/', '/index.html', '/styles.css', '/bootstrap.js', '/index.js', '/event-actions.js', '/expense-utils.js', '/offline-store.js', '/sync-engine.js', '/firebase-config.js', '/vendor/dexie.mjs', '/manifest.webmanifest', '/icons/icon-180.png', '/icons/icon-192.png', '/icons/icon-512.png', ...['firebase-app.js','firebase-auth.js','firebase-database.js'].map(file => SDK + file)];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES))));
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const name of await caches.keys()) if (name.startsWith('roam-shell-') && name !== CACHE) await caches.delete(name);
  await self.clients.claim();
})()));
self.addEventListener('message', event => { if (event.data === 'activate') self.skipWaiting(); });
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const local = url.origin === self.location.origin;
  const navigation = local && event.request.mode === 'navigate' && ['/', '/index.html'].includes(url.pathname);
  // Never cache authentication requests or database responses in Cache Storage.
  if (!(local && (FILES.some(file => new URL(file, self.location.origin).pathname === url.pathname) || navigation)) && !url.href.startsWith(SDK)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (navigation) {
      // Online navigation discovers new HTML and its versioned asset URLs.
      // Keep the installed shell intact until the next complete cache activates.
      try {
        const fresh = await fetch(event.request, { signal: AbortSignal.timeout(5000) });
        if (fresh.ok) return fresh;
      } catch {}
      return (await cache.match('/index.html')) || Response.error();
    }
    const cached = await cache.match(event.request);
    if (cached) return cached;
    const response = await fetch(event.request);
    if (response.ok) await cache.put(event.request, response.clone());
    return response;
  })());
});
