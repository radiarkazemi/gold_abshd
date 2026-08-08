/* Admin notification service worker.
   - Shows a brief heads-up / popup card (not sound-only)
   - Prefers custom in-app sound via open clients; OS default only as fallback
   - Handles Web Push when the panel is backgrounded / phone locked
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

function notifyClients(message) {
  return self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((all) => {
    for (const client of all) {
      try {
        client.postMessage(message);
      } catch {
        /* ignore */
      }
    }
    return all;
  });
}

/**
 * Brief-mode popup: rich notification with actions + image so Android
 * heads-up / Samsung "brief" style shows a card, not sound-only.
 */
function showAdminNotification(title, options) {
  const opts = options || {};
  const icon = opts.icon ? absoluteUrl(opts.icon) : absoluteUrl("/gt-icon-192.png");
  const image = opts.image ? absoluteUrl(opts.image) : icon;
  const kind = (opts.data && opts.data.type) || "new_order";
  const finalOpts = {
    body: opts.body || "اعلان جدید از پنل مدیریت",
    dir: "rtl",
    lang: "fa",
    tag: opts.tag || `admin-alert-${Date.now()}`,
    renotify: true,
    // Helps Android show a persistent/heads-up card instead of sound-only.
    requireInteraction: true,
    // When a client will play our custom WAV, suppress the OS default ding.
    silent: opts.silent === true,
    vibrate: opts.vibrate || (kind === "new_kyc"
      ? [160, 80, 160, 80, 280]
      : [280, 120, 180, 120, 280, 120, 400]),
    icon,
    badge: opts.badge ? absoluteUrl(opts.badge) : icon,
    image,
    actions: opts.actions || [
      { action: "open", title: "مشاهده" },
      { action: "dismiss", title: "بستن" },
    ],
    data: { url: ADMIN_PATH, kind, ...(opts.data || {}) },
    timestamp: Date.now(),
  };
  // Non-standard; ignored on most Android builds, harmless elsewhere.
  if (opts.sound) finalOpts.sound = absoluteUrl(opts.sound);
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
    type: "new_order",
    data: { url: ADMIN_PATH, type: "new_order" },
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

  const kind = payload.type || payload.data?.type || "new_order";
  const soundPath = kind === "new_kyc" ? "/notify-kyc.wav" : "/notify-order.wav";

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      let focused = false;
      for (const client of clients) {
        try {
          if (client.focused) focused = true;
          client.postMessage({
            type: "ADMIN_PUSH_ALERT",
            kind,
            title: payload.title,
            body: payload.body,
            data: payload.data,
          });
        } catch {
          /* ignore */
        }
      }

      // Panel in front: in-app brief card + custom WAV only (no OS ding/card).
      if (focused) return;

      // Background tab/PWA still alive: mute OS ding (client plays custom WAV)
      // but still show the OS brief popup card.
      // Fully closed: OS popup + OS sound (web apps cannot replace system sound).
      const hasClient = clients.length > 0;
      await showAdminNotification(payload.title || "آبشده قصر طلا", {
        body: payload.body || "اعلان جدید از پنل مدیریت",
        tag: payload.tag || `${kind}-${Date.now()}`,
        icon: payload.icon || "/gt-icon-192.png",
        badge: payload.badge || "/gt-icon-192.png",
        image: payload.image || payload.icon || "/gt-icon-192.png",
        vibrate: payload.vibrate,
        data: { ...(payload.data || {}), type: kind, url: ADMIN_PATH },
        silent: hasClient,
        sound: soundPath,
        requireInteraction: true,
        renotify: true,
      });
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  const action = event.action;
  if (action === "dismiss") {
    event.notification.close();
    return;
  }
  event.notification.close();
  const url =
    (event.notification.data && event.notification.data.url) || ADMIN_PATH;
  event.waitUntil(openAdminPanel(url));
});

self.addEventListener("notificationclose", () => {});
