/**
 * OS-level notifications for the admin panel (not in-app toasts).
 *
 * - Windows / desktop: Action Center notification — especially useful
 *   when the browser window is minimized or in the background.
 * - Mobile web / installed PWA: native device notification banner.
 * - Web Push: delivers alerts when the admin tab is suspended (phone
 *   locked / PWA backgrounded) — see subscribeAdminPush().
 *
 * Requires Notification permission (requested after admin login) and
 * a secure context (HTTPS) for Service Worker + Web Push on mobile.
 */

import { icon192Url, APP_BUILD_V, BRAND_V } from "../brandAssets";
import { API_BASE, adminAuthHeaders } from "../api";
import { ADMIN_PANEL_SCOPE, isAdminPanelPath } from "./adminManifest";

const PERMISSION_ASKED_KEY = "goldapp_admin_notify_asked";
const ADMIN_PATH = ADMIN_PANEL_SCOPE;

export function notificationsSupported() {
  return typeof window !== "undefined" && "Notification" in window;
}

export function notificationPermission() {
  if (!notificationsSupported()) return "unsupported";
  return Notification.permission;
}

/** Capabilities / blockers for admin push on this device. */
export function pushSupportInfo() {
  const secureContext = typeof window !== "undefined" && window.isSecureContext === true;
  const sw = typeof navigator !== "undefined" && "serviceWorker" in navigator;
  const push = typeof window !== "undefined" && "PushManager" in window;
  const notif = notificationsSupported();
  return {
    secureContext,
    serviceWorker: sw,
    pushManager: push,
    notifications: notif,
    canSubscribe: Boolean(secureContext && sw && push && notif),
  };
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

function absoluteIconUrl() {
  try {
    return new URL(icon192Url || "/gt-icon-192.png", window.location.origin).href;
  } catch {
    return icon192Url || "/gt-icon-192.png";
  }
}

/**
 * Show an OS notification via the service worker when possible.
 * SW path is required for reliable mobile banners; page-level
 * `new Notification()` is often suppressed on Android/iOS.
 */
async function showOsNotification(title, options) {
  try {
    if (typeof navigator !== "undefined" && navigator.serviceWorker) {
      try {
        await registerNotifyServiceWorker();
      } catch {
        /* ignore */
      }

      // Prefer asking the SW to show the notification (same path as push).
      const controller = navigator.serviceWorker.controller;
      if (controller) {
        controller.postMessage({
          type: "SHOW_NOTIFICATION",
          title,
          options,
        });
        return true;
      }

      const reg = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((resolve) => setTimeout(() => resolve(null), 2000)),
      ]);
      if (reg?.showNotification) {
        await reg.showNotification(title, options);
        return true;
      }
      if (reg?.active) {
        reg.active.postMessage({ type: "SHOW_NOTIFICATION", title, options });
        return true;
      }
    }
    // Fallback for desktop browsers without an active SW controller.
    // eslint-disable-next-line no-new
    new Notification(title, options);
    return true;
  } catch (e) {
    console.warn("System notification failed:", e);
    try {
      // eslint-disable-next-line no-new
      new Notification(title, options);
      return true;
    } catch (e2) {
      console.warn("Notification fallback failed:", e2);
      return false;
    }
  }
}

