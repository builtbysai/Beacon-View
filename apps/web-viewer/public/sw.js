// Beacon SecureView service worker.
//
// Scope is deliberately narrow: this only makes the static app shell
// installable and resilient to a flaky connection. It must never cache
// or intercept anything that carries live camera state:
//   - /api/* (session cookies, live camera/device data)
//   - the /api/events WebSocket upgrade (not interceptable anyway)
//   - WebRTC signaling / media, which never goes through fetch()
const CACHE_VERSION = 'beacon-shell-v1';
const APP_SHELL = ['/', '/manifest.webmanifest', '/favicon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_VERSION)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isApiRequest(url) {
  return url.pathname.startsWith('/api/');
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isApiRequest(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match('/').then((cached) => cached ?? Response.error()),
      ),
    );
    return;
  }

  if (
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/icons/')
  ) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              void caches
                .open(CACHE_VERSION)
                .then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});

self.addEventListener('push', (event) => {
  let payload;
  try {
    payload = event.data?.json();
  } catch {
    return;
  }
  if (!payload || payload.version !== '1') return;
  const copy = {
    motion: 'Beacon detected activity.',
    offline: 'A Beacon camera needs attention.',
    recovered: 'A Beacon camera is back online.',
    health: 'A Beacon camera has a battery or heat warning.',
    security: 'A security event occurred on your Beacon account.',
  };
  if (!copy[payload.category]) return;
  const route = payload.route === 'settings' ? '/settings' : '/activity';
  // Opening an alert asks the server which camera it was about (ADR 0090);
  // the push itself carries only this opaque ID.
  const alertId = /^[A-Za-z0-9_-]{1,128}$/.test(String(payload.eventId || ''))
    ? String(payload.eventId)
    : '';
  event.waitUntil(
    self.registration.showNotification('Beacon', {
      body: copy[payload.category],
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: {
        route:
          route === '/activity' && alertId
            ? `${route}?alert=${alertId}`
            : route,
      },
      requireInteraction: payload.category === 'security',
      tag: `beacon-${String(payload.eventId || 'update')}`,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const route = event.notification.data?.route || '/activity';
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        const existing = clients.find(
          (client) => new URL(client.url).origin === self.location.origin,
        );
        if (existing) {
          existing.navigate(route);
          return existing.focus();
        }
        return self.clients.openWindow(route);
      }),
  );
});
