// Real-life Quest service worker: makes the app installable and opens instantly.
// Pages are network-first (always fresh when online, cached copy when offline).
// Supabase, fonts and CDN requests are never touched, so money and quest data are always live.
const CACHE = 'rlq-v3';
const SHELL = ['./', './index.html', './admin.html', './terms.html', './privacy.html', './manifest.webmanifest', './app.css',
  './js/core.js', './js/quests.js', './js/me.js', './js/social.js', './js/wallet.js', './js/planner.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './icons/favicon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('./index.html')))
  );
});

// Web Push from the send-push edge function: { title, body, link }.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Real-life Quest', {
    body: d.body || '',
    icon: './icons/icon-192.png',
    badge: './icons/favicon.png',
    data: { link: d.link || 'index.html' },
    lang: 'th'
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data && e.notification.data.link || 'index.html', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => c.url.split('#')[0] === url.split('#')[0]);
    if (open) { open.focus(); return open.navigate(url); }
    return self.clients.openWindow(url);
  }));
});
