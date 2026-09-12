import { formatTomanFa } from "../utils/formatFa";
import "./FarshadQuoteBreakdown.css";

export function hasFarshadQuote(card) {
  if (!card) return false;
  return (
    card.base_price != null
    || card.farshad_commission != null
    || card.farshad_buy != null
    || card.stale
  );
}

/**
 * Farshad hedge readout shown directly under shop buy/sell.
 * میان / سود فرشاد / حاشیه ما / فرشاد بخرید/بفروشید
 */
export default function FarshadQuoteBreakdown({ card }) {
  if (!hasFarshadQuote(card)) return null;
  const showMargin = card.shop_margin_toman > 0 && card.price_source === "live";
  const showFarshadSides = card.farshad_buy != null && card.price_source === "live";

  return (
    <div className={`farshad-quote ${card.stale ? "is-stale" : ""}`}>
      {card.stale && <span className="farshad-quote__stale">نقل‌قول کهنه</span>}
      <div className="farshad-quote__cell">
        <span className="farshad-quote__label">میان</span>
        <span className="farshad-quote__value">{formatTomanFa(card.base_price)}</span>
      </div>
      <div className="farshad-quote__cell">
        <span className="farshad-quote__label">سود فرشاد</span>
        <span className="farshad-quote__value">{formatTomanFa(card.farshad_commission)}</span>
      </div>
      <div className="farshad-quote__cell">
        <span className="farshad-quote__label">حاشیه ما</span>
        <span className="farshad-quote__value">{showMargin ? formatTomanFa(card.shop_margin_toman) : "—"}</span>
      </div>
      <div className="farshad-quote__cell farshad-quote__cell--wide">
        <span className="farshad-quote__label">فرشاد بخرید / بفروشید</span>
        {showFarshadSides ? (
          <div className="farshad-quote__split">
            <div className="farshad-quote__split-item farshad-quote__split-item--buy">
              <span className="farshad-quote__label">بخرید</span>
              <span className="farshad-quote__value">{formatTomanFa(card.farshad_buy)}</span>
            </div>
            <div className="farshad-quote__split-item farshad-quote__split-item--sell">
              <span className="farshad-quote__label">بفروشید</span>
              <span className="farshad-quote__value">{formatTomanFa(card.farshad_sell)}</span>
            </div>
          </div>
        ) : (
          <span className="farshad-quote__value">—</span>
        )}
      </div>
    </div>
  );
}
