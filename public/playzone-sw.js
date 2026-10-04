/* Service worker de notificaciones. No intercepta fetch ni almacena contraseñas. */
self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = {}; }
  const title = String(payload.title || 'PlayZone · Notificaciones');
  const body = String(payload.body || 'Tienes un recordatorio pendiente.');
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: '/playzone-icon.svg',
    badge: '/playzone-icon.svg',
    tag: String(payload.tag || 'playzone-recordatorio'),
    renotify: false,
    data: { url: '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find((item) => new URL(item.url).origin === self.location.origin);
    if (existing) { await existing.focus(); return; }
    await clients.openWindow('/');
  })());
});
