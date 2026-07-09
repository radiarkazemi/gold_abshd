import { useEffect, useState } from "react";
import { fetchNotice } from "../api";

export default function NoticeCard() {
  const [text, setText] = useState("");

  useEffect(() => {
    fetchNotice()
      .then((res) => setText(res.text))
      .catch(() => {});
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