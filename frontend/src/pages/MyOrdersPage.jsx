import { useEffect, useMemo, useState } from "react";
import { formatTehranDateTime, tehranDayKey, tehranThisWeekExcludingToday, tehranTodayKey } from "../utils/tehranTime";
import { fetchMyOrders, fetchMyBalance, fetchReceiptBlobUrl, uploadReceipt, cancelMyOrder, fetchOrderLimits } from "../api";
import {
  downloadOrderReceipt,
  downloadOrdersReceipt,
  buildOrderReceiptHtml,
  buildOrdersReceiptHtml,
} from "../utils/printReceipt";
import { formatCashStatus, formatGoldStatus } from "../utils/balanceFormat";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import BottomTabBar from "../components/BottomTabBar";
import JalaliDateInput from "../components/JalaliDateInput";
import ReceiptPreviewModal from "../components/ReceiptPreviewModal";

const SIDE_LABEL = { buy: "خرید", sell: "فروش" };
const AMOUNT_LABEL = { weight: "گرم ۱۸", amount: "تومان" };
const STATUS_LABEL = {
  pending: "در انتظار",
  accepted: "تایید شده",
  rejected: "رد شده",
  cancelled: "لغو شده",
};

const FILTERS = [
  { key: null, label: "همه" },
  { key: "pending", label: "در انتظار" },
  { key: "accepted", label: "تایید شده" },
  { key: "rejected", label: "رد شده" },
];

function fa(n, opts) {
  return Number(n).toLocaleString("en-US", opts);
}

function formatValue(order) {
  const opts = order.amount_type === "weight" ? { maximumFractionDigits: 3 } : { maximumFractionDigits: 0 };
  return `${fa(order.value, opts)} ${AMOUNT_LABEL[order.amount_type]}`;
}

function unitPriceForOrder(order, priceLabelMode) {
  if (priceLabelMode === "gram18_only") {
    return { label: "فی (گرم ۱۸)", value: order.price_at_submit };
  }
  return {
    label: "فی (مثقال ۱۷)",
    value: order.mesghal17_price_at_submit ?? order.price_at_submit,
  };
}

function formatDate(iso) {
  return formatTehranDateTime(iso);
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
  const [priceLabelMode, setPriceLabelMode] = useState("mesghal_and_gram18");
  const [preview, setPreview] = useState(null);

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
    fetchOrderLimits()
      .then((limits) => setPriceLabelMode(limits.price_label_mode || "mesghal_and_gram18"))
      .catch(() => {});
    const interval = setInterval(reload, 6000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = orders.filter((o) => {
    if (filter && o.status !== filter) return false;
    const day = tehranDayKey(o.created_at);
    if (!day) return false;
    if (dateFrom && day < dateFrom) return false;
    if (dateTo && day > dateTo) return false;
    return true;
  });

  const pdfOrders = useMemo(
    () => visible.filter((o) => o.status === "accepted"),
    [visible]
  );

  function applyToday() {
    const today = tehranTodayKey();
    setDateFrom(today);
    setDateTo(today);
  }

  function applyThisWeek() {
    const { from, to } = tehranThisWeekExcludingToday();
    setDateFrom(from);
    setDateTo(to);
  }

  function applyAll() {
    setDateFrom("");
    setDateTo("");
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

  async function handleCancelOrder(orderId) {
    if (!confirm("این درخواست لغو شود؟")) return;
    try {
      await cancelMyOrder(orderId);
      reload();
    } catch (e) {
      alert(e.message || "لغو درخواست با خطا مواجه شد.");
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
          {balance ? (
            (() => {
              const gStatus = formatGoldStatus(balance.gold_balance);
              return (
                <span className={`balance-card__value cash-status ${gStatus.className}`}>
                  {gStatus.amount}
                  <span className="balance-card__unit"> گرم ۱۸</span>
                  {gStatus.label && <span className="cash-status__label">{gStatus.label}</span>}
                </span>
              );
            })()
          ) : (
            <span className="balance-card__value">—</span>
          )}
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
          <button type="button" className="admin__filter" onClick={applyToday}>امروز</button>
          <button type="button" className="admin__filter" onClick={applyThisWeek}>این هفته</button>
          <button type="button" className="admin__filter" onClick={applyAll}>کل</button>
          {(dateFrom || dateTo) && (
            <button type="button" className="admin__filter date-filter__clear" onClick={clearDateRange}>
              پاک کردن
            </button>
          )}
        </div>
        <div className="date-filter__inputs">
          <JalaliDateInput label="از" value={dateFrom} onChange={setDateFrom} />
          <JalaliDateInput label="تا" value={dateTo} onChange={setDateTo} />
        </div>
        <div className="date-filter__pdf-actions">
          <button
            type="button"
            className="date-filter__download-all"
            disabled={pdfOrders.length === 0}
            onClick={() => downloadOrdersReceipt(pdfOrders, { dateFrom, dateTo, priceLabelMode })}
          >
            دانلود همه ({fa(pdfOrders.length)}) — PDF
          </button>
          <button
            type="button"
            className="date-filter__download-all date-filter__download-all--ghost"
            disabled={pdfOrders.length === 0}
            onClick={() =>
              setPreview({
                title: `مشاهده گزارش (${fa(pdfOrders.length)})`,
                html: buildOrdersReceiptHtml(pdfOrders, { dateFrom, dateTo, priceLabelMode }),
                onDownload: () => downloadOrdersReceipt(pdfOrders, { dateFrom, dateTo, priceLabelMode }),
              })
            }
          >
            مشاهده در برنامه
          </button>
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
                {order.is_manual && <span className="manual-order-tag">دستی</span>}
                <span className={`history-card__status history-card__status--${order.status}`}>
                  {order.reject_reason === "price_change"
                    ? "رد — تغییر مظنه"
                    : STATUS_LABEL[order.status]}
                </span>
              </div>
              <div className="history-card__rows">
                <div className="history-card__row">
                  <span className="history-card__row-label">مقدار</span>
                  <span className="history-card__row-value">{formatValue(order)}</span>
                </div>
                <div className="history-card__row">
                  <span className="history-card__row-label">{unitPriceForOrder(order, priceLabelMode).label}</span>
                  <span className="history-card__row-value">
                    {fa(Math.round(unitPriceForOrder(order, priceLabelMode).value))} تومان
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

              {order.status === "pending" && (
                <button
                  type="button"
                  className="history-card__cancel-btn"
                  onClick={() => handleCancelOrder(order.id)}
                >
                  لغو درخواست
                </button>
              )}

              <div className="history-card__pdf-actions">
                <button
                  type="button"
                  className="history-card__pdf-btn"
                  onClick={() => downloadOrderReceipt(order, { priceLabelMode })}
                >
                  دانلود رسید (PDF)
                </button>
                <button
                  type="button"
                  className="history-card__pdf-btn history-card__pdf-btn--ghost"
                  onClick={() =>
                    setPreview({
                      title: "مشاهده رسید",
                      html: buildOrderReceiptHtml(order, { priceLabelMode }),
                      onDownload: () => downloadOrderReceipt(order, { priceLabelMode }),
                    })
                  }
                >
                  مشاهده در برنامه
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {preview && (
        <ReceiptPreviewModal
          title={preview.title}
          html={preview.html}
          onDownload={preview.onDownload}
          onClose={() => setPreview(null)}
        />
      )}
      <BottomTabBar userPhone={user?.phone_number} onLogout={logout} />
    </div>
  );
}
