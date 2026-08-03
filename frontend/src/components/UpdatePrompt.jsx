import { useCallback, useEffect, useState } from "react";
import "./UpdatePrompt.css";

const EVENT_NAME = "app-update-available";
export const APPLIED_UPDATE_KEY = "app_update_applied_build";

/** Call from non-React code when a newer deploy is detected. */
export function signalAppUpdateAvailable() {
  try {
    window.dispatchEvent(new Event(EVENT_NAME));
  } catch {
    /* ignore */
  }
}

async function clearAssetCaches() {
  if (typeof caches !== "undefined") {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  }
  if (navigator.serviceWorker?.getRegistrations) {
    const regs = await navigator.serviceWorker.getRegistrations();
    // Unregister so the next load fetches a fresh SW + assets (update-only can leave stale controllers).
    await Promise.all(
      regs.map(async (reg) => {
        try {
          await reg.unregister();
        } catch {
          /* ignore */
        }
      })
    );
  }
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    }),
  ]);
}

/**
 * Soft update banner: clears HTTP/SW caches then reloads.
 * Auth tokens stay in localStorage — user is not logged out.
 */
export default function UpdatePrompt() {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [remoteBuild, setRemoteBuild] = useState(null);

  useEffect(() => {
    function show(ev) {
      const build = ev?.detail?.build || null;
      if (build) setRemoteBuild(build);
      setVisible(true);
    }
    window.addEventListener(EVENT_NAME, show);
    return () => window.removeEventListener(EVENT_NAME, show);
  }, []);

  const applyUpdate = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      let build = remoteBuild;
      if (!build) {
        try {
          const res = await fetch(`/version.json?_=${Date.now()}`, { cache: "no-store" });
          if (res.ok) {
            const data = await res.json();
            build = data?.build || null;
          }
        } catch {
          /* ignore */
        }
      }
      if (build) {
        try {
          sessionStorage.setItem(APPLIED_UPDATE_KEY, build);
        } catch {
          /* ignore */
        }
      }
      await withTimeout(clearAssetCaches(), 2500);
    } catch {
      /* still reload */
    }
    // Cache-bust navigation so HTML/JS aren't served from a sticky browser cache.
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("_upd", String(Date.now()));
      window.location.replace(url.toString());
    } catch {
      window.location.reload();
    }
  }, [busy, remoteBuild]);

  if (!visible) return null;

  return (
    <div className="update-prompt" role="status" aria-live="polite">
      <div className="update-prompt__inner">
        <span className="update-prompt__dot" aria-hidden="true" />
        <p className="update-prompt__text">نسخه جدید آماده است</p>
        <button type="button" className="update-prompt__btn" disabled={busy} onClick={applyUpdate}>
          {busy ? "در حال بروزرسانی…" : "بروزرسانی"}
        </button>
      </div>
    </div>
  );
}
