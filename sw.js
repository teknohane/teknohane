const CACHE_NAME = 'teknohane-v6';
const CACHE_URLS = [
  '/teknohane/manifest.json',
  '/teknohane/teknohane.png',
  '/teknohane/sartlar.html',
  '/teknohane/icons/icon-72.png',
  '/teknohane/icons/icon-96.png',
  '/teknohane/icons/icon-128.png',
  '/teknohane/icons/icon-144.png',
  '/teknohane/icons/icon-152.png',
  '/teknohane/icons/icon-192.png',
  '/teknohane/icons/icon-384.png',
  '/teknohane/icons/icon-512.png'
];

// INSTALL — statik dosyaları cache'le
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CACHE_URLS))
      .catch(() => {}) // bir dosya eksikse install'u bozma
  );
  self.skipWaiting();
});

// ACTIVATE — eski cache'leri temizle
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// FETCH
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Sadece GET isteklerini ele al
  if (event.request.method !== 'GET') return;

  // index.html / kök — HER ZAMAN network, asla cache'leme (tarayıcı HTTP cache'i dahil!)
  // { cache: 'no-store' } olmadan fetch() bile GitHub Pages'in Cache-Control header'ına
  // uyup tarayıcının kendi HTTP önbelleğinden eski içerik döndürebilir.
  if (url.pathname === '/teknohane/' || url.pathname === '/teknohane/index.html') {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .catch(() => caches.match('/teknohane/') || caches.match('/teknohane/index.html'))
    );
    return;
  }

  // go.html da network-first (yönlendirme mantığı güncel kalsın)
  if (url.pathname === '/teknohane/go.html') {
    event.respondWith(fetch(event.request, { cache: 'no-store' }));
    return;
  }

  // Dış kaynaklar (YouTube API, Firebase, Google Fonts) — sadece network
  // Offline'da bu veriler zaten anlamlı değil, cache'lemeye gerek yok
  if (url.hostname !== 'teknohane.github.io') {
    event.respondWith(
      fetch(event.request).catch(() => new Response('', { status: 503 }))
    );
    return;
  }

  // Bizim statik dosyalarımız (ikon, manifest, logo, sartlar.html)
  // Cache-first: hızlı yüklensin, offline'da da çalışsın
  if (CACHE_URLS.some(u => url.pathname === u)) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          }
          return res;
        });
      })
    );
    return;
  }

  // Geri kalan her şey (varsa) — network-first, olmazsa cache dene
  event.respondWith(
    fetch(event.request, { cache: 'no-store' }).catch(() => caches.match(event.request))
  );
});
