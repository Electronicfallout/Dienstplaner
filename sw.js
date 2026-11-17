// Offline-Unterstützung: App-Dateien und Bibliotheken zwischenspeichern.
// Dropbox-Aufrufe werden nie zwischengespeichert.
const VERSION = 'dp-v30';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/main.js', 'js/app.js', 'js/calc.js', 'js/crypto.js', 'js/storage.js', 'js/store.js', 'js/model.js', 'js/ui.js', 'js/import-excel.js', 'js/keystore.js', 'js/notify.js', 'js/ics.js', 'js/pdf.js', 'js/proposals.js', 'js/saturday.js',
  'js/views/plan.js', 'js/views/month.js', 'js/views/times.js', 'js/views/vacation.js', 'js/views/settings.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-180.png',
  'vendor/xlsx.full.min.js', 'vendor/qrcode.js', 'vendor/jspdf.umd.min.js', 'vendor/jspdf.plugin.autotable.min.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.hostname.endsWith('dropboxapi.com') || url.hostname.endsWith('dropbox.com')) return;
  if (url.origin !== location.origin) return;
  // Netz zuerst (damit Updates sofort ankommen), sonst Zwischenspeicher
  e.respondWith(
    // Browser-Cache umgehen (GitHub Pages hält Dateien sonst bis zu 10 min)
    fetch(new Request(url.href, { cache: 'no-cache', credentials: 'same-origin' })).then((r) => {
      if (r.ok) { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || (e.request.mode === 'navigate' ? caches.match('index.html') : Response.error())))
  );
});
