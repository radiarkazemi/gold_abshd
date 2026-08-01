import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import { BRAND_V } from "./brandAssets.js";

// Keep the installed PWA / notification SW fresh so icon URL changes
// (brand stamp) are picked up without requiring a manual reinstall.
if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
  const ready = navigator.serviceWorker.register(`/sw-notify.js?v=${BRAND_V}`, { scope: "/" }).catch(() => null);
  ready?.then((reg) => {
    if (!reg) return;
    const ping = () => reg.update().catch(() => {});
    ping();
    setInterval(ping, 60 * 60 * 1000);
  });
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
