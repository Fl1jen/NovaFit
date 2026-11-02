/* NovaFit service worker: офлайн-режим. При изменении файлов увеличь VERSION. */
const VERSION = 'novafit-v4';
const FILES = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/data-foods.js', 'js/data-recipes.js', 'js/data-exercises.js', 'js/nutrition.js', 'js/planner.js', 'js/workout.js', 'js/insights.js', 'js/scanner.js', 'js/vendor/zxing.min.js', 'js/app.js',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // свои файлы: сначала сеть (свежая версия), при офлайне — кэш; шрифты — кэш по мере загрузки
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok && (e.request.url.startsWith(self.location.origin) || e.request.url.includes('fonts.g'))) {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match('index.html')))
  );
});

// нажатие на уведомление открывает приложение (или переключает на уже открытое)
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ('focus' in c) return c.focus(); }
    return self.clients.openWindow ? self.clients.openWindow('./') : null;
  }));
});
