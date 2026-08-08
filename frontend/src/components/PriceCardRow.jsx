import PriceButton from "./PriceButton";
import { formatTehranTime, formatTehranDateTime } from "../utils/tehranTime";

export default function PriceCardRow({ card, prevCard, onOrder, disabled, priceLabelMode, feedUpdatedAt }) {
  const effectiveMode = card?.price_label_mode || priceLabelMode;
  const updatedAt = card?.updated_at || feedUpdatedAt || null;
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
