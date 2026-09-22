const CACHE_NAME = 'ad-creative-v3';

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

// core app files that must always match each other and the current code --
// these go network-first so a stale cached app.js can never get paired with
// a fresh index.html (which is exactly what caused a real breakage: an old
// cached app.js referencing DOM that a newer index.html no longer has,
// throwing and halting script execution before event listeners attached).
// Only the rarely-changing, expensive-to-refetch assets (fonts, icons) stay
// cache-first.
function isCoreAppFile(request, url) {
  if (request.mode === 'navigate') return true;
  return /\.(js|css)$/.test(url.pathname) || url.pathname.endsWith('/manifest.webmanifest');
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  if (isCoreAppFile(event.request, url)) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request).then((cached) => cached || (event.request.mode === 'navigate' ? caches.match('./index.html') : undefined)))
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
