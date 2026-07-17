import { useEffect, useState } from "react";
import { fetchAllPrices } from "../api";

function fa(n, opts) {
  if (n == null) return "—";
  return Number(n).toLocaleString("fa-IR", opts);
}

// Rial -> Toman for display, matching the same conversion the live
// trading price goes through (see backend app/price_sources/api_source.py).
function toman(rial) {
  if (rial == null) return null;
  return rial / 10;
}

const TYPE_LABEL = { 1: "طلا (گرم/عیار)", 2: "سکه" };

export default function AdminPricesTab() {
  const [prices, setPrices] = useState(null);
  const [sourceUpdatedAt, setSourceUpdatedAt] = useState(null);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState("");
  const [lastFetched, setLastFetched] = useState(null);

  function reload() {
    fetchAllPrices()
      .then((data) => {
        setPrices(data.prices || []);
        setSourceUpdatedAt(data.source_updated_at || null);
        setStale(!!data.stale);
        setError("");
        setLastFetched(new Date());
      })
      .catch((e) => {
        console.error(e);
        setError("دریافت قیمت‌ها با خطا مواجه شد.");
      });
  }

  useEffect(() => {
    reload();
    // Matches goldbridge's own poll cadence (~2s) closely enough to feel
    // live without hammering the backend->goldbridge proxy hop.
    const interval = setInterval(reload, 3000);
    return () => clearInterval(interval);
  }, []);

  if (error && !prices) {
    return <p className="myorders__empty">{error}</p>;
  }

  if (!prices) {
    return <p className="myorders__empty">در حال بارگذاری…</p>;
  }

  return (
    <div className="admin-prices">
      <div className="admin-prices__head">
        <h3 className="dashboard__section-title">قیمت‌های دریافتی از API</h3>
        <div className="admin-prices__meta">
          {stale && <span className="admin-prices__stale-badge">⚠ قدیمی</span>}
          {sourceUpdatedAt && (
            <span className="admin-prices__updated">آخرین بروزرسانی منبع: {sourceUpdatedAt}</span>
          )}
          {lastFetched && (
            <span className="admin-prices__fetched">
              دریافت شد: {lastFetched.toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          )}
        </div>
      </div>

      {prices.length === 0 ? (
        <p className="myorders__empty">قیمتی دریافت نشده.</p>
      ) : (
        <div className="admin-prices__grid">
          {prices.map((p) => (
            <div
              key={p.id}
              className={`admin-price-card ${!p.active ? "admin-price-card--inactive" : ""}`}
            >
              <div className="admin-price-card__top">
                <span className="admin-price-card__name">{p.name}</span>
                <span className="admin-price-card__type">{TYPE_LABEL[p.type] || "—"}</span>
              </div>

              <div className="admin-price-card__values">
                <div className="admin-price-card__value-item admin-price-card__value-item--sell">
                  <span className="admin-price-card__value-label">فروش</span>
                  <span className="admin-price-card__value-amount">{fa(toman(p.sell))}</span>
                </div>
                <div className="admin-price-card__value-item admin-price-card__value-item--buy">
                  <span className="admin-price-card__value-label">خرید</span>
                  <span className="admin-price-card__value-amount">{fa(toman(p.buy))}</span>
                </div>
              </div>

              <div className="admin-price-card__flags">
                <span className={`admin-price-card__flag ${p.active ? "is-on" : "is-off"}`}>
                  {p.active ? "فعال" : "غیرفعال"}
                </span>
                <span className={`admin-price-card__flag ${p.allow_buy ? "is-on" : "is-off"}`}>
                  خرید {p.allow_buy ? "مجاز" : "غیرمجاز"}
                </span>
                <span className={`admin-price-card__flag ${p.allow_sell ? "is-on" : "is-off"}`}>
                  فروش {p.allow_sell ? "مجاز" : "غیرمجاز"}
                </span>
              </div>

              <div className="admin-price-card__footer">
                <span>id: {p.id}</span>
                {p.last_update_time && <span>{p.last_update_time}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}