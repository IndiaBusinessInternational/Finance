const CACHE = 'ibi-finance-v5.28';
/* v5.28 / v6.29: actions column fit (page code only; no new files). */
/* v5.27 / v6.28: recurring entries (new page code; no new files). */
/* v5.26 / v4.16 / v6.27: the bank-logo tiles on the Balances cards, so an
   installed app still shows them offline. */
const BANK_LOGOS = ['axis', 'bob', 'canara', 'cub', 'federal', 'hdfc', 'icici', 'idfc', 'indianbank',
  'iob', 'indusind', 'kotak', 'kvb', 'pnb', 'sbi', 'tmb', 'union', 'yes'].map(k => './banklogos/' + k + '.png');
const ASSETS = ['./index.html', './manifest.json', './ibi-share.js'].concat(BANK_LOGOS);

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => Promise.all(
      ASSETS.map(u => fetch(new Request(u, {cache: 'reload'}))
        .then(r => r.ok ? c.put(u, r) : null)
        .catch(() => null))
    ))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if(e.request.url.includes('script.google.com') ||
     e.request.url.includes('fonts.googleapis.com') ||
     e.request.url.includes('fonts.gstatic.com') ||
     e.request.url.includes('cdn.jsdelivr.net')) {
    return; // Always fetch live for GAS, fonts, icons
  }
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
