import { useEffect, useState } from "react";
import { fetchOrders, decideOrder, fetchAdminUsers } from "../api";
import { orderGoldWeight, orderTotalMoney } from "../utils/orderCalc";

const SIDE_LABEL = { buy: "خرید", sell: "فروش" };

function fa(n) {
  return Number(n).toLocaleString("fa-IR");
}

function formatValue(order) {
  const unit = order.amount_type === "weight" ? "گرم ۱۸" : "تومان";
  return `${fa(order.value)} ${unit}`;
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" });
}

export default function AdminDashboardTab({ onGoToOrders, refreshSignal }) {
  const [pending, setPending] = useState([]);
  const [accepted, setAccepted] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  function reload() {
    Promise.all([
      fetchOrders("pending"),
      fetchOrders("accepted"),
      fetchAdminUsers(),
    ])
      .then(([p, a, u]) => {
        setPending(p);
        setAccepted(a);
        setUsers(u);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    reload();
    // fallback in case the websocket ever disconnects without reconnecting
    const interval = setInterval(reload, 8000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Also refresh the instant the parent's admin websocket sees any
  // new_order/order_updated event - this is what makes it feel instant
  // instead of waiting for the next poll tick.
  useEffect(() => {
    if (refreshSignal !== undefined) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  async function handleDecision(orderId, status) {
    setBusyId(orderId);
    try {
      await decideOrder(orderId, status);
      reload();
    } catch (e) {
      alert("عملیات با خطا مواجه شد.");
    } finally {
      setBusyId(null);
    }
  }

  const blockedCount = users.filter((u) => u.is_blocked).length;

  const kpis = [
    { label: "سفارش‌های در انتظار", value: pending.length, color: "var(--gold-bright)" },
    { label: "سفارش‌های تایید شده", value: accepted.length, color: "var(--buy-bright)" },
    { label: "تعداد کاربران", value: users.length, color: "var(--text)" },
    { label: "کاربران مسدود", value: blockedCount, color: "var(--sell-bright)" },
  ];

  if (loading) return <p className="myorders__empty">در حال بارگذاری…</p>;

  return (
    <div className="dashboard">
      <div className="dashboard__kpi-grid">
        {kpis.map((k) => (
          <div className="dashboard__kpi-card" key={k.label}>
            <span className="dashboard__kpi-label">{k.label}</span>
            <span className="dashboard__kpi-value" style={{ color: k.color }}>{fa(k.value)}</span>
          </div>
        ))}
      </div>

      <div>
        <div className="dashboard__section-head">
          <h3 className="dashboard__section-title">سفارش‌های در انتظار بررسی</h3>
          <button className="dashboard__see-all" onClick={onGoToOrders}>مشاهده همه سفارش‌ها ‹</button>
        </div>

        {pending.length === 0 ? (
          <p className="myorders__empty" style={{ background: "var(--surface)", border: "1px solid var(--hairline)", borderRadius: 12 }}>
            سفارش در انتظاری وجود ندارد.
          </p>
        ) : (
          <div className="dashboard__pending-list">
            {pending.slice(0, 3).map((order) => (
              <div key={order.id} className={`order-card order-card--${order.side}`}>
                <div className="order-card__top">
                  <span className={`order-card__badge order-card__badge--${order.side}`}>
                    {SIDE_LABEL[order.side]}
                  </span>
                  <span className="order-card__time">{formatTime(order.created_at)}</span>
                </div>
                <div className="order-card__body">
                  <div className="order-card__row">
                    <span className="order-card__label">مشتری</span>
                    <span className="order-card__value">
                      {order.customer_name || "بدون نام"} #{order.customer_code}
                    </span>
                  </div>
                  <div className="order-card__row">
                    <span className="order-card__label">وزن طلا</span>
                    <span className="order-card__value">{fa(orderGoldWeight(order), { maximumFractionDigits: 4 })} گرم۱۸</span>
                  </div>
                  <div className="order-card__row">
                    <span className="order-card__label">مبلغ کل</span>
                    <span className="order-card__value">{fa(Math.round(orderTotalMoney(order)))} تومان</span>
                  </div>
                  <div className="order-card__row">
                    <span className="order-card__label">قیمت (مثقال ۱۷)</span>
                    <span className="order-card__value">
                      {order.mesghal17_price_at_submit ? fa(Math.round(order.mesghal17_price_at_submit)) : "—"} تومان
                    </span>
                  </div>
                </div>
                <div className="order-card__actions">
                  <button
                    className="order-btn order-btn--reject"
                    disabled={busyId === order.id}
                    onClick={() => handleDecision(order.id, "rejected")}
                  >
                    رد
                  </button>
                  <button
                    className="order-btn order-btn--accept"
                    disabled={busyId === order.id}
                    onClick={() => handleDecision(order.id, "accepted")}
                  >
                    تایید
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}