import PriceButton from "./PriceButton";
import { formatTehranMonthDayTime, formatTehranDateTime } from "../utils/tehranTime";

/**
 * Show card.updated_at as آخرین بروزرسانی.
 * Live cards use goldbridge last_update_time; manual cards use the
 * admin-save stamp so the clock matches when the typed price was set.
 */
export default function PriceCardRow({ card, prevCard, onOrder, disabled, priceLabelMode }) {
  const effectiveMode = card?.price_label_mode || priceLabelMode;
  const updatedAt = card?.updated_at || null;
  const updatedLabel = updatedAt ? formatTehranMonthDayTime(updatedAt) : null;

  return (
    <div className={`price-card-row ${card.is_primary ? "price-card-row--primary" : "price-card-row--secondary"}`}>
      <div className="price-card-row__head">
        <div className="price-card-row__name">{card.name}</div>
        {updatedLabel && updatedLabel !== "—" && (
          <div className="price-card-row__updated" title={formatTehranDateTime(updatedAt, { second: "2-digit" })}>
            آخرین بروزرسانی:{" "}
            <span className="price-card-row__updated-stamp" dir="ltr">
              {updatedLabel}
            </span>
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
