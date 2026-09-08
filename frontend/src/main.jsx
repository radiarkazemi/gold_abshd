import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import { APP_BUILD_V, BRAND_V } from "./brandAssets.js";
import { applyAdminPwaManifest, isAdminPanelPath, ADMIN_PANEL_SCOPE } from "./utils/adminManifest.js";
import { signalAppUpdateAvailable, APPLIED_UPDATE_KEY } from "./components/UpdatePrompt.jsx";

// Admin PWA: swap manifest/title before React mounts (Safari reads head early).
// Keep a trailing slash so the URL stays inside scope /admin-hs-panel/.
if (typeof window !== "undefined") {
  if (isAdminPanelPath()) {
    applyAdminPwaManifest();
    try {
      const url = new URL(window.location.href);
      if (url.pathname !== ADMIN_PANEL_SCOPE) {
        url.pathname = ADMIN_PANEL_SCOPE;
        window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
      }
    } catch {
      /* ignore */
    }
  }
}

// Strip one-shot cache-bust query from soft-update navigations.
if (typeof window !== "undefined") {
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.has("_upd")) {
      url.searchParams.delete("_upd");
      window.history.replaceState({}, "", url.pathname + url.search + url.hash);
    }
  } catch {
    /* ignore */
  }
}

// Register SW with the deploy build id so every code release can be detected.
// Do NOT auto-reload — show an in-app update prompt instead (keeps login).
if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
  const adminPanel = typeof window !== "undefined" && isAdminPanelPath();
  const swUrl = adminPanel
    ? `/admin-hs-panel/sw.js?v=${APP_BUILD_V || BRAND_V}`
    : `/sw-notify.js?v=${APP_BUILD_V || BRAND_V}`;
  const swScope = adminPanel ? ADMIN_PANEL_SCOPE : "/";
  if (adminPanel) {
    navigator.serviceWorker.getRegistrations().then((regs) => {
      for (const reg of regs) {
        try {
          if (new URL(reg.scope).pathname === "/") reg.unregister();
        } catch {
          /* ignore */
        }
      }
    }).catch(() => {});
  }
  const ready = navigator.serviceWorker.register(swUrl, { scope: swScope, updateViaCache: "none" }).catch(() => null);
  ready?.then((reg) => {
    if (!reg) return;
    const ping = () => reg.update().catch(() => {});
    ping();
    setInterval(ping, 5 * 60 * 1000);
    reg.addEventListener("updatefound", () => {
      const installing = reg.installing;
      if (!installing) return;
      installing.addEventListener("statechange", () => {
        if (installing.state === "installed" && navigator.serviceWorker.controller) {
          signalAppUpdateAvailable();
        }
      });
    });
  });
}

// Poll version.json so open tabs learn about deploys even when SW is idle.
if (typeof window !== "undefined") {
  const knownBuild = APP_BUILD_V;
  let checking = false;
  async function checkForDeploy() {
    if (checking || !knownBuild || knownBuild === "dev") return;
    checking = true;
    try {
      const res = await fetch(`/version.json?_=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const remote = data?.build;
      if (!remote) return;
      if (remote === knownBuild) {
        // Running build matches server — clear any prior update attempt.
        try {
          sessionStorage.removeItem(APPLIED_UPDATE_KEY);
        } catch {
          /* ignore */
        }
        return;
      }
      // Avoid infinite banner if version.json was manually bumped ahead of the
      // baked APP_BUILD_V (or a reload still served a stale bundle).
      try {
        if (sessionStorage.getItem(APPLIED_UPDATE_KEY) === remote) return;
      } catch {
        /* ignore */
      }
      window.dispatchEvent(new CustomEvent("app-update-available", { detail: { build: remote } }));
    } catch {
      // offline / transient — ignore
    } finally {
      checking = false;
    }
  }
  setTimeout(checkForDeploy, 500);
  setInterval(checkForDeploy, 30_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkForDeploy();
  });
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
