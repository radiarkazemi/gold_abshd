/**
 * Swap the document manifest / Apple meta so "Add to Home Screen" from
 * the admin panel installs the admin URL — not the client trader app.
 *
 * Safari (iOS) ignores blob: manifest URLs, so we point at a real static
 * `/admin-manifest.json` served over HTTPS.
 */
import { adminManifestUrl, BRAND_V, APP_BUILD_V, appleTouchIconUrl } from "../brandAssets";

const MANIFEST_LINK_ID = "goldapp-manifest-link";

function ensureManifestLink() {
  let link = document.getElementById(MANIFEST_LINK_ID);
  if (!link) {
    link = document.querySelector('link[rel="manifest"]');
  }
  if (!link) {
    link = document.createElement("link");
    link.rel = "manifest";
    document.head.appendChild(link);
  }
  link.id = MANIFEST_LINK_ID;
  return link;
}

function isIosDevice() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /iPhone|iPad|iPod/i.test(ua)
    || (navigator.maxTouchPoints > 1 && /Macintosh/i.test(ua));
}

/** True for iPhone / iPad Safari (not Chrome/Firefox iOS wrappers). */
export function isAppleSafari() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (!isIosDevice() && !/Macintosh/i.test(ua)) return false;
  return /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|Chrome|Android/i.test(ua);
}

/** Whether the admin panel is already running as an installed home-screen app. */
export function isAdminStandalone() {
  if (typeof window === "undefined") return false;
  try {
    if (window.matchMedia("(display-mode: standalone)").matches) return true;
    if (window.navigator.standalone === true) return true;
  } catch {
    /* ignore */
  }
  return false;
}

/** Short Persian tip for installing the admin panel on this device. */
export function adminInstallHint() {
  if (typeof window === "undefined") return "";
  if (isAdminStandalone()) return "";
  if (isIosDevice()) {
    return "نصب پنل روی صفحه اصلی آیفون: در Safari دکمه Share (□↑) → «Add to Home Screen» / «افزودن به صفحهٔ اصلی». حتماً از داخل خود پنل مدیریت این کار را بکنید تا میانبر مستقیم به پنل باز شود.";
  }
  if (/Android/i.test(navigator.userAgent || "")) {
    return "برای اعلان وقتی گوشی قفل است، پنل را از منوی Chrome روی صفحهٔ اصلی نصب کنید (Add to Home screen / Install app).";
  }
  return "";
}

/** Apply admin PWA metadata while the admin panel is mounted. */
export function applyAdminPwaManifest() {
  if (typeof document === "undefined") return () => {};
  const link = ensureManifestLink();
  const previousHref = link.getAttribute("href");
  const href = "/admin-manifest.json";
  link.setAttribute("href", href);

  const appleTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]');
  const prevAppleTitle = appleTitle?.getAttribute("content");
  if (appleTitle) appleTitle.setAttribute("content", "پنل قصر طلا");

  const theme = document.querySelector('meta[name="theme-color"]');
  const prevTheme = theme?.getAttribute("content");
  if (theme) theme.setAttribute("content", "#12100b");

  // Keep apple-touch-icon current (Safari uses this for the home-screen glyph).
  let appleIcon = document.querySelector('link[rel="apple-touch-icon"]');
  const prevAppleIcon = appleIcon?.getAttribute("href");
  if (!appleIcon) {
    appleIcon = document.createElement("link");
    appleIcon.rel = "apple-touch-icon";
    document.head.appendChild(appleIcon);
  }
  appleIcon.setAttribute("href", "/gt-apple-touch-icon.png");

  return () => {
    if (previousHref) link.setAttribute("href", previousHref);
    else link.removeAttribute("href");
    if (appleTitle && prevAppleTitle != null) appleTitle.setAttribute("content", prevAppleTitle);
    if (theme && prevTheme != null) theme.setAttribute("content", prevTheme);
    if (appleIcon && prevAppleIcon != null) appleIcon.setAttribute("href", prevAppleIcon);
  };
}
