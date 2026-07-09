import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchMyOrders, fetchMyBalance, fetchReceiptBlobUrl, uploadReceipt } from "../api";
import { useAuth } from "../context/AuthContext";
import SideMenu from "../components/SideMenu";

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
  const [orders, setOrders] = useState([]);
  const [balance, setBalance] = useState(null);
  const [filter, setFilter] = useState(null);
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

  useEffect(reload, []);

  const visible = filter ? orders.filter((o) => o.status === filter) : orders;

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
    <div className="myorders">
      <header className="myorders__header">
        <SideMenu userPhone={user?.phone_number} onLogout={logout} />
        <h1 className="myorders__title">سفارش‌های من</h1>
        <Link to="/" className="myorders__back">‹ بازگشت</Link>
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
    </div>
  );
}