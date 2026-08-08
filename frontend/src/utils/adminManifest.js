/**
 * Swap the document manifest / Apple meta so "Add to Home Screen" from
 * the admin panel installs the admin URL — not the client trader app.
 */
import { APP_BUILD_V, BRAND_V, icon192Url, appleTouchIconUrl } from "../brandAssets";

const ADMIN_PATH = "/admin-hs-panel";
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

function buildAdminManifest() {
  const v = BRAND_V || APP_BUILD_V || "1";
  return {
    name: "پنل مدیریت قصر طلا",
    short_name: "پنل قصر طلا",
    description: "پنل مدیریت آبشده قصر طلا",
    start_url: `${ADMIN_PATH}?source=pwa`,
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#12100b",
    theme_color: "#12100b",
    dir: "rtl",
    lang: "fa",
    id: `${ADMIN_PATH}?brand=${v}`,
    icons: [
      {
        src: `/gt-favicon-64.png?v=${v}`,
        sizes: "64x64",
        type: "image/png",
        purpose: "any",
      },
      {
        src: icon192Url || `/gt-icon-192.png?v=${v}`,
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: `/gt-icon-512.png?v=${v}`,
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: appleTouchIconUrl || `/gt-apple-touch-icon.png?v=${v}`,
        sizes: "180x180",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}

/** Apply admin PWA metadata while the admin panel is mounted. */
export function applyAdminPwaManifest() {
  if (typeof document === "undefined") return () => {};
  const link = ensureManifestLink();
  const previousHref = link.getAttribute("href");
  const manifest = buildAdminManifest();
  const blob = new Blob([JSON.stringify(manifest)], { type: "application/manifest+json" });
  const objectUrl = URL.createObjectURL(blob);
  link.setAttribute("href", objectUrl);

  const appleTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]');
  const prevAppleTitle = appleTitle?.getAttribute("content");
  if (appleTitle) appleTitle.setAttribute("content", "پنل قصر طلا");

  const theme = document.querySelector('meta[name="theme-color"]');
  const prevTheme = theme?.getAttribute("content");

  return () => {
    URL.revokeObjectURL(objectUrl);
    if (previousHref) link.setAttribute("href", previousHref);
    if (appleTitle && prevAppleTitle != null) appleTitle.setAttribute("content", prevAppleTitle);
    if (theme && prevTheme != null) theme.setAttribute("content", prevTheme);
  };
}
