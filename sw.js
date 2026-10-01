/**
 * Service Worker：アプリ本体・メニュー画像をタブレット内にキャッシュし、
 * インターネットが切れても画面表示と注文入力ができるようにする。
 * ファイルを更新したら CACHE のバージョンを上げてください。
 */
const CACHE = 'yamaya-v1';
const PRECACHE = [
  './',
  './index.html',
  './config.js',
  './common/api.js',
  './common/base.css',
  './common/sw-register.js',
  './customer/',
  './customer/index.html',
  './customer/customer.css',
  './customer/customer.js',
  './kitchen/',
  './kitchen/index.html',
  './kitchen/kitchen.css',
  './kitchen/kitchen.js',
  './data/menu.json',
  './assets/icon.svg',
  './assets/menu/page-food.svg',
  './assets/menu/page-drink.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 同一オリジンのみ対象（GAS への通信はキャッシュしない）
// stale-while-revalidate：キャッシュを即返し、裏で最新を取得して次回に反映
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req)
        .then((res) => { if (res.ok) cache.put(req, res.clone()); return res; })
        .catch(() => null);
      if (cached) { e.waitUntil(network); return cached; }
      return (await network) || new Response('offline', { status: 503 });
    })
  );
});
