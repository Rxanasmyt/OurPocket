// Service worker: เปิดแอปได้แม้ออฟไลน์ (ออนไลน์จะดึงไฟล์ใหม่ก่อนเสมอ ออฟไลน์ค่อยใช้ของที่แคชไว้)
const CACHE = 'ourwallet-shell-v1';
const SHELL = ['./', 'index.html', 'tailwind.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const host = new URL(req.url).hostname;
  // ข้อมูลการเงินคุยกับ Apps Script โดยตรง ไม่ผ่านแคช
  if (host === 'script.google.com' || host.endsWith('googleusercontent.com')) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && (res.ok || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || (req.mode === 'navigate' ? caches.match('index.html') : Response.error())))
  );
});
