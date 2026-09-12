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
    <dl className={`farshad-quote ${card.stale ? "is-stale" : ""}`}>
      {card.stale && <div className="farshad-quote__stale">نقل‌قول کهنه</div>}
      <div className="farshad-quote__row">
        <dt>میان</dt>
        <dd>{formatTomanFa(card.base_price)}</dd>
      </div>
      <div className="farshad-quote__row">
        <dt>سود فرشاد</dt>
        <dd>{formatTomanFa(card.farshad_commission)}</dd>
      </div>
      <div className="farshad-quote__row">
        <dt>حاشیه ما</dt>
        <dd>{showMargin ? formatTomanFa(card.shop_margin_toman) : "—"}</dd>
      </div>
      <div className="farshad-quote__row farshad-quote__row--split">
        <dt>فرشاد بخرید / بفروشید</dt>
        <dd>
          {showFarshadSides ? (
            <span className="farshad-quote__sides">
              <span className="is-buy">{formatTomanFa(card.farshad_buy)}</span>
              <span className="farshad-quote__slash">/</span>
              <span className="is-sell">{formatTomanFa(card.farshad_sell)}</span>
            </span>
          ) : "—"}
        </dd>
      </div>
    </dl>
  );
}
