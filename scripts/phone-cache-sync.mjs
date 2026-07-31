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

function slugFor(brand, name) {
  return `${brand || ''}-${name || ''}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
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

function normalizeDetail(brand, matchedName, detail) {
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

  return {
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
  const normalized = normalizeDetail(brand, name, detailData);
  await fsCall({ op: 'patch', path: `teknohane_phone_specs/${id}`, fields: normalized, fieldPaths: Object.keys(normalized) });
  return { status: 'cached' };
}

// Organik kullanıcı talepleri tükendiğinde, ayda 48 isteklik bütçenin geri kalanını rastgele
// gezinmeyi beklemeden en çok aranması muhtemel amiral gemisi telefonlara ayırır.
const SEED_LIST = [
  { brand: 'Apple', name: 'iPhone 16 Pro Max' }, { brand: 'Apple', name: 'iPhone 16 Pro' },
  { brand: 'Apple', name: 'iPhone 16' }, { brand: 'Apple', name: 'iPhone 15' },
  { brand: 'Samsung', name: 'Galaxy S24 Ultra' }, { brand: 'Samsung', name: 'Galaxy S24' },
  { brand: 'Samsung', name: 'Galaxy A55' }, { brand: 'Samsung', name: 'Galaxy Z Fold6' },
  { brand: 'Xiaomi', name: 'Redmi Note 13 Pro' }, { brand: 'Xiaomi', name: '14 Ultra' },
  { brand: 'Xiaomi', name: 'Poco X6 Pro' }, { brand: 'Google', name: 'Pixel 9 Pro' },
  { brand: 'Google', name: 'Pixel 8' }, { brand: 'OnePlus', name: '12' },
  { brand: 'Huawei', name: 'P60 Pro' }, { brand: 'Oppo', name: 'Reno 11' },
  { brand: 'Vivo', name: 'V30' }, { brand: 'Realme', name: '12 Pro' },
  { brand: 'Nothing', name: 'Phone 2' }, { brand: 'Honor', name: 'Magic 6 Pro' },
];

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

  console.log('Kuyruk boş ve tüm tohum telefonlar zaten önbellekte.');
}

main().catch(e => { console.error(e); process.exit(1); });
