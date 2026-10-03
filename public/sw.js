const CACHE_NAME = 'codexpulse-shell-v1.3.0';
const ROOT = new URL('./', self.registration.scope).href;
const CORE = [
  ROOT,
  new URL('manifest.webmanifest', ROOT).href,
  new URL('icon-192.png', ROOT).href,
  new URL('icon-512.png', ROOT).href,
  new URL('apple-touch-icon.png', ROOT).href,
  new URL('codexpulse-config.json', ROOT).href,
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
  if (url.origin !== self.location.origin || !url.href.startsWith(ROOT)) return;
  if (request.mode === 'navigate') {
    // Keep the installed HTML and its asset graph together until the user accepts an update.
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => (await cache.match(ROOT)) || fetch(request)),
    );
    return;
  }
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => (await cache.match(request)) || fetch(request).then(async (response) => {
      if (response.ok) await cache.put(request, response.clone());
      return response;
    })),
  );
});
