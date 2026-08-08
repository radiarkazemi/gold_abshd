/* Admin notification service worker.
   - Shows OS notifications while the admin panel is backgrounded
   - Handles Web Push so mobile phones still alert (with sound) when
     the tab/PWA is suspended and the WebSocket is dead
   - Accepts SHOW_NOTIFICATION messages from the open admin page
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

const ADMIN_PATH = "/admin-hs-panel";

function absoluteUrl(path) {
  try {
    return new URL(path || ADMIN_PATH, self.location.origin).href;
  } catch {
    return path || ADMIN_PATH;
  }
}

function openAdminPanel(url) {
  const target = absoluteUrl(url || ADMIN_PATH);
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

function showAdminNotification(title, options) {
  const opts = options || {};
  const icon = opts.icon ? absoluteUrl(opts.icon) : absoluteUrl("/gt-icon-192.png");
  const finalOpts = {
    body: opts.body || "",
    dir: opts.dir || "rtl",
    lang: opts.lang || "fa",
    tag: opts.tag || `admin-alert-${Date.now()}`,
    renotify: opts.renotify !== false,
    requireInteraction: opts.requireInteraction !== false,
    silent: false,
    vibrate: opts.vibrate || [220, 100, 220, 100, 320],
    icon,
    badge: opts.badge ? absoluteUrl(opts.badge) : icon,
    data: { url: ADMIN_PATH, ...(opts.data || {}) },
  };
  return self.registration.showNotification(title || "آبشده قصر طلا", finalOpts);
}

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "SHOW_NOTIFICATION") {
    event.waitUntil(showAdminNotification(data.title, data.options));
  }
});

self.addEventListener("push", (event) => {
  let payload = {
    title: "آبشده قصر طلا",
    body: "اعلان جدید",
    tag: "admin-alert",
    data: { url: ADMIN_PATH },
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

  event.waitUntil(
    showAdminNotification(payload.title || "آبشده قصر طلا", {
      body: payload.body,
      tag: payload.tag,
      icon: payload.icon,
      badge: payload.badge,
      vibrate: payload.vibrate,
      data: payload.data,
      requireInteraction: true,
      renotify: true,
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url =
    (event.notification.data && event.notification.data.url) || ADMIN_PATH;
  event.waitUntil(openAdminPanel(url));
});

self.addEventListener("notificationclose", () => {});
