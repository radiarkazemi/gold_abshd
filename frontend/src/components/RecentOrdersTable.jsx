import { useEffect, useState } from "react";
import { fetchMyOrders } from "../api";

const SIDE_LABEL = { buy: "خرید", sell: "فروش" };
const STATUS_LABEL = { pending: "در انتظار", accepted: "تایید شده", rejected: "رد شده" };
const STATUS_CLASS = {
  pending: "recent-orders__status--pending",
  accepted: "recent-orders__status--accepted",
  rejected: "recent-orders__status--rejected",
};

function fa(n, opts) {
  return Number(n).toLocaleString("fa-IR", opts);
}

function formatTime(iso) {
  return new Date(iso).toLocaleString("fa-IR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function RecentOrdersTable({ limit = 5 }) {
  const [orders, setOrders] = useState(null);

  useEffect(() => {
    function load() {
      fetchMyOrders()
        .then((data) => setOrders(data.slice(0, limit)))
        .catch(() => setOrders([]));
    }
    load();
    const interval = setInterval(load, 6000);
    return () => clearInterval(interval);
  }, [limit]);

  if (orders === null || orders.length === 0) return null;

  return (
    <div className="recent-orders">
      <h3 className="recent-orders__title">آخرین سفارش‌ها</h3>
      <div className="recent-orders__table">
        <div className="recent-orders__row recent-orders__row--head">
          <span>نوع</span>
          <span>مقدار</span>
          <span>مبلغ کل</span>
          <span>وضعیت</span>
        </div>
        {orders.map((o) => (
          <div className="recent-orders__row" key={o.id}>
            <span className={`recent-orders__side recent-orders__side--${o.side}`}>
              {SIDE_LABEL[o.side]}
            </span>
            <span>
              {o.amount_type === "weight"
                ? `${fa(o.value, { maximumFractionDigits: 2 })} گرم۱۸`
                : `${fa(Math.round(o.value))} ت`}
            </span>
            <span>
              {fa(
                Math.round(
                  o.amount_type === "amount" ? o.value : o.value * o.price_at_submit
                )
              )}{" "}
              ت
            </span>
            <span className={`recent-orders__status ${STATUS_CLASS[o.status]}`}>
              {STATUS_LABEL[o.status]}
            </span>
          </div>
        ))}
      </div>
      <span className="recent-orders__time-note">{formatTime(orders[0].created_at)} آخرین بروزرسانی</span>
    </div>
  );
}