import { useEffect, useState } from "react";

const LABELS = {
  buy: { fa: "بخرید", eyebrow: "قیمت خرید", unavailable: "نداریم" },
  sell: { fa: "بفروشید", eyebrow: "قیمت فروش", unavailable: "نداریم" },
};

function formatToman(value) {
  if (value == null) return "—";
  return Math.round(value).toLocaleString("en-US");
}

export default function PriceButton({ side, card, prevCard, onClick, disabled, priceLabelMode = "mesghal_and_gram18" }) {
  const [flash, setFlash] = useState(null); // "up" | "down" | null
  const meta = LABELS[side];
  const key = side === "buy" ? "buy_price" : "sell_price";
  const gram18Key = side === "buy" ? "gram18_buy_price" : "gram18_sell_price";
  const isCoin = card?.unit === "count";
  const mode = card?.price_label_mode || priceLabelMode;
  const gram18Only = !isCoin && mode === "gram18_only";
  const mesghalOnly = !isCoin && mode === "mesghal17_only";
  // When gram18Only, گرم۱۸ IS the primary displayed price - مثقال۱۷ never
  // appears anywhere on this button for that user.
  const primaryKey = gram18Only ? gram18Key : key;

  const sideOrderable = side === "buy" ? card?.orderable_buy : card?.orderable_sell;
  const clickDisabled = disabled || !sideOrderable;

  useEffect(() => {
    if (card == null || prevCard == null) return;
    const curr = card[primaryKey];
    const prev = prevCard[primaryKey];
    if (curr === prev) return;
    setFlash(curr > prev ? "up" : "down");
    const t = setTimeout(() => setFlash(null), 900);
    return () => clearTimeout(t);
  }, [card, prevCard, primaryKey]);

  return (
    <div className={`price-panel price-panel--${side} ${flash ? `price-panel--flash-${flash}` : ""} ${clickDisabled ? "price-panel--disabled" : ""}`}>
      <span className="price-panel__eyebrow">{meta.eyebrow}</span>

      <button
        type="button"
        className="price-panel__cta"
        onClick={() => !clickDisabled && onClick(side)}
        disabled={clickDisabled}
      >
        {sideOrderable ? meta.fa : meta.unavailable}
      </button>

      <span className="price-panel__value">
        {formatToman(card?.[primaryKey])}
        <span className="price-panel__currency">{isCoin ? "تومان" : "تومان"}</span>
      </span>

      {isCoin ? (
        <span className="price-panel__unit-qualifier">به ازای هر عدد</span>
      ) : gram18Only ? (
        <span className="price-panel__unit-qualifier">بر اساس گرم ۱۸</span>
      ) : mesghalOnly ? (
        <span className="price-panel__unit-qualifier">بر اساس مثقال ۱۷</span>
      ) : (
        card?.[gram18Key] != null && (
          <span className="price-panel__unit-badge price-panel__unit-badge--gram18">
            <span className="price-panel__unit-badge-label">گرم ۱۸:</span>
            {formatToman(card[gram18Key])}
          </span>
        )
      )}
    </div>
  );
}
