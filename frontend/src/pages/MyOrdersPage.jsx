import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchMyOrders, fetchMyBalance } from "../api";

const SIDE_LABEL = { buy: "خرید", sell: "فروش" };
const AMOUNT_LABEL = { weight: "مثقال", amount: "تومان" };
const STATUS_LABEL = {
  pending: "در انتظار",
  accepted: "تایید شده",
  rejected: "رد شده",
};

const FILTERS = [
  { key: null, label: "همه" },
  { key: "pending", label: "در انتظار" },
  { key: "accepted", label: "تایید شده" },
  { key: "rejected", label: "رد شده" },
];

function fa(n, opts) {
  return Number(n).toLocaleString("fa-IR", opts);
}

function formatValue(order) {
  return `${fa(order.value, { maximumFractionDigits: 4 })} ${AMOUNT_LABEL[order.amount_type]}`;
}

function formatDate(iso) {
  return new Date(iso).toLocaleString("fa-IR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function MyOrdersPage() {
  const [orders, setOrders] = useState([]);
  const [balance, setBalance] = useState(null);
  const [filter, setFilter] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([fetchMyOrders(), fetchMyBalance()])
      .then(([o, b]) => {
        setOrders(o);
        setBalance(b);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const visible = filter ? orders.filter((o) => o.status === filter) : orders;

  return (
    <div className="myorders">
      <header className="myorders__header">
        <Link to="/" className="myorders__back">‹ بازگشت</Link>
        <h1 className="myorders__title">سفارش‌های من</h1>
      </header>

      <div className="balance-card">
        <div className="balance-card__item">
          <span className="balance-card__label">موجودی طلا</span>
          <span className="balance-card__value">
            {balance ? fa(balance.gold_balance, { maximumFractionDigits: 4 }) : "—"}
            <span className="balance-card__unit"> مثقال</span>
          </span>
        </div>
        <div className="balance-card__divider" />
        <div className="balance-card__item">
          <span className="balance-card__label">موجودی نقدی</span>
          <span className="balance-card__value">
            {balance ? fa(Math.round(balance.cash_balance)) : "—"}
            <span className="balance-card__unit"> تومان</span>
          </span>
        </div>
      </div>

      <div className="myorders__filters">
        {FILTERS.map((f) => (
          <button
            key={f.label}
            className={filter === f.key ? "admin__filter is-active" : "admin__filter"}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="myorders__empty">در حال بارگذاری…</p>
      ) : visible.length === 0 ? (
        <p className="myorders__empty">سفارشی برای نمایش نیست.</p>
      ) : (
        <div className="myorders__list">
          {visible.map((order) => (
            <div key={order.id} className={`history-card history-card--${order.side}`}>
              <div className="history-card__top">
                <span className={`order-card__badge order-card__badge--${order.side}`}>
                  {SIDE_LABEL[order.side]}
                </span>
                <span className={`history-card__status history-card__status--${order.status}`}>
                  {STATUS_LABEL[order.status]}
                </span>
              </div>
              <div className="history-card__grid">
                <div className="history-card__cell">
                  <span className="history-card__cell-label">مقدار</span>
                  <span className="history-card__cell-value">{formatValue(order)}</span>
                </div>
                <div className="history-card__cell">
                  <span className="history-card__cell-label">فی</span>
                  <span className="history-card__cell-value">
                    {fa(Math.round(order.price_at_submit))}
                  </span>
                </div>
                <div className="history-card__cell">
                  <span className="history-card__cell-label">مبلغ کل</span>
                  <span className="history-card__cell-value">
                    {order.amount_type === "amount"
                      ? fa(Math.round(order.value))
                      : fa(Math.round(order.value * order.price_at_submit))}
                  </span>
                </div>
              </div>
              {order.description && (
                <p className="history-card__desc">{order.description}</p>
              )}
              <span className="history-card__time">{formatDate(order.created_at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}