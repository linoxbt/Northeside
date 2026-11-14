/* Northeside service worker: offline shell and web push. Kept minimal on purpose. */
const CACHE = "northeside-v2";
const SHELL = ["/", "/how-it-works", "/icon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

// Network first for pages (live data); fall back to the cached shell offline. Never cache the API.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).catch(() => caches.match("/").then((r) => r || Response.error())));
  }
});

self.addEventListener("push", (e) => {
  let data = { title: "Northeside", body: "", url: "/" };
  try {
    data = Object.assign(data, e.data ? e.data.json() : {});
  } catch (_) {}
  e.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon: "/icon.svg", data: { url: data.url } }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(self.clients.openWindow(url));
});
