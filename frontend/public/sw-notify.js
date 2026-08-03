/* Admin notification service worker.
   - Shows OS notifications while the admin panel is backgrounded
   - Handles Web Push so mobile phones still alert (with sound) when
     the tab/PWA is suspended and the WebSocket is dead
   Query-string on the script URL (APP_BUILD_V) forces browsers to
   fetch a fresh SW on every deploy. */

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim();
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    })()
  );
});

function openAdminPanel(url) {
  const target = url || "/admin-hs-panel";
  return self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (all) => {
    for (const client of all) {
      try {
        const href = client.url || "";
        if (href.includes("/admin") && "focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            try {
              await client.navigate(target);
            } catch {
              /* ignore */
            }
          }
          return;
        }
      } catch {
        /* ignore */
      }
    }
    if (self.clients.openWindow) {
      await self.clients.openWindow(target);
    }
  });
}

self.addEventListener("push", (event) => {
  let payload = {
    title: "آبشده قصر طلا",
    body: "اعلان جدید",
    tag: "admin-alert",
    data: { url: "/admin-hs-panel" },
  };
  try {
    if (event.data) {
      const parsed = event.data.json();
      payload = { ...payload, ...parsed, data: { ...payload.data, ...(parsed.data || {}) } };
    }
  } catch {
    try {
      payload.body = event.data ? event.data.text() : payload.body;
    } catch {
      /* ignore */
    }
  }

  const options = {
    body: payload.body || "",
    dir: "rtl",
    lang: "fa",
    tag: payload.tag || "admin-alert",
    renotify: true,
    requireInteraction: false,
    silent: false,
    vibrate: [220, 100, 220, 100, 320],
    icon: payload.icon || "/gt-icon-192.png",
    badge: payload.badge || "/gt-icon-192.png",
    data: payload.data || { url: "/admin-hs-panel" },
  };

  event.waitUntil(self.registration.showNotification(payload.title || "آبشده قصر طلا", options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/admin-hs-panel";
  event.waitUntil(openAdminPanel(url));
});
