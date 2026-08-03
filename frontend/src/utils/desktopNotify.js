/**
 * OS-level notifications for the admin panel (not in-app toasts).
 *
 * - Windows / desktop: Action Center notification — especially useful
 *   when the browser window is minimized or in the background.
 * - Mobile web / installed PWA: native device notification banner.
 * - Web Push: delivers alerts when the admin tab is suspended (phone
 *   locked / PWA backgrounded) — see subscribeAdminPush().
 *
 * Requires Notification permission (requested after admin login).
 */

import { icon192Url, APP_BUILD_V, BRAND_V } from "../brandAssets";
import { API_BASE, adminAuthHeaders } from "../api";

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

function showOsNotification(title, options) {
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
    console.warn("System notification failed:", e);
    return false;
  }
}

/**
 * Fire an OS notification for a new order.
 * - Desktop: only when the tab/window is not visible (browser minimized
 *   or another app focused) — while looking at the panel, sound/flash is enough.
 * - Mobile: always, as a native device notification (with sound).
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
    vibrate: [220, 100, 220, 100, 320],
    icon: icon192Url,
    badge: icon192Url,
    data: { orderId: order?.id, type: "new_order", url: "/admin-hs-panel" },
  };

  return showOsNotification(title, options);
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
    vibrate: [180, 80, 180],
    icon: icon192Url,
    badge: icon192Url,
    data: { userId: user?.user_id, type: "new_kyc", url: "/admin-hs-panel" },
  };

  return showOsNotification(title, options);
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

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Subscribe this admin device to Web Push so orders still alert with
 * sound when the phone is locked / the PWA is backgrounded.
 */
export async function subscribeAdminPush() {
  if (typeof window === "undefined") return false;
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
  if (!notificationsSupported() || Notification.permission !== "granted") return false;

  try {
    const reg = (await registerNotifyServiceWorker()) || (await navigator.serviceWorker.ready);
    if (!reg?.pushManager) return false;

    const keyRes = await fetch(`${API_BASE}/api/admin/push/vapid-public-key`, {
      headers: { ...adminAuthHeaders() },
    });
    if (!keyRes.ok) return false;
    const { public_key: publicKey } = await keyRes.json();
    if (!publicKey) return false;

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }

    const json = sub.toJSON();
    const res = await fetch(`${API_BASE}/api/admin/push/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
      body: JSON.stringify({
        endpoint: json.endpoint,
        keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
      }),
    });
    return res.ok;
  } catch (e) {
    console.warn("Admin push subscribe failed:", e);
    return false;
  }
}
