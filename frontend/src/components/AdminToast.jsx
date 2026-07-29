import { useState } from "react";
import "./AdminToast.css";

/**
 * Lightweight in-app toast stack for the admin panel (complements
 * Windows/mobile system notifications when the tab is focused).
 */
export default function AdminToast({ toasts, onDismiss }) {
  if (!toasts?.length) return null;

  return (
    <div className="admin-toast-stack" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`admin-toast admin-toast--${t.tone || "info"}`} role="status">
          <div className="admin-toast__body">
            <strong className="admin-toast__title">{t.title}</strong>
            {t.message && <p className="admin-toast__message">{t.message}</p>}
          </div>
          <button
            type="button"
            className="admin-toast__close"
            aria-label="بستن"
            onClick={() => onDismiss(t.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

export function useAdminToasts() {
  const [toasts, setToasts] = useState([]);

  function pushToast({ title, message = "", tone = "info", durationMs = 5000 }) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts((list) => [...list, { id, title, message, tone }]);
    if (durationMs > 0) {
      window.setTimeout(() => {
        setToasts((list) => list.filter((t) => t.id !== id));
      }, durationMs);
    }
    return id;
  }

  function dismissToast(id) {
    setToasts((list) => list.filter((t) => t.id !== id));
  }

  return { toasts, pushToast, dismissToast };
}
