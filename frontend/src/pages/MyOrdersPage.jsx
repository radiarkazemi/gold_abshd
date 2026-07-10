import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchMyOrders, fetchMyBalance, fetchReceiptBlobUrl, uploadReceipt } from "../api";
import { formatCashStatus } from "../utils/balanceFormat";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import BottomTabBar from "../components/BottomTabBar";

const SIDE_LABEL = { buy: "خرید", sell: "فروش" };
const AMOUNT_LABEL = { weight: "گرم ۱۸", amount: "تومان" };
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
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [orders, setOrders] = useState([]);
  const [balance, setBalance] = useState(null);
  const [filter, setFilter] = useState(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploadingId, setUploadingId] = useState(null);

  function reload() {
    Promise.all([fetchMyOrders(), fetchMyBalance()])
      .then(([o, b]) => {
        setOrders(o);
        setBalance(b);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    reload();
    const interval = setInterval(reload, 6000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = orders.filter((o) => {
    if (filter && o.status !== filter) return false;
    const created = new Date(o.created_at);
    if (dateFrom && created < new Date(dateFrom)) return false;
    if (dateTo && created > new Date(dateTo + "T23:59:59")) return false;
    return true;
  });

  function applyQuickRange(days) {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days);
    setDateFrom(from.toISOString().slice(0, 10));
    setDateTo(to.toISOString().slice(0, 10));
  }

  function clearDateRange() {
    setDateFrom("");
    setDateTo("");
  }

  async function handleViewReceipt(orderId) {
    try {
      const { url } = await fetchReceiptBlobUrl(orderId);
      window.open(url, "_blank");
    } catch (e) {
      console.error(e);
      alert("نمایش فیش با خطا مواجه شد.");
    }
  }

  async function handleUploadReceipt(orderId, file) {
    setUploadingId(orderId);
    try {
      await uploadReceipt(orderId, file);
      reload();
    } catch (e) {
      console.error(e);
      alert(e.message || "آپلود فیش با خطا مواجه شد.");
    } finally {
      setUploadingId(null);
    }
  }

  return (
    <div className="myorders myorders--with-tabbar">
      <header className="myorders__header">
        <span />
        <h1 className="myorders__title">سفارش‌های من</h1>
        <button className="theme-toggle-btn" onClick={toggleTheme} aria-label="تغییر پوسته">
          {theme === "dark" ? "☀" : "☾"}
        </button>
      </header>

      <div className="balance-card">
        <div className="balance-card__item">
          <span className="balance-card__label">موجودی طلا</span>
          <span className="balance-card__value">
            {balance ? fa(balance.gold_balance, { maximumFractionDigits: 4 }) : "—"}
            <span className="balance-card__unit"> گرم ۱۸</span>
          </span>
        </div>
        <div className="balance-card__divider" />
        <div className="balance-card__item">
          <span className="balance-card__label">وضعیت نقدی</span>
          {balance ? (
            (() => {
              const status = formatCashStatus(balance.cash_balance);
              return (
                <span className={`balance-card__value cash-status ${status.className}`}>
                  {status.amount}
                  <span className="balance-card__unit"> تومان</span>
                  <span className="cash-status__label">{status.label}</span>
                </span>
              );
            })()
          ) : (
            <span className="balance-card__value">—</span>
          )}
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

      <div className="date-filter">
        <div className="date-filter__quick">
          <button className="admin__filter" onClick={() => applyQuickRange(0)}>امروز</button>
          <button className="admin__filter" onClick={() => applyQuickRange(1)}>دیروز تا امروز</button>
          <button className="admin__filter" onClick={() => applyQuickRange(7)}>۷ روز اخیر</button>
          {(dateFrom || dateTo) && (
            <button className="admin__filter date-filter__clear" onClick={clearDateRange}>پاک کردن</button>
          )}
        </div>
        <div className="date-filter__inputs">
          <label className="date-filter__input-group">
            <span>از</span>
            <input type="date" className="field__input" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </label>
          <label className="date-filter__input-group">
            <span>تا</span>
            <input type="date" className="field__input" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </label>
        </div>
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
              <div className="history-card__rows">
                <div className="history-card__row">
                  <span className="history-card__row-label">مقدار</span>
                  <span className="history-card__row-value">{formatValue(order)}</span>
                </div>
                <div className="history-card__row">
                  <span className="history-card__row-label">فی</span>
                  <span className="history-card__row-value">
                    {fa(Math.round(order.price_at_submit))} تومان
                  </span>
                </div>
                <div className="history-card__row">
                  <span className="history-card__row-label">مبلغ کل</span>
                  <span className="history-card__row-value">
                    {order.amount_type === "amount"
                      ? fa(Math.round(order.value))
                      : fa(Math.round(order.value * order.price_at_submit))}{" "}
                    تومان
                  </span>
                </div>
                {order.description && (
                  <div className="history-card__row">
                    <span className="history-card__row-label">توضیحات</span>
                    <span className="history-card__row-value">{order.description}</span>
                  </div>
                )}
                <div className="history-card__row">
                  <span className="history-card__row-label">زمان</span>
                  <span className="history-card__row-value">{formatDate(order.created_at)}</span>
                </div>
              </div>

              {(order.has_receipt || order.status === "pending") && (
                <div className="receipt-section">
                  <span className="receipt-section__label">فیش واریز / حواله</span>
                  {order.has_receipt ? (
                    <button
                      type="button"
                      className="history-card__receipt-btn"
                      onClick={() => handleViewReceipt(order.id)}
                    >
                      مشاهده فیش
                    </button>
                  ) : (
                    <label className="receipt-section__upload">
                      {uploadingId === order.id ? (
                        <span>در حال آپلود…</span>
                      ) : (
                        <span>+ افزودن فیش واریز</span>
                      )}
                      <input
                        type="file"
                        accept=".jpg,.jpeg,.png,.pdf,.webp"
                        disabled={uploadingId === order.id}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleUploadReceipt(order.id, file);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <BottomTabBar userPhone={user?.phone_number} onLogout={logout} />
    </div>
  );
}