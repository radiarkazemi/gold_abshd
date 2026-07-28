import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchMyBalance, fetchMyOrders } from "../api";
import { formatCashStatus, formatGoldStatus } from "../utils/balanceFormat";

const SIDE_LABEL = { buy: "خرید", sell: "فروش" };
const STATUS_LABEL = { pending: "در انتظار", accepted: "تایید شده", rejected: "رد شده", cancelled: "لغو شده" };
const STATUS_CLASS = {
  pending: "recent-orders__status--pending",
  accepted: "recent-orders__status--accepted",
  rejected: "recent-orders__status--rejected",
  cancelled: "recent-orders__status--rejected",
};

function fa(n, opts) {
  return Number(n).toLocaleString("en-US", opts);
}

function formatTime(iso) {
  return new Date(iso).toLocaleString("fa-IR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function RecentOrdersTable({ limit = 5, refreshSignal }) {
  const [orders, setOrders] = useState(null);
  const [balance, setBalance] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    function load() {
      Promise.all([fetchMyOrders(), fetchMyBalance()])
        .then(([data, balanceData]) => {
          setOrders(data.slice(0, limit));
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
        setOrders(data.slice(0, limit));
        setBalance(balanceData);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  if (orders === null || orders.length === 0) return null;

  const goldStatus = balance ? formatGoldStatus(balance.gold_balance) : null;
  const cashStatus = balance ? formatCashStatus(balance.cash_balance) : null;

  return (
    <div className="recent-orders">
      <h3 className="recent-orders__title">آخرین سفارش‌ها</h3>
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
                ? `${fa(o.value, { maximumFractionDigits: 3 })} گرم۱۸`
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