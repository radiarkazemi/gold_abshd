import { useEffect, useMemo, useState } from "react";
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

function pickTodayOrders(data) {
  const today = tehranTodayKey();
  return (data || []).filter(
    (o) => isSettledStatus(o.status) && tehranDayKey(o.created_at) === today
  );
}

export default function RecentOrdersTable({ limit = 5, refreshSignal }) {
  const [todayOrders, setTodayOrders] = useState(null);

  useEffect(() => {
    function load() {
      fetchMyOrders()
        .then((data) => setTodayOrders(pickTodayOrders(data)))
        .catch(() => setTodayOrders([]));
    }
    load();
    const interval = setInterval(load, 6000);
    return () => clearInterval(interval);
  }, [limit]);

  useEffect(() => {
    if (refreshSignal === undefined) return;
    fetchMyOrders()
      .then((data) => setTodayOrders(pickTodayOrders(data)))
      .catch(() => {});
  }, [refreshSignal]);

  const rows = useMemo(() => (todayOrders || []).slice(0, limit), [todayOrders, limit]);

  // Totals from the same today-settled set the table is built from (not only the visible slice).
  const totals = useMemo(() => {
    const list = todayOrders || [];
    let buy = 0;
    let sell = 0;
    for (const o of list) {
      const w = orderGoldWeight(o);
      if (o.side === "buy") buy += w;
      else if (o.side === "sell") sell += w;
    }
    return { buy, sell, net: buy - sell };
  }, [todayOrders]);

  if (todayOrders === null || todayOrders.length === 0) return null;

  const netClass =
    Math.abs(totals.net) < 1e-9
      ? "recent-orders__net--flat"
      : totals.net > 0
        ? "recent-orders__net--buy"
        : "recent-orders__net--sell";

  return (
    <div className="recent-orders">
      <h3 className="recent-orders__title">آخرین سفارش‌ها · امروز</h3>
      <div className="recent-orders__table">
        <div className="recent-orders__totals" role="group" aria-label="جمع امروز">
          <div className="recent-orders__totals-item recent-orders__totals-item--buy">
            <span className="recent-orders__totals-label">مجموع خریدها</span>
            <span className="recent-orders__totals-value">
              {fa(totals.buy, { maximumFractionDigits: 3 })}
              <span className="recent-orders__totals-unit">گرم</span>
            </span>
          </div>
          <div className="recent-orders__totals-item recent-orders__totals-item--sell">
            <span className="recent-orders__totals-label">مجموع فروش‌ها</span>
            <span className="recent-orders__totals-value">
              {fa(totals.sell, { maximumFractionDigits: 3 })}
              <span className="recent-orders__totals-unit">گرم</span>
            </span>
          </div>
          <div className={`recent-orders__totals-item recent-orders__totals-item--net ${netClass}`}>
            <span className="recent-orders__totals-label">تفاضل خرید و فروش</span>
            <span className="recent-orders__totals-value">
              {fa(Math.abs(totals.net), { maximumFractionDigits: 3 })}
              <span className="recent-orders__totals-unit">گرم</span>
            </span>
          </div>
        </div>

        <div className="recent-orders__row recent-orders__row--head">
          <span>نوع</span>
          <span>مقدار</span>
          <span>مظنه</span>
          <span>وضعیت</span>
        </div>
        {rows.map((o) => (
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
      <span className="recent-orders__time-note">{formatTime(rows[0].created_at)} آخرین بروزرسانی</span>
    </div>
  );
}
