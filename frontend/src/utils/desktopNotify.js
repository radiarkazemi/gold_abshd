/**
 * System notifications for the admin panel.
 * - Windows: shows as a native toast / Action Center notification
 * - Mobile web / installed PWA: shows as a device notification banner
 * Requires Notification permission (requested after admin login).
 */

const PERMISSION_ASKED_KEY = "goldapp_admin_notify_asked";

export function notificationsSupported() {
  return typeof window !== "undefined" && "Notification" in window;
}

export function notificationPermission() {
  if (!notificationsSupported()) return "unsupported";
  return Notification.permission;
}

/** Ask once after a user gesture (login). Safe to call repeatedly. */
export async function ensureNotificationPermission() {
  if (!notificationsSupported()) return "unsupported";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  try {
    const result = await Notification.requestPermission();
    try {
      localStorage.setItem(PERMISSION_ASKED_KEY, "1");
    } catch {
      /* ignore */
    }
    return result;
  } catch {
    return Notification.permission;
  }
}

function sideLabel(side) {
  if (side === "buy") return "خرید";
  if (side === "sell") return "فروش";
  return side || "سفارش";
}

function orderSummary(order) {
  if (!order) return "سفارش جدید ثبت شد";
  const side = sideLabel(order.side);
  const name = order.customer_name || "مشتری";
  const code = order.customer_code != null ? `#${order.customer_code}` : "";
  const unit = order.amount_type === "weight" ? "گرم ۱۸" : "تومان";
  const value =
    order.value != null
      ? `${Number(order.value).toLocaleString("fa-IR")} ${unit}`
      : "";
  return `${side} — ${name} ${code}`.trim() + (value ? `\n${value}` : "");
}

/**
 * Show a system notification for a new order.
 * Falls back silently if permission is missing or the API is blocked.
 */
export function notifyNewOrder(order) {
  if (!notificationsSupported()) return false;
  if (Notification.permission !== "granted") return false;

  const title = "سفارش جدید — آبشده قصر طلا";
  const body = orderSummary(order);
  const options = {
    body,
    dir: "rtl",
    lang: "fa",
    tag: order?.id ? `order-${order.id}` : "new-order",
    renotify: true,
    requireInteraction: false,
    silent: false,
    icon: "/favicon.svg",
    badge: "/favicon.svg",
    data: { orderId: order?.id, type: "new_order" },
  };

  try {
    // Prefer service-worker showNotification when available (better on
    // mobile PWAs while backgrounded); otherwise use the page API
    // which still produces a Windows toast when the tab is open.
    if (navigator.serviceWorker?.controller) {
      navigator.serviceWorker.ready
        .then((reg) => reg.showNotification(title, options))
        .catch(() => {
          // eslint-disable-next-line no-new
          new Notification(title, options);
        });
    } else {
      // eslint-disable-next-line no-new
      new Notification(title, options);
    }
    return true;
  } catch (e) {
    console.warn("System notification failed:", e);
    return false;
  }
}

/** Register a tiny SW used only to display notifications while backgrounded. */
export async function registerNotifyServiceWorker() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }
  try {
    return await navigator.serviceWorker.register("/sw-notify.js", { scope: "/" });
  } catch (e) {
    console.warn("Notify service worker registration failed:", e);
    return null;
  }
}
