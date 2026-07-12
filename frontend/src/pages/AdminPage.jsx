import { useEffect, useRef, useState } from "react";
import { fetchOrders, decideOrder, openAdminSocket, getAdminToken, clearAdminToken, fetchReceiptBlobUrlAsAdmin } from "../api";
import AdminUsersTab from "./AdminUsersTab";
import AdminLoginPage from "./AdminLoginPage";
import AdminNoticeTab from "./AdminNoticeTab";
import AdminAddUserTab from "./AdminAddUserTab";
import AdminRolesTab from "./AdminRolesTab";
import AdminCalendarTab from "./AdminCalendarTab";
import AdminDashboardTab from "./AdminDashboardTab";
import AdminPhoneOrderTab from "./AdminPhoneOrderTab";
import AdminShell from "../components/AdminShell";
import JalaliDateInput from "../components/JalaliDateInput";
import { downloadOrderReceipt } from "../utils/printReceipt";
import { playNotificationSound } from "../utils/notificationSound";
import { orderGoldWeight, orderTotalMoney, summarizeOrders } from "../utils/orderCalc";
import { formatCashStatus } from "../utils/balanceFormat";

function fa(n, opts) {
  return Number(n).toLocaleString("fa-IR", opts);
}

const SIDE_LABEL = { buy: "خرید", sell: "فروش" };
const AMOUNT_LABEL = { weight: "گرم ۱۸", amount: "تومان" };
const STATUS_LABEL = {
  pending: "در انتظار",
  accepted: "تایید شده",
  rejected: "رد شده",
  cancelled: "لغو شده",
};

const FILTERS = [
  { key: "pending", label: "در انتظار" },
  { key: "accepted", label: "تایید شده" },
  { key: "rejected", label: "رد شده" },
  { key: null, label: "همه" },
];

function formatValue(order) {
  const num = order.value.toLocaleString("fa-IR");
  return `${num} ${AMOUNT_LABEL[order.amount_type]}`;
}

