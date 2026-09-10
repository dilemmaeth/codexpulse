const CACHE_NAME = 'codexpulse-shell-v1.2.2';
const ROOT = new URL('./', self.registration.scope).href;
const CORE = [
  ROOT,
  new URL('manifest.webmanifest', ROOT).href,
  new URL('icon-192.png', ROOT).href,
  new URL('icon-512.png', ROOT).href,
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const response = await fetch(new URL('sw-assets.json', ROOT), { cache: 'no-store' });
    if (!response.ok) throw new Error('Missing offline asset manifest');
    const assets = await response.json();
    if (!Array.isArray(assets) || assets.some((asset) => typeof asset !== 'string' || !asset.startsWith('assets/') || asset.includes('..'))) throw new Error('Invalid offline assets');
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll([...CORE, ...assets.map((asset) => new URL(asset, ROOT).href)]);
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('codexpulse-shell-') && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || request.url.includes('codexpulse-data.enc.json')) return;
  const url = new URL(request.url);
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response.ok) await caches.open(CACHE_NAME).then((cache) => cache.put(ROOT, response.clone()));
          return response;
        })
        .catch(() => caches.match(ROOT)),
    );
    return;
  }
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then(async (response) => {
      if (response.ok) await caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
      return response;
    })),
  );
});
