/*
 * Blocky League service worker: standalone web build only.
 *
 * Registered from index.html only when the page is top-level (not in an iframe),
 * served over https, not on localhost, and has no ?portal= param. Portal builds
 * (CrazyGames, Poki, itch.io) strip the registration and do not ship this file.
 *
 * Strategy: cache-first for Vite's content-hashed files under assets/ (their URLs
 * change whenever their bytes change, so a cached copy can never be stale).
 * Everything else, including index.html, goes straight to the network, so a new
 * deploy is picked up on the next load.
 */
const CACHE = 'blocky-league-assets-v1';
const MAX_ENTRIES = 80;
// e.g. assets/index-BFz3k9_a.js, assets/lilita-one-latin-400-normal-Dk3Tt8xw.woff2
const HASHED = /\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('blocky-league-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trim(cache) {
  const keys = await cache.keys();
  // keys() is in insertion order: drop the oldest (old deploys' hashes) first.
  for (let i = 0; i < keys.length - MAX_ENTRIES; i++) await cache.delete(keys[i]);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !HASHED.test(url.pathname)) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') {
        await cache.put(req, res.clone());
        trim(cache);
      }
      return res;
    }),
  );
});
