import PriceButton from "./PriceButton";
import { formatTehranTime, formatTehranDateTime, serverDateMs } from "../utils/tehranTime";
import { useEffect, useRef, useState } from "react";

export default function PriceCardRow({ card, prevCard, onOrder, disabled, priceLabelMode, feedUpdatedAt }) {
  const effectiveMode = card?.price_label_mode || priceLabelMode;
  // Frozen wall-clock of the last *source* quote change for this card.
  // Stays put across polls until a newer card.updated_at arrives.
  const lastChangedRef = useRef(null);
  const [updatedAt, setUpdatedAt] = useState(null);

  useEffect(() => {
    // Prefer per-card stamp. Feed-level updatedAt advances when *any* card
    // moves — only use it to seed before this card has ever reported one.
    const incoming = card?.updated_at || (!lastChangedRef.current ? feedUpdatedAt : null) || null;
    if (!incoming) return;
    const nextMs = serverDateMs(incoming);
    if (!nextMs) return;
    const prevMs = lastChangedRef.current ? serverDateMs(lastChangedRef.current) : 0;
    // Only move forward (or seed). Never rewrite with an equal/older stamp
    // from a reconnect or unrelated feed tick.
    if (!prevMs || nextMs > prevMs) {
      lastChangedRef.current = incoming;
      setUpdatedAt(incoming);
    }
  }, [card?.updated_at, feedUpdatedAt]);

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
