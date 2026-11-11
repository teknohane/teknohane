// Teknohane Service Worker (web / ana ekran PWA) — TEK service worker (firebase-messaging-sw.js yalnızca FCM içindir, ayrı kapsamdadır).
//
// AMAÇ: ana ekrandan açılan uygulamanın HER durumda açılması: ağ varsa güncel kabuk, ağ yoksa/çok yavaşsa son iyi kabuk, hiç kabuk yoksa çevrimdışı bilgi sayfası.
// KAÇINILAN HATALAR (eski sürüm, v4 — yerelde yeniden üretildi):
//  1) Her navigasyon yanıtı "index.html" anahtarıyla önbelleğe YAZILIYORDU: auth-action.html / sartlar.html ziyareti ya da bir 503/404 yanıtı kabuğu ezip,
//     çevrimdışı açılışta yanlış sayfa/hata sayfası gösteriyordu. → Yalnızca kabuk isteği (/ ve /index.html) VE yalnızca BAŞARILI (200, aynı kökenli) yanıt yazılır.
//  2) Ağ askıdayken navigasyon SONSUZ bekliyordu ("sonsuz yükleme"). → Önbellekte iyi kabuk varsa NAV_TIMEOUT_MS sonra önbellek döner (ağ arka planda sürer).
//  3) Diğer statik dosyalar "önce önbellek" ile ÖMÜR BOYU eski kalıyor, hata yanıtları da yazılıyordu. → Yalnızca beyaz listedeki küçük statik dosyalar, bayatken-yenile (SWR), yalnızca 200 yanıt, sınırlı sayıda.
//
// ASLA önbelleğe alınmayanlar: çapraz köken (Firebase, Cloudflare Worker, Google, üretici CDN'leri), POST/PUT vb., giriş/kimlik doğrulama sayfaları (auth-action.html, go.html), 200 dışı yanıtlar,
// yönlendirilmiş yanıtlar, Cache-Control: no-store içerenler. Oturum/jeton bilgisi bu dosyada hiç okunmaz/yazılmaz.
// Android (Capacitor) kabuğunda bu SW KAYDEDİLMEZ (index.html: !isNativeApp()); canlı içerik güncelleme mekanizması etkilenmez.

const SURUM = 'v5';
const KABUK_ONBELLEK = 'teknohane-kabuk-' + SURUM;
const VARLIK_ONBELLEK = 'teknohane-varlik-' + SURUM;
const BASE = new URL(self.registration.scope).pathname;            // '/' (www.teknohane.net) veya '/teknohane/' (eski alt yol)
const KABUK_ANAHTARI = BASE + 'index.html';
const CEVRIMDISI = BASE + 'offline.html';
const NAV_TIMEOUT_MS = 4000;
const VARLIK_LIMIT = 120;
const ONYUKLE = [CEVRIMDISI, BASE + 'manifest.json', BASE + 'teknohane.png', BASE + 'icons/icon-192.png', BASE + 'icons/apple-touch-icon-180.png'];
const VARLIK_YOLLARI = [BASE + 'icons/', BASE + 'katalog-gorselleri/', BASE + 'teknohane.png', BASE + 'teknohane-sohbet.png', BASE + 'manifest.json'];
const AYNI_KOKEN = self.location.origin;

const kabukIstegi = (url) => url.pathname === BASE || url.pathname === KABUK_ANAHTARI;
// Kabuk yalnızca gerçekten Teknohane kabuğuysa geçerlidir (captive portal/proxy 200 ile başka sayfa dönebilir).
async function gecerliKabukMu(res) {
  if (!onbellegeYazilabilir(res) || !/text\/html/i.test(res.headers.get('content-type') || '')) return false;
  const t = await res.clone().text();
  return t.length > 50000 && t.includes('<title>Teknohane');
}
const onbellegeYazilabilir = (res) => !!res && res.status === 200 && res.type === 'basic' && !res.redirected && !/no-store/i.test(res.headers.get('cache-control') || '');

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil((async () => {
    // Kurulum HİÇBİR dosya yüzünden başarısız olmaz (tek tek denenir); kabuk yalnızca başarılı yanıtla yazılır.
    const varlik = await caches.open(VARLIK_ONBELLEK);
    await Promise.all(ONYUKLE.map((u) => fetch(u, { cache: 'reload' }).then((r) => (onbellegeYazilabilir(r) ? varlik.put(u, r) : null)).catch(() => null)));
    try {
      const r = await fetch(BASE, { cache: 'reload' });
      if (await gecerliKabukMu(r)) await (await caches.open(KABUK_ONBELLEK)).put(KABUK_ANAHTARI, r);
    } catch (e) { /* çevrimdışı kurulum: kabuk ilk başarılı ziyarette yazılır */ }
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Eski sürümlerin önbellekleri silinir (yalnızca bu uygulamanın "teknohane-" önekli olanlar).
    const adlar = await caches.keys();
    await Promise.all(adlar.filter((n) => n.startsWith('teknohane-') && n !== KABUK_ONBELLEK && n !== VARLIK_ONBELLEK).map((n) => caches.delete(n)));
    await caches.delete('teknohane-shell-v4').catch(() => {});
    await self.clients.claim();
  })());
});

