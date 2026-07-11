import { useEffect, useState } from "react";

const LABELS = {
  buy: { fa: "بخرید", eyebrow: "قیمت خرید" },
  sell: { fa: "بفروشید", eyebrow: "قیمت فروش" },
};

function formatToman(value) {
  if (value == null) return "—";
  return Math.round(value).toLocaleString("en-US");
}

export default function PriceButton({ side, price, prevPrice, onClick }) {
  const [flash, setFlash] = useState(null); // "up" | "down" | null
  const meta = LABELS[side];
  const key = side === "buy" ? "buy_price" : "sell_price";
  const gram18Key = side === "buy" ? "gram18_buy_price" : "gram18_sell_price";

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
      <span className="price-panel__units">
        <span className="price-panel__unit-badge price-panel__unit-badge--mesghal">
          <span className="price-panel__unit-badge-label">مثقال ۱۷</span>
        </span>
        {price?.[gram18Key] != null && (
          <span className="price-panel__unit-badge price-panel__unit-badge--gram18">
            <span className="price-panel__unit-badge-label">گرم ۱۸:</span>
            {formatToman(price[gram18Key])}
          </span>
        )}
      </span>
      <span className="price-panel__cta">{meta.fa}</span>
    </button>
  );
}