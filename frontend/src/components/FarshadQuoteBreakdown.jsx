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
 * Compact Farshad readout under shop buy/sell.
 * میان / سود فرشاد / فرشاد بخرید/بفروشید
 * (Shop margin removed — hedges use per-role commission.)
 */
export default function FarshadQuoteBreakdown({ card }) {
  if (!hasFarshadQuote(card)) return null;
  const showFarshadSides = card.farshad_buy != null && card.price_source === "live";

  return (
    <div className={`farshad-quote ${card.stale ? "is-stale" : ""}`}>
      {card.stale && <span className="farshad-quote__stale">کهنه</span>}
      <div className="farshad-quote__stats farshad-quote__stats--two">
        <div className="farshad-quote__chip">
          <span className="farshad-quote__k">میان</span>
          <span className="farshad-quote__v">{formatTomanFa(card.base_price)}</span>
        </div>
        <div className="farshad-quote__chip">
          <span className="farshad-quote__k">سود فرشاد</span>
          <span className="farshad-quote__v">{formatTomanFa(card.farshad_commission)}</span>
        </div>
      </div>
      <div className="farshad-quote__sides-row">
        <span className="farshad-quote__k">فرشاد بخرید/بفروشید</span>
        {showFarshadSides ? (
          <span className="farshad-quote__sides">
            <span className="is-buy">{formatTomanFa(card.farshad_buy)}</span>
            <span className="farshad-quote__slash">/</span>
            <span className="is-sell">{formatTomanFa(card.farshad_sell)}</span>
          </span>
        ) : (
          <span className="farshad-quote__v">—</span>
        )}
      </div>
    </div>
  );
}
