import { useEffect, useState } from "react";
import { fetchNotice } from "../api";

const SEEN_KEY = "goldapp_notice_seen_at";

export default function NoticeModal() {
  const [notice, setNotice] = useState(null); // { text, updated_at }
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    fetchNotice()
      .then((res) => {
        if (!res.text || !res.updated_at) return;
        const seenAt = localStorage.getItem(SEEN_KEY);
        if (seenAt !== res.updated_at) {
          setNotice(res);
          setDismissed(false);
        }
      })
      .catch(() => {});
  }, []);

  function handleDismiss() {
    if (notice?.updated_at) {
      localStorage.setItem(SEEN_KEY, notice.updated_at);
    }
    setDismissed(true);
  }

  if (dismissed || !notice) return null;

  const lines = notice.text.split("\n").filter(Boolean);

  return (
    <div className="notice-modal-backdrop" onClick={handleDismiss}>
      <div className="notice-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="notice-modal__header">
          <span className="notice-modal__title">پیام مدیر سیستم</span>
          <span className="notice-modal__icon">✉</span>
        </div>
        <div className="notice-modal__body">
          {lines.map((line, i) => (
            <p className="notice-modal__line" key={i}>{line}</p>
          ))}
        </div>
        <button type="button" className="notice-modal__ok" onClick={handleDismiss}>
          متوجه شدم
        </button>
      </div>
    </div>
  );
}