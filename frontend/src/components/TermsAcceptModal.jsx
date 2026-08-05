import { useEffect, useRef, useState } from "react";
import { fetchTerms } from "../api";
import "./TermsAcceptModal.css";

/**
 * Modal for accepting قوانین و مقررات at login.
 * User must scroll to the bottom before «پذیرش» is enabled.
 */
export default function TermsAcceptModal({ open, onAccept, onReject }) {
  const [text, setText] = useState("");
  const [version, setVersion] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reachedBottom, setReachedBottom] = useState(false);
  const bodyRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError("");
    setReachedBottom(false);
    fetchTerms()
      .then((res) => {
        setText(res.text || "");
        setVersion(res.version || null);
      })
      .catch(() => setError("بارگذاری قوانین با خطا مواجه شد"))
      .finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    if (!open || loading || error) return;
    // Short texts may already fit — treat as scrolled.
    const el = bodyRef.current;
    if (!el) return;
    if (el.scrollHeight <= el.clientHeight + 8) {
      setReachedBottom(true);
    }
  }, [open, loading, error, text]);

  function handleScroll(e) {
    const el = e.target;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 28) {
      setReachedBottom(true);
    }
  }

  if (!open) return null;

  const lines = (text || "").split("\n");

  return (
    <div className="terms-accept-backdrop" role="presentation">
      <div
        className="terms-accept"
        role="dialog"
        aria-modal="true"
        aria-labelledby="terms-accept-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="terms-accept__header">
          <h2 id="terms-accept-title" className="terms-accept__title">
            شرایط و قوانین استفاده از سرویس‌ها
          </h2>
          {version && <span className="terms-accept__version">نسخه {version}</span>}
        </div>

        <div
          className="terms-accept__body"
          ref={bodyRef}
          onScroll={handleScroll}
        >
          {loading && <p className="terms-accept__hint">در حال بارگذاری…</p>}
          {error && <p className="terms-accept__error">{error}</p>}
          {!loading &&
            !error &&
            lines.map((line, i) =>
              line.trim() ? (
                <p
                  key={i}
                  className={
                    line.startsWith("─")
                      ? "terms-accept__rule"
                      : line.startsWith("ماده ")
                        ? "terms-accept__article"
                        : "terms-accept__line"
                  }
                >
                  {line}
                </p>
              ) : (
                <div key={i} className="terms-accept__gap" />
              )
            )}
        </div>

        {!reachedBottom && !loading && !error && (
          <p className="terms-accept__scroll-hint">برای پذیرش، تا انتهای متن اسکرول کنید</p>
        )}

        <div className="terms-accept__actions">
          <button
            type="button"
            className="terms-accept__btn terms-accept__btn--reject"
            onClick={onReject}
          >
            رد می‌کنم
          </button>
          <button
            type="button"
            className="terms-accept__btn terms-accept__btn--accept"
            disabled={!reachedBottom || loading || !!error}
            onClick={() => onAccept({ version, text })}
          >
            مطالعه کردم و می‌پذیرم
          </button>
        </div>
      </div>
    </div>
  );
}
