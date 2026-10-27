/* CUBRAX service worker. Generated at build: version + precache list are injected below. */
const VERSION = '__VERSION__';
const CACHE = `obrax-${VERSION}`;
const PRECACHE = __PRECACHE__;
const SHELL = './index.html';

self.addEventListener('install', (event) => {
  // The whole app shell is cached atomically: if one file fails, the install fails and the
  // previous version keeps working.
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' }))))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => (k.startsWith('obrax-') || k.startsWith('cubicador-')) && k !== CACHE).map((k) => caches.delete(k)))
      )
  );
});

// Background Sync ("cubrax-receipts"): a receipt scanned offline is waiting in IndexedDB. The worker cannot write into the
// app's project state, so it wakes every open window, which drains the queue (see src/lib/receiptSync.js). With the app
// closed nothing is lost: the queue is drained the next time it starts.
self.addEventListener('sync', (event) => {
  if (event.tag !== 'cubrax-receipts') return;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => wins.forEach((w) => w.postMessage({ type: 'SYNC_RECEIPTS' })))
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch third-party (Google auth etc.)
  if (url.pathname.endsWith('/sw.js')) return;

  if (req.mode === 'navigate') {
    // App shell served from the versioned precache => instant + fully offline.
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached =
          (await cache.match(SHELL, { ignoreVary: true })) || (await cache.match('./', { ignoreVary: true }));
        return cached || fetch(req);
      })
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      // ignoreVary: static hosts add `Vary` headers; without this the cache can miss on files we precached.
      const hit = (await cache.match(req, { ignoreVary: true })) || (await cache.match(url.href, { ignoreVary: true }));
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
        return res;
      } catch (err) {
        return new Response('', { status: 504, statusText: 'Offline' });
      }
    })
  );
});
