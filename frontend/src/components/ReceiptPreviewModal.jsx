import { useEffect } from "react";
import "./ReceiptPreviewModal.css";

/**
 * In-app PDF/HTML receipt viewer. Keeps the current print/download path
 * separate; this only previews the same HTML document inside the app.
 */
export default function ReceiptPreviewModal({ title = "مشاهده رسید", html, onClose, onDownload }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose?.();
    }
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  if (!html) return null;

  return (
    <div className="receipt-preview-backdrop" onClick={onClose} role="presentation">
      <div
        className="receipt-preview-sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="receipt-preview-sheet__top">
          <h2 className="receipt-preview-sheet__title">{title}</h2>
        </div>
        <iframe className="receipt-preview-sheet__frame" title={title} srcDoc={html} />
        <div className="receipt-preview-sheet__footer">
          {onDownload && (
            <button type="button" className="receipt-preview-sheet__btn" onClick={onDownload}>
              دانلود PDF
            </button>
          )}
          <button type="button" className="receipt-preview-sheet__btn receipt-preview-sheet__btn--ghost" onClick={onClose}>
            بستن
          </button>
        </div>
      </div>
    </div>
  );
}