/**
 * Fire an OS notification for a new order.
 * Android ignores the `sound` option and often blocks in-page Audio while
 * the panel is focused — so we always show a non-silent OS notification.
 * Desktop still skips the OS toast when the window is already in front.
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
  const icon = absoluteIconUrl();
  const options = {
    body,
    dir: "rtl",
    lang: "fa",
    tag: order?.id ? `order-audible-${order.id}` : `new-order-audible-${Date.now()}`,
    renotify: true,
    requireInteraction: true,
    silent: false,
    vibrate: [280, 120, 180, 120, 280, 120, 400],
    icon,
    badge: icon,
    image: icon,
    actions: [
      { action: "open", title: "مشاهده" },
      { action: "dismiss", title: "بستن" },
    ],
    data: { orderId: order?.id, type: "new_order", url: ADMIN_PATH },
    sound: "/notify-order.wav",
  };

  showOsNotification(title, options);
  return true;
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
  const icon = absoluteIconUrl();
  const options = {
    body,
    dir: "rtl",
    lang: "fa",
    tag: user?.user_id ? `kyc-audible-${user.user_id}` : `new-kyc-audible-${Date.now()}`,
    renotify: true,
    requireInteraction: true,
    silent: false,
    vibrate: [160, 80, 160, 80, 280],
    icon,
    badge: icon,
    image: icon,
    actions: [
      { action: "open", title: "مشاهده" },
      { action: "dismiss", title: "بستن" },
    ],
    data: { userId: user?.user_id, type: "new_kyc", url: ADMIN_PATH },
    sound: "/notify-kyc.wav",
  };

  showOsNotification(title, options);
  return true;
}

/** Register a tiny SW used to display notifications while backgrounded. */
export async function registerNotifyServiceWorker() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }
  if (typeof window !== "undefined" && window.isSecureContext === false) {
    console.warn("Notify SW skipped: page is not a secure context (HTTPS required)");
    return null;
  }
  try {
    const adminPanel = isAdminPanelPath();
    const swUrl = adminPanel
      ? `/admin-hs-panel/sw.js?v=${APP_BUILD_V || BRAND_V}`
      : `/sw-notify.js?v=${APP_BUILD_V || BRAND_V}`;
    const reg = await navigator.serviceWorker.register(swUrl, {
      scope: adminPanel ? ADMIN_PANEL_SCOPE : "/",
      updateViaCache: "none",
    });
    try {
      await reg.update();
    } catch {
      /* ignore */
    }
    return reg;
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
async function waitForServiceWorkerController(timeoutMs = 4000) {
  if (navigator.serviceWorker.controller) return;
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });
}

/**
 * Subscribe this admin device to Web Push so orders still alert with
 * sound when the phone is locked / the PWA is backgrounded.
 * Returns { ok, reason } so the panel can show an actionable tip.
 */
export async function subscribeAdminPush() {
  const result = await subscribeAdminPushDetailed();
  return result.ok;
}

export async function subscribeAdminPushDetailed() {
  if (typeof window === "undefined") return { ok: false, reason: "unsupported" };
  const info = pushSupportInfo();
  if (!info.canSubscribe) {
    console.warn("Admin push unavailable:", info);
    return { ok: false, reason: "unsupported" };
  }
  if (Notification.permission !== "granted") {
    return { ok: false, reason: "permission" };
  }

  try {
    const reg = (await registerNotifyServiceWorker()) || (await navigator.serviceWorker.ready);
    if (!reg?.pushManager) return { ok: false, reason: "no-sw" };
    await waitForServiceWorkerController();

    const keyRes = await fetch(`${API_BASE}/api/admin/push/vapid-public-key`, {
      headers: { ...adminAuthHeaders() },
    });
    if (!keyRes.ok) {
      console.warn("VAPID public key fetch failed", keyRes.status);
      return { ok: false, reason: keyRes.status === 401 ? "auth" : "vapid" };
    }
    const { public_key: publicKey } = await keyRes.json();
    if (!publicKey) return { ok: false, reason: "vapid" };

    const appKey = urlBase64ToUint8Array(publicKey);
    let sub = await reg.pushManager.getSubscription();
    if (sub) {
      try {
        await sub.unsubscribe();
      } catch {
        /* ignore — we will try a fresh subscribe */
      }
    }
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: appKey,
    });

    const json = sub.toJSON();
    const res = await fetch(`${API_BASE}/api/admin/push/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
      body: JSON.stringify({
        endpoint: json.endpoint,
        keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
      }),
    });
    if (!res.ok) {
      console.warn("Admin push subscribe POST failed", res.status);
      return { ok: false, reason: res.status === 401 ? "auth" : "server" };
    }
    return { ok: true };
  } catch (e) {
    console.warn("Admin push subscribe failed:", e);
    const name = e?.name || "";
    if (name === "NotAllowedError" || name === "AbortError") {
      return { ok: false, reason: "need-install" };
    }
    return { ok: false, reason: "subscribe" };
  }
}
