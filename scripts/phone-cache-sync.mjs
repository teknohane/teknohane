// teknohane-phones veri kaynağı — MobileAPI.dev'e yapılan GERÇEK ağ çağrısı kasıtlı olarak
// BURADA (GitHub Actions runner'ında), Cloudflare Workers'ın DIŞINDA yapılıyor.
//
// SEBEP (canlı testle doğrulandı): MobileAPI.dev'in kendi Cloudflare zone'u, Workers'tan gelen
// alt-istekleri sessizce reddediyor (boş gövdeli HTTP 400) — muhtemelen Bot Fight Mode/WAF,
// Cloudflare'ın Worker alt-isteklerine eklediği 'cf-worker' başlığını tespit edip engelliyor.
// Aynı istek düz bir sunucudan (curl, bu script'in çalıştığı GitHub Actions runner'ı gibi)
// sorunsuz çalışıyor. Bu yüzden gerçek arama/detay çağrıları burada yapılıp sonuç, paylaşılan
// sırla korunan teknohane-push Worker'ının /internal/fs ucu üzerinden Firestore'a yazılıyor
// (bkz. cloudflare-push-worker.js ve phones-worker/worker.js).
//
// Her çalıştırma (workflow her 30 dakikada bir tetiklenir) EN FAZLA TEK bir telefonu işler —
// hem MobileAPI.dev'in dakikada 5 istek sınırını (arama+detay = 2 istek/telefon) hem de aylık
// 50 istek kotasını doğal olarak zamana yayarak korumak için kasıtlı bir tercih.

const PUSH_WORKER_URL = (process.env.PUSH_WORKER_URL || 'https://teknohane-push.yusuf-aykac.workers.dev') + '/internal/fs';
const INTERNAL_KEY = process.env.INTERNAL_SHARED_KEY;
const MOBILEAPI_KEY = process.env.MOBILEAPI_KEY;
const MONTHLY_SAFE_LIMIT = 48;

if (!INTERNAL_KEY || !MOBILEAPI_KEY) {
  console.error('INTERNAL_SHARED_KEY veya MOBILEAPI_KEY secret\'ı eksik.');
  process.exit(1);
}

