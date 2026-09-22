const CACHE_NAME = 'ad-creative-v2';

const PRECACHE_URLS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './fonts/fonts.css',
  './fonts/inter-400.ttf',
  './fonts/inter-600.ttf',
  './fonts/inter-700.ttf',
  './fonts/worksans-400.ttf',
  './fonts/worksans-600.ttf',
  './fonts/worksans-700.ttf',
  './fonts/archivo-400.ttf',
  './fonts/archivo-600.ttf',
  './fonts/archivo-700.ttf',
  './fonts/playfair-600.ttf',
  './fonts/playfair-700.ttf',
  './fonts/fraunces-600.ttf',
  './fonts/fraunces-700.ttf',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // Page navigations (loading index.html) go network-first, so a change on
  // the server shows up the moment you're online -- falling back to the
  // cached shell only when offline. Everything else (fonts, icons, css/js
  // referenced by that fresh HTML) stays cache-first for offline/speed.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request).then((cached) => cached || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (response && response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);
    })
  );
});
