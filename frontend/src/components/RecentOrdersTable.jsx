import { useEffect, useMemo, useState } from "react";
import { formatTehranDateTime, tehranDayKey, tehranTodayKey } from "../utils/tehranTime";
import { useNavigate } from "react-router-dom";
import { fetchMyBalance, fetchMyOrders } from "../api";
import { formatCashStatus, formatGoldStatus } from "../utils/balanceFormat";
import { orderGoldWeight, orderTotalMoney } from "../utils/orderCalc";

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
  const [balance, setBalance] = useState(null);
  const navigate = useNavigate();

  function pickTodayOrders(data) {
    const today = tehranTodayKey();
    return (data || [])
      .filter((o) => isSettledStatus(o.status) && tehranDayKey(o.created_at) === today)
      .slice(0, limit);
  }

  useEffect(() => {
    function load() {
      Promise.all([fetchMyOrders(), fetchMyBalance()])
        .then(([data, balanceData]) => {
          setOrders(pickTodayOrders(data));
          setBalance(balanceData);
        })
        .catch(() => {
          setOrders([]);
          setBalance(null);
        });
    }
    load();
    const interval = setInterval(load, 6000);
    return () => clearInterval(interval);
  }, [limit]);

  useEffect(() => {
    if (refreshSignal === undefined) return;
    Promise.all([fetchMyOrders(), fetchMyBalance()])
      .then(([data, balanceData]) => {
        setOrders(pickTodayOrders(data));
        setBalance(balanceData);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  const dayTotals = useMemo(() => {
    const list = orders || [];
    return {
      weight: list.reduce((s, o) => s + orderGoldWeight(o), 0),
      money: list.reduce((s, o) => s + orderTotalMoney(o), 0),
      count: list.length,
    };
  }, [orders]);

  if (orders === null || orders.length === 0) return null;

  const goldStatus = balance ? formatGoldStatus(balance.gold_balance) : null;
  const cashStatus = balance ? formatCashStatus(balance.cash_balance) : null;

  return (
    <div className="recent-orders">
      <h3 className="recent-orders__title">آخرین سفارش‌ها · امروز</h3>
      <div className="recent-orders__table">
        <button type="button" className="recent-orders__summary-row" onClick={() => navigate("/balance")}>
          <span className="recent-orders__summary-item">
            <span className="recent-orders__summary-label">موجودی طلا</span>
            <span className={`recent-orders__summary-value ${goldStatus ? goldStatus.className : ""}`}>
              {goldStatus ? goldStatus.amount : "—"}
              <span className="recent-orders__summary-unit"> گرم ۱۸{goldStatus?.label ? ` · ${goldStatus.label}` : ""}</span>
            </span>
          </span>
          <span className="recent-orders__summary-divider" />
          <span className="recent-orders__summary-item">
            <span className="recent-orders__summary-label">وضعیت نقدی</span>
            <span className={`recent-orders__summary-value ${cashStatus ? cashStatus.className : ""}`}>
              {cashStatus ? cashStatus.amount : "—"}
              <span className="recent-orders__summary-unit"> تومان{cashStatus?.label ? ` · ${cashStatus.label}` : ""}</span>
            </span>
          </span>
        </button>

        <div className="recent-orders__summary-row recent-orders__summary-row--day-totals" role="group" aria-label="جمع امروز">
          <span className="recent-orders__summary-item">
            <span className="recent-orders__summary-label">جمع وزن امروز</span>
            <span className="recent-orders__summary-value">
              {fa(dayTotals.weight, { maximumFractionDigits: 3 })}
              <span className="recent-orders__summary-unit"> گرم</span>
            </span>
          </span>
          <span className="recent-orders__summary-divider" />
          <span className="recent-orders__summary-item">
            <span className="recent-orders__summary-label">جمع مبلغ امروز</span>
            <span className="recent-orders__summary-value">
              {fa(Math.round(dayTotals.money))}
              <span className="recent-orders__summary-unit"> تومان</span>
            </span>
          </span>
        </div>

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
