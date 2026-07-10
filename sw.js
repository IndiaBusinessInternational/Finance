const CACHE = 'ibi-finance-v2.9.0';
const ASSETS = ['./index.html', './manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
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
