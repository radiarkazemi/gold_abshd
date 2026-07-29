import { useEffect, useState } from "react";
import { fetchNotice } from "../api";

/** Live card under prices — updates when admin saves اطلاعیه‌ها. */
export default function NoticeCard() {
  const [text, setText] = useState("");

  useEffect(() => {
    function apply(res) {
      setText(res?.text || "");
    }

    fetchNotice().then(apply).catch(() => {});

    function onSiteEvent(e) {
      const event = e.detail;
      if (event?.type === "notice_updated" && event.notice) {
        apply(event.notice);
      }
    }
    window.addEventListener("goldapp:site-event", onSiteEvent);

    const poll = setInterval(() => {
      fetchNotice().then(apply).catch(() => {});
    }, 20000);

    return () => {
      window.removeEventListener("goldapp:site-event", onSiteEvent);
      clearInterval(poll);
    };
  }, []);

  if (!text) return null;

  const lines = text.split("\n").filter(Boolean);

  return (
    <div className="notice-card">
      <div className="notice-card__glow" />
      {lines.map((line, i) => (
        <p className="notice-card__line" key={i}>
          <span className="notice-card__bullet">◆</span>
          {line}
        </p>
      ))}
    </div>
  );
}
