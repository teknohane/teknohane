// Teknohane Service Worker
// Amaç: internet olmadığında tarayıcının kendi "Bu siteye ulaşılamıyor" hata sayfası yerine,
// en son yüklenmiş uygulama kabuğunu (index.html) göstermek.
// Not: Cloudflare Worker (telefon/fiyat/haber/push API) ve Firebase istekleri KESİNLİKLE
// önbelleğe alınmıyor — bunlar her zaman canlı veri olarak ağdan çekilir.

const CACHE_NAME = 'teknohane-shell-v2';
const APP_SHELL = [
  '/teknohane/',
  '/teknohane/index.html',
  '/teknohane/manifest.json',
  '/teknohane/teknohane.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => {}) // Bir dosya bulunamazsa kurulum yine de devam etsin
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = req.url;

  // Cloudflare Worker / Firebase / Google API istekleri: her zaman ağdan çek, hiç dokunma
  if (
    url.includes('workers.dev') ||
    url.includes('googleapis.com') ||
    url.includes('gstatic.com') ||
    url.includes('firestore') ||
    url.includes('firebaseio.com')
  ) {
    return; // event.respondWith çağrılmazsa tarayıcı normal ağ isteğini yapar
  }

  // Sayfa açılışı / navigasyon istekleri: önce ağı dene (güncel içerik için),
  // ağ başarısız olursa (internet yok) önbellekteki uygulama kabuğunu göster.
  // Not: req.mode === 'navigate' kontrolüne EK olarak URL'i de kontrol ediyoruz — çünkü Capacitor'ın
  // native Android WebView'i ana sayfa isteğini her zaman 'navigate' olarak işaretlemeyebiliyor.
  // Bu durumda istek yanlışlıkla aşağıdaki "önce önbellek" dalına düşüp index.html'in bir daha asla
  // güncellenmemesine (kalıcı olarak eski sürümde kalmasına) neden oluyordu.
  const isAppShellRequest = req.mode === 'navigate'
    || url === self.registration.scope
    || url.endsWith('/teknohane/')
    || url.endsWith('/teknohane/index.html');

  if (isAppShellRequest) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('/teknohane/index.html', resClone));
          return res;
        })
        .catch(() =>
          caches.match('/teknohane/index.html').then((cached) => cached || caches.match(req))
        )
    );
    return;
  }

  // Diğer statik dosyalar (ikon, manifest vb.): önce önbellek, yoksa ağdan çekip önbelleğe ekle
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          return res;
        })
        .catch(() => cached);
    })
  );
});
