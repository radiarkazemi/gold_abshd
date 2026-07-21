function fa(n, opts) {
  if (n == null) return "—";
  return Number(n).toLocaleString("fa-IR", opts);
}

const TYPE_LABEL = { 1: "طلا", 2: "سکه" };

export default function SecondaryPriceCards({ cards, primaryItemId }) {
  const secondary = (cards || []).filter((c) => c.goldbridge_item_id !== primaryItemId);

  if (secondary.length === 0) return null;

  // More cards -> smaller card size, via a density class rather than
  // per-card inline styles, so the CSS stays the single source of
  // truth for exact sizes/breakpoints.
  const density =
    secondary.length <= 3 ? "roomy" : secondary.length <= 6 ? "cozy" : "compact";

  return (
    <div className={`secondary-cards secondary-cards--${density}`}>
      {secondary.map((c) => (
        <div key={c.goldbridge_item_id} className="secondary-card">
          <div className="secondary-card__name">
            {c.name}
            <span className="secondary-card__type">{TYPE_LABEL[c.type] || ""}</span>
          </div>
          <div className="secondary-card__values">
            <div className="secondary-card__value secondary-card__value--sell">
              <span className="secondary-card__label">فروش</span>
              <span className="secondary-card__amount">{fa(Math.round(c.sell_price))}</span>
            </div>
            <div className="secondary-card__value secondary-card__value--buy">
              <span className="secondary-card__label">خرید</span>
              <span className="secondary-card__amount">{fa(Math.round(c.buy_price))}</span>
            </div>
          </div>
          {!c.is_orderable && <span className="secondary-card__readonly">فقط نمایشی</span>}
        </div>
      ))}
    </div>
  );
}