function formatPrice(value) {
  return Math.round(value).toLocaleString("fa-IR");
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" });
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function AdminPanel({ onLogout }) {
  const [tab, setTab] = useState("dashboard");
  const [orders, setOrders] = useState([]);
  const [filter, setFilter] = useState("pending");
  const [connected, setConnected] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [newOrderFlash, setNewOrderFlash] = useState(false);
  const [wsTick, setWsTick] = useState(0);
  const [dateFrom, setDateFrom] = useState(todayIso());
  const [dateTo, setDateTo] = useState(todayIso());
  const dateFilteredOrders = orders.filter((o) => {
    const d = o.created_at.slice(0, 10);
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    return true;
  });
  const orderTotals = summarizeOrders(dateFilteredOrders);
  const wsRef = useRef(null);

  function refreshPendingCount() {
    fetchOrders("pending").then((data) => setPendingCount(data.length)).catch(() => {});
  }

  async function reload(currentFilter = filter) {
    try {
      const data = await fetchOrders(currentFilter || undefined);
      setOrders(data);
    } catch (e) {
      if (e.message === "ADMIN_SESSION_EXPIRED") {
        onLogout();
        return;
      }
      console.error(e);
    }
  }

  useEffect(() => {
    reload(filter);
    refreshPendingCount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  useEffect(() => {
    const ws = openAdminSocket((message) => {
      // any new_order / order_updated event: just refresh the current view
      reload(filter);
      refreshPendingCount();
      setWsTick((t) => t + 1);

      if (message?.type === "new_order") {
        playNotificationSound();
        setNewOrderFlash(true);
        setTimeout(() => setNewOrderFlash(false), 2500);
      }
    });
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    wsRef.current = ws;
    return () => ws.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  async function handleDecision(orderId, status) {
    setBusyId(orderId);
    try {
      await decideOrder(orderId, status);
      await reload(filter);
      refreshPendingCount();
    } catch (e) {
      console.error(e);
      alert("عملیات با خطا مواجه شد.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleViewReceipt(orderId) {
    try {
      const { url } = await fetchReceiptBlobUrlAsAdmin(orderId);
      window.open(url, "_blank");
    } catch (e) {
      console.error(e);
      alert("نمایش فیش با خطا مواجه شد.");
    }
  }

  return (
    <AdminShell
      activeTab={tab}
      onTabChange={setTab}
      pendingCount={pendingCount}
      connected={connected}
      onLogout={onLogout}
    >
      {newOrderFlash && (
        <div className="new-order-flash">🔔 سفارش جدید دریافت شد</div>
      )}
      {tab === "dashboard" ? (
        <AdminDashboardTab onGoToOrders={() => setTab("orders")} refreshSignal={wsTick} />
      ) : tab === "users" ? (
        <AdminUsersTab />
      ) : tab === "notice" ? (
        <AdminNoticeTab />
      ) : tab === "add-user" ? (
        <AdminAddUserTab />
      ) : tab === "roles" ? (
        <AdminRolesTab />
      ) : tab === "calendar" ? (
        <AdminCalendarTab />
      ) : tab === "phone-order" ? (
        <AdminPhoneOrderTab />
      ) : (
        <>
          <div className="admin__filters">
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
              <button className="admin__filter" onClick={() => { setDateFrom(todayIso()); setDateTo(todayIso()); }}>
                امروز
              </button>
              <button className="admin__filter" onClick={() => { setDateFrom(""); setDateTo(""); }}>
                همه تاریخ‌ها
              </button>
            </div>
            <div className="date-filter__inputs">
              <JalaliDateInput label="از" value={dateFrom} onChange={setDateFrom} />
              <JalaliDateInput label="تا" value={dateTo} onChange={setDateTo} />
            </div>
          </div>

          {dateFilteredOrders.length > 0 && (
            <div className="order-totals">
              <div className="order-totals__item order-totals__item--buy">
                <span className="order-totals__label">مجموع خرید مشتری ({orderTotals.buy.count})</span>
                <span className="order-totals__value">{fa(orderTotals.buy.weight, { maximumFractionDigits: 3 })} گرم۱۸</span>
                <span className="order-totals__sub">{fa(Math.round(orderTotals.buy.money))} تومان</span>
              </div>
              <div className="order-totals__item order-totals__item--sell">
                <span className="order-totals__label">مجموع فروش مشتری ({orderTotals.sell.count})</span>
                <span className="order-totals__value">{fa(orderTotals.sell.weight, { maximumFractionDigits: 3 })} گرم۱۸</span>
                <span className="order-totals__sub">{fa(Math.round(orderTotals.sell.money))} تومان</span>
              </div>
            </div>
          )}

          {dateFilteredOrders.length === 0 ? (
            <p className="admin__empty">سفارشی برای نمایش نیست.</p>
          ) : (
            <div className="order-table-wrap">
              <table className="order-table">
                <thead>
                  <tr>
                    <th>نوع</th>
                    <th>وزن طلا</th>
                    <th>مبلغ کل</th>
                    <th>قیمت (مثقال ۱۷)</th>
                    <th>مشتری</th>
                    <th>موجودی مشتری</th>
                    <th>زمان</th>
                    <th>وضعیت</th>
                    <th>عملیات</th>
                  </tr>
                </thead>
                <tbody>
                  {dateFilteredOrders.map((order) => (
                    <tr key={order.id}>
                      <td>
                        <span className={`order-card__badge order-card__badge--${order.side}`}>
                          {SIDE_LABEL[order.side]}
                        </span>
                        {order.is_manual && <span className="manual-order-tag">دستی</span>}
                      </td>
                      <td>{fa(orderGoldWeight(order), { maximumFractionDigits: 3 })} گرم۱۸</td>
                      <td>{fa(Math.round(orderTotalMoney(order)))} ت</td>
                      <td>{order.mesghal17_price_at_submit ? fa(Math.round(order.mesghal17_price_at_submit)) : "—"}</td>
                      <td dir="ltr" className="order-table__customer">
                        {order.customer_name || "بدون نام"} #{order.customer_code}
                      </td>
                      <td className="order-table__balance">
                        <span>{fa(order.customer_gold_balance, { maximumFractionDigits: 3 })} گرم۱۸</span>
                        <span className={formatCashStatus(order.customer_cash_balance).className}>
                          {formatCashStatus(order.customer_cash_balance).amount} ت
                        </span>
                      </td>
                      <td>{formatTime(order.created_at)}</td>
                      <td>
                        {order.status === "pending" ? (
                          <span className="order-card__status order-card__status--pending">در انتظار</span>
                        ) : (
                          <span className={`order-card__status order-card__status--${order.status}`}>
                            {STATUS_LABEL[order.status]}
                          </span>
                        )}
                      </td>
                      <td>
                        <div className="order-table__actions">
                          {order.status === "pending" && (
                            <>
                              <button
                                className="order-btn order-btn--accept"
                                disabled={busyId === order.id}
                                onClick={() => handleDecision(order.id, "accepted")}
                              >
                                تایید
                              </button>
                              <button
                                className="order-btn order-btn--reject"
                                disabled={busyId === order.id}
                                onClick={() => handleDecision(order.id, "rejected")}
                              >
                                رد
                              </button>
                            </>
                          )}
                          {order.has_receipt && (
                            <button
                              className="order-table__receipt-btn"
                              onClick={() => handleViewReceipt(order.id)}
                            >
                              قبض
                            </button>
                          )}
                          <button
                            className="order-table__receipt-btn"
                            onClick={() => downloadOrderReceipt(order)}
                          >
                            PDF
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </AdminShell>
  );
}

export default function AdminPage() {
  const [loggedIn, setLoggedIn] = useState(!!getAdminToken());

  function handleLogout() {
    clearAdminToken();
    setLoggedIn(false);
  }

  if (!loggedIn) {
    return <AdminLoginPage onLoggedIn={() => setLoggedIn(true)} />;
  }

  return <AdminPanel onLogout={handleLogout} />;
}