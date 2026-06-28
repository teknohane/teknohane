const CACHE_NAME = 'teknohane-v1';
const STATIC_ASSETS = [
  '/teknohane/',
  '/teknohane/index.html',
  '/teknohane/manifest.json',
  '/teknohane/teknohane.png',
  '/teknohane/icons/icon-192.png',
  '/teknohane/icons/icon-512.png'
];

// ── INSTALL: Statik dosyaları önbelleğe al ──
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// ── ACTIVATE: Eski cache'leri temizle ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ── FETCH: Strateji ──
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // YouTube API isteklerini cache'leme — her zaman network
  if (url.hostname === 'www.googleapis.com') {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          // Başarılıysa kısa süreli cache'e al (30 dk)
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME + '-api').then(cache => {
              cache.put(event.request, clone);
              // 30 dakika sonra sil
              setTimeout(() => {
                caches.open(CACHE_NAME + '-api').then(c => c.delete(event.request));
              }, 30 * 60 * 1000);
            });
          }
          return res;
        })
        .catch(() => {
          // Network yoksa cache'den sun
          return caches.match(event.request);
        })
    );
    return;
  }

  // YouTube thumbnail'leri — network first, cache fallback
  if (url.hostname === 'i.ytimg.com') {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME + '-thumbs').then(cache => cache.put(event.request, clone));
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Google Fonts — cache first
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME + '-fonts').then(cache => cache.put(event.request, clone));
          return res;
        });
      })
    );
    return;
  }

  // Statik dosyalar — cache first, network fallback
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return res;
      });
    })
  );
});
