/**
 * OS-level notifications for the admin panel (not in-app toasts).
 *
 * - Windows / desktop: Action Center notification — especially useful
 *   when the browser window is minimized or in the background.
 * - Mobile web / installed PWA: native device notification banner.
 *
 * Requires Notification permission (requested after admin login).
 */

import { icon192Url, APP_BUILD_V, BRAND_V } from "../brandAssets";

const PERMISSION_ASKED_KEY = "goldapp_admin_notify_asked";

export function notificationsSupported() {
  return typeof window !== "undefined" && "Notification" in window;
}

export function notificationPermission() {
  if (!notificationsSupported()) return "unsupported";
  return Notification.permission;
}

function isMobileClient() {
  if (typeof navigator === "undefined") return false;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "")) return true;
  // iPadOS desktop UA still has touch
  return navigator.maxTouchPoints > 1 && /Macintosh/i.test(navigator.userAgent || "");
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
 * Fire an OS notification for a new order.
 * - Desktop: only when the tab/window is not visible (browser minimized
 *   or another app focused) — while looking at the panel, sound/flash is enough.
 * - Mobile: always, as a native device notification.
 */
export function notifyNewOrder(order) {
  if (!notificationsSupported()) return false;
  if (Notification.permission !== "granted") return false;

  const mobile = isMobileClient();
  if (!mobile && typeof document !== "undefined" && !document.hidden) {
    return false;
  }

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
    icon: icon192Url,
    badge: icon192Url,
    data: { orderId: order?.id, type: "new_order" },
  };

  try {
    // Service worker path is more reliable on mobile PWAs and when the
    // page is backgrounded on desktop.
    if (navigator.serviceWorker) {
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

/**
 * OS notification for a new KYC verification request.
 * Distinct title/tag from order notifications so admins can tell them apart.
 */
export function notifyNewKyc(user) {
  if (!notificationsSupported()) return false;
  if (Notification.permission !== "granted") return false;

  const mobile = isMobileClient();
  if (!mobile && typeof document !== "undefined" && !document.hidden) {
    return false;
  }

  const name = user?.full_name || "مشتری";
  const code = user?.user_code != null ? `#${user.user_code}` : "";
  const phone = user?.phone_number ? `\n${user.phone_number}` : "";
  const title = "درخواست احراز هویت — آبشده قصر طلا";
  const body = `${name} ${code}`.trim() + phone;
  const options = {
    body,
    dir: "rtl",
    lang: "fa",
    tag: user?.user_id ? `kyc-${user.user_id}` : "new-kyc",
    renotify: true,
    requireInteraction: false,
    silent: false,
    icon: icon192Url,
    badge: icon192Url,
    data: { userId: user?.user_id, type: "new_kyc" },
  };

  try {
    if (navigator.serviceWorker) {
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
    console.warn("KYC system notification failed:", e);
    return false;
  }
}

/** Register a tiny SW used to display notifications while backgrounded. */
export async function registerNotifyServiceWorker() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }
  try {
    return await navigator.serviceWorker.register(`/sw-notify.js?v=${APP_BUILD_V || BRAND_V}`, { scope: "/" });
  } catch (e) {
    console.warn("Notify service worker registration failed:", e);
    return null;
  }
}
