/* ══════════ SİF İSG — ÇEVRİMDIŞI KATMAN (service worker) ══════════
   Telefona "uygulama" olarak kurulduğunda şantiyede ağ yokken de açılsın diye.

   KURALLAR
   • SAYFA (HTML, uygulama.css, manifest) AĞ-ÖNCE: ağ varsa her açılışta taze dosya gelir, önbellek yalnız
     ağ yokken devreye girer. Tersini yapmak (önbellek-önce) "değişiklik gelmedi"
     şikâyetinin ta kendisi olurdu.
   • GÖRSELLER önbellekten verilir ve arkada tazelenir. MOTOR DOSYALARI (lib/ altındaki
     OCR ve PDF motoru) ile yazı tipleri ÖNBELLEK-ÖNCE: büyüktür, değişmezler.
   • VERİ ÖNBELLEĞE GİRMEZ (KVKK): yapay zekâ, posta, Airtable, SharePoint gibi
     dış uçlara giden istekler ve GET olmayan her istek OLDUĞU GİBİ geçer, hiçbir
     yanıtı saklanmaz. Olay kayıtları zaten uygulamanın kendi deposunda
     (localStorage / IndexedDB) durur; bu katman onlara dokunmaz.
   • Kabuk dosyaları değişince SURUM'ü yükselt: eski önbellek silinir. */
const SURUM = 'sif-isg-2026.09.28f';
const KABUK = [
  'hizli_olay_bildirimi.html',
  'manifest.json',
  'uygulama.css',
  'sif_jcb_logo.png',
  'human_silhouette_clean.png',
  'ikon/ikon_192.png',
  'ikon/ikon_512.png',
  'ikon/apple_touch_180.png',
  'ikon/favicon_32.png'
];
/* Önbelleğe alınabilecek DIŞ kaynaklar: yalnız yazı tipi ve kitaplık CDN'leri. */
const DIS_IZINLI = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SURUM).then(c => c.addAll(KABUK.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k.startsWith('sif-isg-') && k !== SURUM).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

/* Sayfa + görünüm (uygulama.css) + manifest: ağ-önce. CSS bayatken-tazele olsaydı
   her görsel düzeltme telefona ancak İKİNCİ açılışta gelirdi. */
function sayfaMi(req, url) {
  return req.mode === 'navigate' || /\.(html?|css|json)$/i.test(url.pathname);
}

/* Ağ-önce, 5 sn içinde cevap yoksa önbellek (şantiyede zayıf sinyal). */
function agOnce(req) {
  return new Promise(coz => {
    let bitti = false;
    const yedek = () => caches.match(req, { ignoreSearch: true })
      .then(r => r || caches.match('hizli_olay_bildirimi.html', { ignoreSearch: true }));
    const sure = setTimeout(() => { yedek().then(r => { if (r && !bitti) { bitti = true; coz(r); } }); }, 5000);
    /* no-cache: GitHub Pages dosyayı 10 dk tarayıcı önbelleğinde tutar; sunucuya
       sorarak (ETag) taze kopya alınır, değişmediyse 304 ile ucuz döner. */
    fetch(req, { cache: 'no-cache' }).then(r => {
      if (r && r.ok) { const k = r.clone(); caches.open(SURUM).then(c => c.put(req, k)); }
      clearTimeout(sure);
      if (!bitti) { bitti = true; coz(r); }
    }).catch(() => {
      clearTimeout(sure);
      yedek().then(r => { if (!bitti) { bitti = true; coz(r || Response.error()); } });
    });
  });
}

function onbellekOnce(req) {
  return caches.match(req).then(v => v || fetch(req).then(r => {
    if (r && (r.ok || r.type === 'opaque')) { const k = r.clone(); caches.open(SURUM).then(c => c.put(req, k)); }
    return r;
  }));
}

/* Önbellekteki kopyayı hemen ver, arkada tazele: logo/silüet değişirse bir
   SONRAKİ açılışta yenisi gelir, kimse eski görselde takılı kalmaz. */
function bayatkenTazele(req) {
  return caches.open(SURUM).then(c => c.match(req).then(v => {
    const ag = fetch(req).then(r => { if (r && r.ok) c.put(req, r.clone()); return r; }).catch(() => v);
    return v || ag;
  }));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;       // POST, parçalı istek: dokunma
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (url.pathname.indexOf('/__') >= 0) return;                     // sunucu uçları (/__mail, /__root)
    if (!url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
    const motor = url.pathname.indexOf('/lib/') >= 0;                 // OCR/PDF motoru ~11 MB: yeniden indirme
    e.respondWith(sayfaMi(req, url) ? agOnce(req) : (motor ? onbellekOnce(req) : bayatkenTazele(req)));
    return;
  }
  if (DIS_IZINLI.indexOf(url.hostname) >= 0) e.respondWith(onbellekOnce(req));
  /* geri kalan her dış istek (API'ler) önbelleksiz, olduğu gibi geçer */
});