// Sayfa → SW: kabuğun güncel olup olmadığını denetle ('kabuk-denetle'); yeni sürüm varsa sayfaya 'kabuk-guncellendi' bildirilir.
self.addEventListener('message', (event) => {
  const d = event.data || {};
  if (d.tip === 'kabuk-denetle') event.waitUntil(kabukDenetle(event.source));
  if (d.tip === 'temizle') event.waitUntil(caches.keys().then((n) => Promise.all(n.filter((x) => x.startsWith('teknohane-')).map((x) => caches.delete(x)))));
});

async function kabukDenetle(istemci) {
  try {
    const yeni = await fetch(BASE, { cache: 'no-cache' });
    if (!(await gecerliKabukMu(yeni))) return;
    const kabuk = await caches.open(KABUK_ONBELLEK), eski = await kabuk.match(KABUK_ANAHTARI);
    const yeniMetin = await yeni.clone().text(), eskiMetin = eski ? await eski.text() : '';
    await kabuk.put(KABUK_ANAHTARI, yeni);
    if (eski && yeniMetin !== eskiMetin && istemci) istemci.postMessage({ tip: 'kabuk-guncellendi' });
  } catch (e) { /* ağ yok: sessiz */ }
}

const zamanAsimi = (ms) => new Promise((r) => setTimeout(() => r(null), ms));

async function kabukYaniti(event) {
  const kabuk = await caches.open(KABUK_ONBELLEK);
  const cached = await kabuk.match(KABUK_ANAHTARI);
  // Ağ isteği: HTTP önbelleğini atlayıp doğrulama yapar (GitHub Pages max-age=600 yüzünden 10 dk eski kabuk gelmesin). Kabuk URL'si arama parametresi (?tc=…) taşıyabilir; yanıt aynı kabuktur.
  const ag = (async () => {
    const res = await fetch(new Request(event.request.url, { cache: 'no-cache', credentials: 'same-origin', redirect: 'follow' }));
    const gecerli = await gecerliKabukMu(res);
    if (gecerli) await kabuk.put(KABUK_ANAHTARI, res.clone());
    return { res, gecerli };
  })();
  const bekle = async (promise) => { try { return await promise; } catch (e) { return null; } };
  const cevrimdisi = async () => (await caches.match(CEVRIMDISI)) || new Response('Çevrimdışı', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  let sonuc;
  if (cached) {
    sonuc = await Promise.race([bekle(ag), zamanAsimi(NAV_TIMEOUT_MS)]);
    if (!sonuc) { event.waitUntil(bekle(ag)); return cached; }          // yavaş/askıda ağ: son iyi kabuk (ağ arka planda sürer)
  } else {
    sonuc = await bekle(ag);
    if (!sonuc) return cevrimdisi();                                     // ağ yok ve hiç kabuk yok: çevrimdışı bilgi sayfası
  }
  const { res, gecerli } = sonuc;
  if (gecerli) return res.redirected ? Response.redirect(res.url, 302) : res;   // Safari: yönlendirilmiş yanıtı navigasyona doğrudan vermeyi reddeder
  if (cached) return cached;                                             // 5xx / captive portal / bozuk yanıt: iyi kabuk korunur
  if (res.status >= 500 || res.status === 200) return cevrimdisi();
  return res;                                                            // gerçek 4xx (ör. 404): olduğu gibi
}

async function varlikSWR(event) {
  const req = event.request, onb = await caches.open(VARLIK_ONBELLEK), cached = await onb.match(req);
  const ag = fetch(req).then(async (res) => {
    if (onbellegeYazilabilir(res)) {
      await onb.put(req, res.clone());
      const anahtarlar = await onb.keys(); if (anahtarlar.length > VARLIK_LIMIT) await Promise.all(anahtarlar.slice(0, anahtarlar.length - VARLIK_LIMIT).map((k) => onb.delete(k)));   // en eski girdiler silinir
    }
    return res;
  });
  if (cached) { event.waitUntil(ag.catch(() => null)); return cached; }
  return ag;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== AYNI_KOKEN) return;                                   // Firebase / Cloudflare Worker / Google / CDN: ağdan, SW dokunmaz

  if (req.mode === 'navigate') {
    if (kabukIstegi(url)) { event.respondWith(kabukYaniti(event)); return; }
    // Diğer sayfalar (auth-action, go, sartlar, cocuk-guvenligi …): ağdan; ağ YOKSA çevrimdışı bilgi sayfası. ASLA önbelleğe yazılmaz (e-posta doğrulama kodları vb. saklanmaz).
    event.respondWith(fetch(req).catch(async () => (await caches.match(CEVRIMDISI)) || new Response('Çevrimdışı', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } })));
    return;
  }
  if (url.pathname === BASE + 'sw.js') return;
  if (VARLIK_YOLLARI.some((p) => (p.endsWith('/') ? url.pathname.startsWith(p) : url.pathname === p))) { event.respondWith(varlikSWR(event)); return; }
  // diğer aynı köken istekler: SW karışmaz (ağ)
});
