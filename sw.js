// Service worker: guarda la app en caché para que funcione sin conexión.
// Sube la versión cada vez que cambies algún archivo para que los móviles se actualicen.
const CACHE = 'gym-v4';
const FILES = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Red primero (para recibir actualizaciones), caché si no hay conexión
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});

// Aviso de fin de descanso enviado por el servidor (llega aunque la app esté cerrada)
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch {}
  e.waitUntil(self.registration.showNotification(data.title || '⏱ ¡Descanso terminado!', {
    body: data.body || 'A por la siguiente serie 💪',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    tag: 'rest-timer',
    renotify: true,
    requireInteraction: false,
    vibrate: [300, 150, 300, 150, 300],
  }));
});

// Al tocar la notificación, vuelve a la app
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (all.length) return all[0].focus();
    return self.clients.openWindow('./');
  })());
});
