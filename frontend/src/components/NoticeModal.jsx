import { useEffect, useState } from "react";
import { fetchNotice, openPriceSocket } from "../api";

const SEEN_KEY = "goldapp_notice_seen_at";

/**
 * Popup when the admin updates اطلاعیه‌ها. Subscribes to /ws/price site
 * events so a new notice appears immediately without refresh.
 */
export default function NoticeModal() {
  const [notice, setNotice] = useState(null); // { text, updated_at }
  const [dismissed, setDismissed] = useState(true);

  function applyNotice(res) {
    if (!res?.text || !res?.updated_at) {
      setNotice(null);
      setDismissed(true);
      return;
    }
    const seenAt = localStorage.getItem(SEEN_KEY);
    setNotice(res);
    // Show again whenever the admin publishes a new updated_at.
    setDismissed(seenAt === res.updated_at);
  }

  useEffect(() => {
    fetchNotice().then(applyNotice).catch(() => {});

    // Own lightweight socket so the modal works on every client page,
    // not only the trader screen that already has usePriceFeed.
    const ws = openPriceSocket(null, (event) => {
      if (event?.type === "notice_updated" && event.notice) {
        applyNotice(event.notice);
      }
    });

    function onSiteEvent(e) {
      const event = e.detail;
      if (event?.type === "notice_updated" && event.notice) {
        applyNotice(event.notice);
      }
    }
    window.addEventListener("goldapp:site-event", onSiteEvent);

    // Slow poll as a safety net if the socket drops.
    const poll = setInterval(() => {
      fetchNotice().then(applyNotice).catch(() => {});
    }, 20000);

    return () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      window.removeEventListener("goldapp:site-event", onSiteEvent);
      clearInterval(poll);
    };
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
