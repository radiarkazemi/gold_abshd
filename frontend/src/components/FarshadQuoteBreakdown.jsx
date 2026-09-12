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
 * Compact Farshad hedge strip under shop buy/sell.
 * میان / سود فرشاد / حاشیه ما / فرشاد بخرید/بفروشید
 */
export default function FarshadQuoteBreakdown({ card }) {
  if (!hasFarshadQuote(card)) return null;
  const showMargin = card.shop_margin_toman > 0 && card.price_source === "live";
  const showFarshadSides = card.farshad_buy != null && card.price_source === "live";

  return (
    <div className={`farshad-quote ${card.stale ? "is-stale" : ""}`}>
      {card.stale && <span className="farshad-quote__stale">کهنه</span>}
      <div className="farshad-quote__stats">
        <div className="farshad-quote__chip">
          <span className="farshad-quote__k">میان</span>
          <span className="farshad-quote__v">{formatTomanFa(card.base_price)}</span>
        </div>
        <div className="farshad-quote__chip">
          <span className="farshad-quote__k">سود فرشاد</span>
          <span className="farshad-quote__v">{formatTomanFa(card.farshad_commission)}</span>
        </div>
        <div className="farshad-quote__chip">
          <span className="farshad-quote__k">حاشیه ما</span>
          <span className="farshad-quote__v">{showMargin ? formatTomanFa(card.shop_margin_toman) : "—"}</span>
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
