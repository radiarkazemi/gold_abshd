import { useEffect, useState } from "react";
import { formatTehranDateTime, tehranDayKey, tehranTodayKey } from "../utils/tehranTime";
import { fetchMyOrders } from "../api";
import { orderGoldWeight } from "../utils/orderCalc";

const SIDE_LABEL = { buy: "خرید", sell: "فروش" };
const STATUS_LABEL = { accepted: "تایید شده", rejected: "رد شده", cancelled: "لغو شده" };
const STATUS_CLASS = {
  accepted: "recent-orders__status--accepted",
  rejected: "recent-orders__status--rejected",
  cancelled: "recent-orders__status--rejected",
};

function fa(n, opts) {
  return Number(n).toLocaleString("en-US", opts);
}

function formatTime(iso) {
  return formatTehranDateTime(iso);
}

function isSettledStatus(status) {
  return status === "accepted" || status === "rejected" || status === "cancelled";
}

export default function RecentOrdersTable({ limit = 5, refreshSignal }) {
  const [orders, setOrders] = useState(null);

  function pickTodayOrders(data) {
    const today = tehranTodayKey();
    return (data || [])
      .filter((o) => isSettledStatus(o.status) && tehranDayKey(o.created_at) === today)
      .slice(0, limit);
  }

  useEffect(() => {
    function load() {
      fetchMyOrders()
        .then((data) => setOrders(pickTodayOrders(data)))
        .catch(() => setOrders([]));
    }
    load();
    const interval = setInterval(load, 6000);
    return () => clearInterval(interval);
  }, [limit]);

  useEffect(() => {
    if (refreshSignal === undefined) return;
    fetchMyOrders()
      .then((data) => setOrders(pickTodayOrders(data)))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  if (orders === null || orders.length === 0) return null;

  return (
    <div className="recent-orders">
      <h3 className="recent-orders__title">آخرین سفارش‌ها · امروز</h3>
      <div className="recent-orders__table">
        <div className="recent-orders__row recent-orders__row--head">
          <span>نوع</span>
          <span>مقدار</span>
          <span>مظنه</span>
          <span>وضعیت</span>
        </div>
        {orders.map((o) => (
          <div className="recent-orders__row" key={o.id}>
            <span className={`recent-orders__side recent-orders__side--${o.side}`}>
              {SIDE_LABEL[o.side]}
            </span>
            <span>{fa(orderGoldWeight(o), { maximumFractionDigits: 3 })} گرم</span>
            <span>
              {o.mesghal17_price_at_submit != null
                ? `${fa(Math.round(o.mesghal17_price_at_submit))} ت`
                : "—"}
            </span>
            <span className={`recent-orders__status ${STATUS_CLASS[o.status] || ""}`}>
              {STATUS_LABEL[o.status] || o.status}
            </span>
          </div>
        ))}
      </div>
      <span className="recent-orders__time-note">{formatTime(orders[0].created_at)} آخرین بروزرسانی</span>
    </div>
  );
}
