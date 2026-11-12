const VERSION = 'ao-v4';
const CORE = [
  './',
  './assets/favicon.svg',
  './assets/icons/apple-touch-icon.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/maskable-512.png',
  './css/arena.css',
  './css/game.css',
  './css/market.css',
  './css/marketmaker.css',
  './css/quantgym.css',
  './css/siege.css',
  './css/style.css',
  './css/warehouse.css',
  './games/alien.html',
  './games/arena.html',
  './games/marketmaker.html',
  './games/quant.html',
  './games/quantgym.html',
  './games/warehouse.html',
  './index.html',
  './js/about.js',
  './js/aim.js',
  './js/arena/avatar.js',
  './js/arena/game.js',
  './js/arena/maps.js',
  './js/arena/net.js',
  './js/arena/weapons.js',
  './js/arena/world.js',
  './js/builds.js',
  './js/content.js',
  './js/controls.js',
  './js/notify.js',
  './js/assist.js',
  './js/gyro.js',
  './js/main.js',
  './js/market/app.js',
  './js/market/data.js',
  './js/market/math.js',
  './js/marketmaker.js',
  './js/pwa.js',
  './js/quantgym.js',
  './js/sens.js',
  './js/siege.js',
  './js/stance.js',
  './js/warehouse.js',
  './games/alien.webmanifest',
  './games/arena.webmanifest',
  './games/marketmaker.webmanifest',
  './games/quant.webmanifest',
  './games/quantgym.webmanifest',
  './games/warehouse.webmanifest',
  './vendor/peerjs.min.js',
  './vendor/three.module.min.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== 'ao-fonts').map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open('ao-fonts').then(async (c) => (await c.match(req)) || fetch(req).then((r) => { c.put(req, r.clone()); return r; })));
    return;
  }
  if (url.origin !== location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((r) => { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); return r; })
      .catch(async () => (await caches.match(req, { ignoreSearch: true })) || caches.match('./index.html')));
    return;
  }
  e.respondWith(caches.open(VERSION).then(async (c) => {
    const hit = await c.match(req, { ignoreSearch: true });
    const net = fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
