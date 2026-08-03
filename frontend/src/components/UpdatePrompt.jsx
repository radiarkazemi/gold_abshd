import { useCallback, useEffect, useState } from "react";
import "./UpdatePrompt.css";

const EVENT_NAME = "app-update-available";

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
    await Promise.all(
      regs.map(async (reg) => {
        try {
          await reg.update();
        } catch {
          /* ignore */
        }
      })
    );
  }
}

/**
 * Soft update banner: clears HTTP/SW caches then reloads.
 * Auth tokens stay in localStorage — user is not logged out.
 */
export default function UpdatePrompt() {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    function show() {
      setVisible(true);
    }
    window.addEventListener(EVENT_NAME, show);
    return () => window.removeEventListener(EVENT_NAME, show);
  }, []);

  const applyUpdate = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await clearAssetCaches();
    } catch {
      /* still reload */
    }
    // Preserve login (localStorage token); only bust cached HTML/JS/CSS/icons.
    window.location.reload();
  }, [busy]);

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
