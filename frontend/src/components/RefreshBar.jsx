import { useState } from "react";

function formatTimestamp(date) {
  return date.toLocaleString("fa-IR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    month: "2-digit",
    day: "2-digit",
  });
}

export default function RefreshBar({ onRefresh }) {
  const [lastRefreshed, setLastRefreshed] = useState(new Date());
  const [spinning, setSpinning] = useState(false);

  async function handleClick() {
    setSpinning(true);
    try {
      await onRefresh?.();
    } finally {
      setLastRefreshed(new Date());
      setTimeout(() => setSpinning(false), 400);
    }
  }

  return (
    <div className="refresh-bar">
      <span className="refresh-bar__time">
        آخرین بروزرسانی حساب‌ها: {formatTimestamp(lastRefreshed)}
      </span>
      <button
        type="button"
        className={`refresh-bar__btn ${spinning ? "is-spinning" : ""}`}
        onClick={handleClick}
        aria-label="بروزرسانی"
      >
        ↻
      </button>
    </div>
  );
}