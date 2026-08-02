/* Minimal service worker: show admin order notifications when the
   page is backgrounded (mobile PWA / Windows). No offline caching.
   Query-string on the script URL (APP_BUILD_V) forces browsers to
   fetch a fresh SW on every deploy so clients auto-reload. */

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim();
      // Drop any stale caches so updated assets/icons are fetched next time.
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of all) {
        if ("focus" in client) {
          await client.focus();
          return;
        }
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow("/admin-hs-panel");
      }
    })()
  );
});
