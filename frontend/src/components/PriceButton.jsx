import { useEffect, useState } from "react";

const LABELS = {
  buy: { fa: "خرید", eyebrow: "قیمت خرید" },
  sell: { fa: "فروش", eyebrow: "قیمت فروش" },
};

function formatToman(value) {
  if (value == null) return "—";
  return Math.round(value).toLocaleString("fa-IR");
}

export default function PriceButton({ side, price, prevPrice, onClick }) {
  const [flash, setFlash] = useState(null); // "up" | "down" | null
  const meta = LABELS[side];
  const key = side === "buy" ? "buy_price" : "sell_price";

  useEffect(() => {
    if (price == null || prevPrice == null) return;
    const curr = price[key];
    const prev = prevPrice[key];
    if (curr === prev) return;
    setFlash(curr > prev ? "up" : "down");
    const t = setTimeout(() => setFlash(null), 900);
    return () => clearTimeout(t);
  }, [price, prevPrice, key]);

  return (
    <button
      className={`price-panel price-panel--${side} ${flash ? `price-panel--flash-${flash}` : ""}`}
      onClick={() => onClick(side)}
    >
      <span className="price-panel__eyebrow">{meta.eyebrow}</span>
      <span className="price-panel__value">
        {formatToman(price?.[key])}
        <span className="price-panel__currency">تومان</span>
      </span>
      <span className="price-panel__unit">{price?.unit || "مثقال ۱۷"}</span>
      <span className="price-panel__cta">{meta.fa}</span>
    </button>
  );
}
