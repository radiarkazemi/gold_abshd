import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import { APP_BUILD_V, BRAND_V } from "./brandAssets.js";

// Register SW with the deploy build id so every code release triggers
// an update + reload (brand-only stamps were not enough).
if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
  const swUrl = `/sw-notify.js?v=${APP_BUILD_V || BRAND_V}`;
  const ready = navigator.serviceWorker.register(swUrl, { scope: "/" }).catch(() => null);
  ready?.then((reg) => {
    if (!reg) return;
    const ping = () => reg.update().catch(() => {});
    ping();
    setInterval(ping, 5 * 60 * 1000);
  });
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}

// Poll version.json so open tabs pick up deploys even when SW is idle
// or index.html was briefly cached by a proxy.
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
      if (data?.build && data.build !== knownBuild) {
        window.location.reload();
      }
    } catch {
      // offline / transient — ignore
    } finally {
      checking = false;
    }
  }
  setTimeout(checkForDeploy, 8_000);
  setInterval(checkForDeploy, 45_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkForDeploy();
  });
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
