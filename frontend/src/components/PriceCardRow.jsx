import PriceButton from "./PriceButton";
import { formatTehranTime, formatTehranDateTime } from "../utils/tehranTime";
import { useEffect, useRef, useState } from "react";

/** Stable quote fingerprint — only changes when the user-visible price moves. */
function quoteFingerprint(card) {
  if (!card) return "";
  const parts = [
    card.goldbridge_item_id,
    card.buy_price,
    card.sell_price,
    card.gram18_buy_price,
    card.gram18_sell_price,
  ].map((v) => {
    if (v == null || v === "") return "";
    const n = Number(v);
    return Number.isFinite(n) ? String(Math.round(n)) : String(v);
  });
  return parts.join("|");
}

export default function PriceCardRow({ card, prevCard, onOrder, disabled, priceLabelMode, feedUpdatedAt }) {
  const effectiveMode = card?.price_label_mode || priceLabelMode;
  // Clock is driven by quote changes, NOT by server updated_at (that can
  // advance on every poll even when buy/sell are unchanged).
  const quoteRef = useRef(null);
  const [updatedAt, setUpdatedAt] = useState(null);
  const fingerprint = quoteFingerprint(card);

  useEffect(() => {
    if (!fingerprint) return;
    const serverHint = card?.updated_at || feedUpdatedAt || null;

    if (quoteRef.current == null) {
      // First paint — seed once from server hint (or now), then freeze.
      quoteRef.current = fingerprint;
      setUpdatedAt(serverHint || new Date().toISOString());
      return;
    }

    if (quoteRef.current !== fingerprint) {
      // This card's displayed price actually moved → restart clock now.
      quoteRef.current = fingerprint;
      setUpdatedAt(new Date().toISOString());
    }
    // Unchanged quote → keep frozen time; ignore advancing server stamps.
  }, [fingerprint, card?.updated_at, feedUpdatedAt]);

  const updatedLabel = updatedAt ? formatTehranTime(updatedAt, { second: "2-digit" }) : null;

  return (
    <div className={`price-card-row ${card.is_primary ? "price-card-row--primary" : "price-card-row--secondary"}`}>
      <div className="price-card-row__head">
        <div className="price-card-row__name">{card.name}</div>
        {updatedLabel && updatedLabel !== "—" && (
          <div className="price-card-row__updated" title={formatTehranDateTime(updatedAt)}>
            آخرین بروزرسانی: {updatedLabel}
          </div>
        )}
      </div>
      <div className={`price-stage ${disabled ? "price-stage--disabled" : ""}`}>
        <PriceButton
          side="buy"
          card={card}
          prevCard={prevCard}
          onClick={(side) => onOrder(card, side)}
          disabled={disabled}
          priceLabelMode={effectiveMode}
        />
        <PriceButton
          side="sell"
          card={card}
          prevCard={prevCard}
          onClick={(side) => onOrder(card, side)}
          disabled={disabled}
          priceLabelMode={effectiveMode}
        />
      </div>
    </div>
  );
}
