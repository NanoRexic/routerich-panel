'use strict';

const CACHE = 'routerich-panel-v1.2.2'
const ASSETS = [
  // index.html не precache — всегда свежая версия с сервера
  '/style.css',
  '/notifications.js',
  '/app.js',
  '/shortcut.js',
  '/zapret.js',
  '/icon.svg',
  '/manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  // CGI и навигация/index — всегда с сети (иначе iOS держит старый meta version)
  if (url.pathname.startsWith('/cgi-bin/')) return;
  const isNavigate = event.request.mode === 'navigate';
  const isIndex =
    url.pathname === '/' ||
    url.pathname.endsWith('/') ||
    url.pathname.endsWith('/index.html') ||
    url.pathname.endsWith('index.html');

  if (isNavigate || isIndex) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' }).catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    fetch(event.request).then((res) => {
      if (res.ok && url.origin === self.location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
      }
      return res;
    }).catch(() => caches.match(event.request))
  );
});