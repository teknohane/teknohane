const CACHE_NAME = 'teknohane-v4';

// Install — sadece ikonları ve manifest cache'le, index.html'i değil
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll([
      '/teknohane/manifest.json',
      '/teknohane/teknohane.png',
      '/teknohane/icons/icon-192.png',
      '/teknohane/icons/icon-512.png'
    ]))
  );
  self.skipWaiting();
});

// Activate — eski cache'leri temizle
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // index.html — HİÇBİR ZAMAN cache'leme, her zaman network
  if (url.pathname === '/teknohane/' || url.pathname === '/teknohane/index.html') {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .catch(() => caches.match('/teknohane/'))
    );
    return;
  }

  // Dış kaynaklar (YouTube, Firebase, Fonts) — network first
  if (url.hostname !== 'teknohane.github.io') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  // Statik dosyalar (ikonlar, manifest, png) — cache first
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(res => {
        if (res.ok) {
          caches.open(CACHE_NAME).then(c => c.put(event.request, res.clone()));
        }
        return res;
      });
    })
  );
});