async function fsCall(body) {
  const res = await fetch(PUSH_WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Key': INTERNAL_KEY },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error('fs vekil hatası: ' + JSON.stringify(data));
  return data;
}

// BULUNAN HATA (2026-09-11): '+' tamamen siliniyordu, "Galaxy S25+"="Galaxy S25" gibi çakışan id'ler
// üretiyordu — index.html/phones-worker/worker.js'deki AYNI düzeltmeyle senkron.
function slugFor(brand, name) {
  return `${brand || ''}-${name || ''}`.toLowerCase().replace(/\+/g, 'plus').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function currentMonthKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function getQuota() {
  const { doc } = await fsCall({ op: 'get', path: 'teknohane_settings/mobileApiQuota' });
  const month = currentMonthKey();
  const used = (doc && doc.month === month) ? (doc.used || 0) : 0;
  return { month, used };
}

async function bumpQuota(quota, amount) {
  await fsCall({
    op: 'patch', path: 'teknohane_settings/mobileApiQuota',
    fields: { month: quota.month, used: quota.used + amount },
    fieldPaths: ['month', 'used']
  });
}

// En yüksek match_certainty'e göre sıralar; marka verilmişse manufacturer_name'i tutan
// en üstteki sonucu tercih eder — MobileAPI.dev'in "Marka Model" birleşik sorgularda çok
// kötü eşleştiğini (ör. "Samsung Galaxy S24 Ultra" alakasız eski modeller döndürüyor), ama
// yalnızca "Galaxy S24 Ultra" ile birebir doğru sonucu ilk sırada verdiğini doğrulayan canlı
// testler sonucunda sorgudan marka kasıtlı olarak ÇIKARILDI (bkz. aşağıdaki arama çağrısı).
function pickBestMatch(devices, brand) {
  if (!devices.length) return null;
  const sorted = [...devices].sort((a, b) => parseFloat(b.match_certainty || 0) - parseFloat(a.match_certainty || 0));
  if (brand) {
    const brandMatch = sorted.find(d => (d.manufacturer_name || '').toLowerCase().includes(brand.toLowerCase()));
    if (brandMatch) return brandMatch;
  }
  return sorted[0];
}

function parseYear(releaseDate) {
  const m = String(releaseDate || '').match(/(\d{4})/);
  return m ? parseInt(m[1], 10) : null;
}

function parseRamStorage(memoryInternal) {
  const s = String(memoryInternal || '');
  const ramM = s.match(/([\d./]+)\s*GB\s*RAM/i);
  const stM = s.match(/([\d./]+)\s*(GB|TB)\b/i);
  return {
    ram: ramM ? ramM[1].split('/')[0] + 'GB' : null,
    storage: stM ? stM[1].split('/')[0] + stM[2].toUpperCase() : null
  };
}

// Veri kalitesi/"confidence" — Telefon Platformu 2.0 (2026-08-23). Yeni bir dış doğrulama kaynağı
// EKLENMEDİ (spec: kaynak doğrulanmadan otomatik yayın yapma) — bunun yerine MobileAPI.dev'in KENDİ
// eşleştirme kesinliği (match_certainty, arama sonucundan) ile bu normalizasyondan çıkan temel
// alanların doluluğu birleştirilerek 0-100 arası şeffaf bir puan üretiliyor. >=80 admin panelinde
// "güvenilir" olarak işaretlenir (bkz. Teknohane-Yonetim'deki phoneQualityScore — İKİ FARKLI puan,
// KARIŞTIRILMASIN: buradaki dataConfidence eşleştirme+API güvenilirliği, admin panelindeki
// phoneQualityScore ise saklanan ALANLARIN doluluğu — ikisi birbirini tamamlıyor, aynı şey değil).
function computeConfidence(matchCertainty, normalized) {
  const fields = ['chip','ram','storage','cam','bat','scr','wt','os','imageUrl'];
  const filled = fields.filter(k => normalized[k]).length;
  const completeness = (filled / fields.length) * 100;
  const certainty = matchCertainty != null ? parseFloat(matchCertainty) : 70; // API kesinlik vermiyorsa temkinli orta değer
  return Math.round(completeness * 0.6 + Math.min(100, certainty) * 0.4);
}

function normalizeDetail(brand, matchedName, detail, matchCertainty) {
  const platform = detail.platform || {};
  const memory = detail.memory || {};
  const display = detail.display || {};
  const mainCam = detail.main_camera || {};
  const misc = detail.misc || {};

  const { ram, storage } = parseRamStorage(memory.internal);
  const sizeM = String(display.size || '').match(/([\d.]+)/);
  const hzM = String(display.type || '').match(/(\d+)\s*Hz/i);
  const scr = sizeM ? `${sizeM[1]}"${hzM ? ' ' + hzM[1] + 'Hz' : ''}` : (display.size || null);
  const camMps = [...String(mainCam.modules || detail.camera || '').matchAll(/(\d+)\s*MP/gi)].map(m => m[1]);

  const normalized = {
    brand: brand || detail.manufacturer_name || null,
    name: matchedName || detail.name,
    yr: parseYear(detail.release_date),
    chip: platform.chipset || (detail.hardware_parsed && detail.hardware_parsed.chipset) || detail.hardware || null,
    ram, storage,
    cam: camMps.length ? camMps.join('+') + 'MP' : (detail.camera || null),
    bat: detail.battery_capacity || null,
    scr,
    wt: detail.weight || null,
    os: (platform.os || '').split(',')[0].trim() || null,
    intlPrice: misc.price || null,
    imageUrl: detail.image_url || null,
  };
  return {
    ...normalized,
    dataConfidence: computeConfidence(matchCertainty, normalized),
    raw: {
      network: detail.network || null,
      body: detail.body || null,
      display: display || null,
      platform: platform || null,
      memory: memory || null,
      main_camera: mainCam || null,
      selfie_camera: detail.selfie_camera || null,
      sound: detail.sound || null,
      comms: detail.comms || null,
      features: detail.features || null,
      battery: detail.battery || null,
      misc: misc || null,
      description: detail.description || null,
      colors: detail.colors || null,
      model_numbers: misc.model_numbers || detail.model_numbers || null
    },
    source: 'mobileapi',
    mobileApiId: detail.id || null,
    cachedAt: new Date().toISOString()
  };
}

async function cachePhone(brand, name, quota) {
  const id = slugFor(brand, name);

  const searchRes = await fetch(`https://api.mobileapi.dev/devices/search?name=${encodeURIComponent(name)}&key=${MOBILEAPI_KEY}`);
  if (searchRes.status === 429) return { status: 'rate_limited' };
  const searchData = await searchRes.json();
  if (!searchRes.ok) throw new Error('MobileAPI arama hatası: ' + JSON.stringify(searchData));

  const best = pickBestMatch(searchData.devices || [], brand);
  if (!best) {
    await bumpQuota(quota, 1);
    await fsCall({
      op: 'patch', path: `teknohane_phone_specs/${id}`,
      fields: { notFound: true, checkedAt: new Date().toISOString() },
      fieldPaths: ['notFound', 'checkedAt']
    });
    return { status: 'not_found' };
  }

  const detailRes = await fetch(`https://api.mobileapi.dev/devices/${best.id}?key=${MOBILEAPI_KEY}`);
  if (detailRes.status === 429) { await bumpQuota(quota, 1); return { status: 'rate_limited' }; }
  const detailData = await detailRes.json();
  if (!detailRes.ok) throw new Error('MobileAPI detay hatası: ' + JSON.stringify(detailData));

  await bumpQuota(quota, 2);
  const normalized = normalizeDetail(brand, name, detailData, best.match_certainty);
  await fsCall({ op: 'patch', path: `teknohane_phone_specs/${id}`, fields: normalized, fieldPaths: Object.keys(normalized) });
  return { status: 'cached', dataConfidence: normalized.dataConfidence };
}

// Organik kullanıcı talepleri tükendiğinde, ayda 48 isteklik bütçenin geri kalanını rastgele
// gezinmeyi beklemeden en çok aranması muhtemel amiral gemisi telefonlara ayırır. Telefon Platformu
// 2.0 güncellemesiyle (2026-08-23) güncel nesle (S26/iPhone 17/Pixel 10 dönemi — bkz. legacy-
// catalog.js'teki en yeni kayıtlar) taşındı; ESKİ nesil (S24/iPhone 16 vb.) satırlar BİLİNÇLİ olarak
// silinmedi, yalnızca listenin SONUNA itildi — hâlâ çok aranan modeller, kota izin verdikçe onlar da
// zenginleştirilmeye devam etsin diye (script zaten önbellekte olanı `continue` ile atlıyor, bu
// yüzden fazladan satır eklemek zararsız, yalnızca daha geniş bir OLASILIK havuzu sağlıyor).
const SEED_LIST = [
  // Güncel nesil amiral gemileri
  { brand: 'Apple', name: 'iPhone 17 Pro Max' }, { brand: 'Apple', name: 'iPhone 17 Pro' },
  { brand: 'Apple', name: 'iPhone 17' }, { brand: 'Apple', name: 'iPhone Air' },
  { brand: 'Samsung', name: 'Galaxy S26 Ultra' }, { brand: 'Samsung', name: 'Galaxy S26' },
  { brand: 'Samsung', name: 'Galaxy Z Fold8' }, { brand: 'Samsung', name: 'Galaxy Z Flip8' },
  { brand: 'Samsung', name: 'Galaxy A57' },
  { brand: 'Xiaomi', name: '17 Pro' }, { brand: 'Xiaomi', name: 'Redmi Note 15 Pro+' },
  { brand: 'Xiaomi', name: 'POCO F7' },
  { brand: 'Google', name: 'Pixel 10 Pro' }, { brand: 'Google', name: 'Pixel 10' },
  { brand: 'Google', name: 'Pixel 10 Pro Fold' },
  { brand: 'OnePlus', name: '15' }, { brand: 'OnePlus', name: '13T' },
  { brand: 'Oppo', name: 'Find X9 Pro' }, { brand: 'Vivo', name: 'X300 Pro' },
  { brand: 'Realme', name: 'GT 8 Pro' }, { brand: 'Nothing', name: 'Phone 3' },
  { brand: 'Honor', name: 'Magic 8 Pro' }, { brand: 'Huawei', name: 'Mate 80 Pro' },
  { brand: 'Asus', name: 'ROG Phone 10' },
  // Önceki nesil — hâlâ aranıyor, kota izin verdikçe sırada
  { brand: 'Apple', name: 'iPhone 16 Pro Max' }, { brand: 'Apple', name: 'iPhone 16' },
  { brand: 'Samsung', name: 'Galaxy S24 Ultra' }, { brand: 'Samsung', name: 'Galaxy A55' },
  { brand: 'Xiaomi', name: 'Redmi Note 13 Pro' }, { brand: 'Xiaomi', name: '14 Ultra' },
  { brand: 'Google', name: 'Pixel 9 Pro' }, { brand: 'OnePlus', name: '12' },
  { brand: 'Oppo', name: 'Reno 11' }, { brand: 'Vivo', name: 'V30' },
  { brand: 'Realme', name: '12 Pro' }, { brand: 'Honor', name: 'Magic 6 Pro' },
];

// FAZ 6 — otomatik yeni-çıkış keşfi (2026-09-11, kullanıcı onaylı TEMKİNLİ yaklaşım). SEED_LIST'in
// aksine elle güncellenmeyi GEREKTİRMEZ: MobileAPI.dev'in /devices/by-year/ ucuyla bu yılın gerçekten
// yeni telefonlarını haftada YALNIZCA BİR kez (kuyruk VE tohum listesi tükendiğinde, en düşük öncelik
// olarak) kontrol eder. Sıralama MobileAPI.dev belgelerinde GARANTİ EDİLMEMİŞ — bu yüzden yalnızca
// 1. sayfa (50 cihaz) çekiliyor, tam kapsama İDDİA EDİLMİYOR; haftalık tekrarlarla zamanla organik
// bir kapsama oluşur. by-year ucu telefon DIŞI cihazları da (tablet/laptop/wearable) döner ve bir
// "device_type" alanı YOK — bu yüzden hem TAKİP EDİLEN marka listesine (SEED_LIST'teki markalar) hem
// de basit isim-tabanlı bir dışlama listesine göre süzülüyor. En fazla 3 yeni aday kuyruğa eklenir
// (organik kullanıcı taleplerini "boğmamak" için bilinçli bir üst sınır — kuyruk zaten en eski istek
// önce işleniyor, bu yüzden gerçek bir kullanıcı talebi her zaman önce işlenir).
const TRACKED_BRANDS = new Set(SEED_LIST.map(p => p.brand.toLowerCase()));
const NON_PHONE_NAME_HINTS = ['pad', 'macbook', 'imac', 'watch', 'tablet', 'buds', 'book', 'airpods', 'pencil', 'chromebook', 'monitor'];
function looksLikePhone(name) {
  const n = (name || '').toLowerCase();
  return !NON_PHONE_NAME_HINTS.some(h => n.includes(h));
}

async function runYearlyDiscovery(quota) {
  const stateRes = await fsCall({ op: 'get', path: 'teknohane_settings/phoneDiscoveryState' });
  const lastRunAt = stateRes.doc?.lastRunAt ? new Date(stateRes.doc.lastRunAt).getTime() : 0;
  if (Date.now() - lastRunAt < 7 * 24 * 60 * 60 * 1000) {
    console.log('Yeni-çıkış keşfi bu hafta zaten çalıştı, atlanıyor.');
    return;
  }
  await fsCall({
    op: 'patch', path: 'teknohane_settings/phoneDiscoveryState',
    fields: { lastRunAt: new Date().toISOString() }, fieldPaths: ['lastRunAt']
  });

  const year = new Date().getUTCFullYear();
  const res = await fetch(`https://api.mobileapi.dev/devices/by-year/?year=${year}&page=1&key=${MOBILEAPI_KEY}`);
  if (res.status === 429) { console.log('Keşif sırasında rate limit, sonraki haftaya bırakıldı.'); return; }
  const data = await res.json();
  if (!res.ok) { console.error('by-year hatası:', JSON.stringify(data)); return; }
  await bumpQuota(quota, 1);

  const candidates = (data.devices || [])
    .filter(d => TRACKED_BRANDS.has((d.manufacturer?.name || '').toLowerCase()) && looksLikePhone(d.name));

  let queued = 0;
  for (const d of candidates) {
    if (queued >= 3) break;
    const brand = d.manufacturer?.name;
    const id = slugFor(brand, d.name);
    // Zaten biliniyor mu (daha önce SEED_LIST'ten ya da başka bir keşiften önbelleklenmiş)? — atla.
    const cachedRes = await fsCall({ op: 'get', path: `teknohane_phone_specs/${id}` });
    if (cachedRes.doc) continue;
    console.log(`Yeni tespit (otomatik keşif): ${brand} ${d.name}`);
    await fsCall({
      op: 'patch', path: `teknohane_phone_lookup_requests/${id}`,
      fields: { brand, phoneName: d.name, requestedAt: new Date().toISOString(), discoveredVia: 'yearly_scan' },
      fieldPaths: ['brand', 'phoneName', 'requestedAt', 'discoveredVia']
    });
    queued++;
  }
  console.log(`Otomatik keşif: ${candidates.length} aday tarandı, ${queued} yeni telefon kuyruğa eklendi.`);
}

async function main() {
  const quota = await getQuota();
  if (quota.used + 2 > MONTHLY_SAFE_LIMIT) {
    console.log(`Aylık kota dolu (${quota.used}/${MONTHLY_SAFE_LIMIT}), bu çalıştırmada işlem yapılmadı.`);
    return;
  }

  // 1. Önce organik kullanıcı taleplerini işle (en eski istek önce).
  const { docs: pending } = await fsCall({ op: 'list', collectionId: 'teknohane_phone_lookup_requests', limit: 50 });
  pending.sort((a, b) => (a.requestedAt || '').localeCompare(b.requestedAt || ''));

  if (pending.length) {
    const req = pending[0];
    const id = req._id;
    console.log(`İşleniyor (kullanıcı talebi): ${req.brand || ''} ${req.phoneName}`);
    try {
      const result = await cachePhone(req.brand, req.phoneName, quota);
      console.log('Sonuç:', result.status);
      if (result.status !== 'rate_limited') {
        await fsCall({ op: 'delete', path: `teknohane_phone_lookup_requests/${id}` });
      }
    } catch (e) {
      console.error('Hata:', e.message);
    }
    return;
  }

  // 2. Kuyrukta bekleyen talep yoksa, henüz önbelleklenmemiş bir tohum telefonu işle.
  for (const p of SEED_LIST) {
    const id = slugFor(p.brand, p.name);
    const cachedRes = await fsCall({ op: 'get', path: `teknohane_phone_specs/${id}` });
    if (cachedRes.doc) continue;
    console.log(`İşleniyor (tohum): ${p.brand} ${p.name}`);
    try {
      const result = await cachePhone(p.brand, p.name, quota);
      console.log('Sonuç:', result.status);
    } catch (e) {
      console.error('Hata:', e.message);
    }
    return;
  }

  console.log('Kuyruk boş ve tüm tohum telefonlar zaten önbellekte — otomatik keşif kontrol ediliyor.');
  try {
    await runYearlyDiscovery(quota);
  } catch (e) {
    console.error('Otomatik keşif hatası:', e.message);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
