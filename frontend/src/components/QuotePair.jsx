import { formatTomanFa } from "../utils/formatFa";
import "./QuotePair.css";

/**
 * Shared buy/sell quote pair used by admin prices, dashboard, and expert.
 * Sell is first in DOM so RTL places فروش on the right, matching shop cards.
 */
export default function QuotePair({
  buy,
  sell,
  buyLabel = "خرید",
  sellLabel = "فروش",
  size = "md",
}) {
  return (
    <div className={`quote-pair quote-pair--${size}`}>
      <div className="quote-pair__item quote-pair__item--sell">
        <span className="quote-pair__label">{sellLabel}</span>
        <span className="quote-pair__amount">{formatTomanFa(sell)}</span>
      </div>
      <div className="quote-pair__item quote-pair__item--buy">
        <span className="quote-pair__label">{buyLabel}</span>
        <span className="quote-pair__amount">{formatTomanFa(buy)}</span>
      </div>
    </div>
  );
}
