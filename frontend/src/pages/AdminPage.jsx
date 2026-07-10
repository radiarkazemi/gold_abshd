import { useEffect, useRef, useState } from "react";
import { fetchOrders, decideOrder, openAdminSocket, getAdminToken, clearAdminToken, fetchReceiptBlobUrlAsAdmin } from "../api";
import AdminUsersTab from "./AdminUsersTab";
import AdminLoginPage from "./AdminLoginPage";
import AdminNoticeTab from "./AdminNoticeTab";
import AdminAddUserTab from "./AdminAddUserTab";
import AdminRolesTab from "./AdminRolesTab";
import AdminCalendarTab from "./AdminCalendarTab";
import AdminDashboardTab from "./AdminDashboardTab";
import AdminShell from "../components/AdminShell";
import { playNotificationSound } from "../utils/notificationSound";

const SIDE_LABEL = { buy: "خرید", sell: "فروش" };
const AMOUNT_LABEL = { weight: "گرم ۱۸", amount: "تومان" };
const STATUS_LABEL = {
  pending: "در انتظار",
  accepted: "تایید شده",
  rejected: "رد شده",
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

function AdminPanel({ onLogout }) {
  const [tab, setTab] = useState("dashboard");
  const [orders, setOrders] = useState([]);
  const [filter, setFilter] = useState("pending");
  const [connected, setConnected] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [newOrderFlash, setNewOrderFlash] = useState(false);
  const [wsTick, setWsTick] = useState(0);
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

          {orders.length === 0 ? (
            <p className="admin__empty">سفارشی برای نمایش نیست.</p>
          ) : (
            <div className="admin__list">
              {orders.map((order) => (
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
                      <span className="order-card__value" dir="ltr">
                        {order.customer_name || "بدون نام"} #{order.customer_code} · {order.customer_phone}
                      </span>
                    </div>
                    <div className="order-card__row">
                      <span className="order-card__label">مقدار</span>
                      <span className="order-card__value">{formatValue(order)}</span>
                    </div>
                    <div className="order-card__row">
                      <span className="order-card__label">قیمت لحظه ثبت</span>
                      <span className="order-card__value">{formatPrice(order.price_at_submit)} تومان</span>
                    </div>
                    {order.description && (
                      <div className="order-card__row">
                        <span className="order-card__label">توضیحات</span>
                        <span className="order-card__value">{order.description}</span>
                      </div>
                    )}
                  </div>

                  {order.has_receipt && (
                    <button
                      type="button"
                      className="history-card__receipt-btn"
                      onClick={() => handleViewReceipt(order.id)}
                      style={{ marginBottom: 10 }}
                    >
                      مشاهده فیش
                    </button>
                  )}

                  {order.status === "pending" ? (
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
                  ) : (
                    <div className={`order-card__status order-card__status--${order.status}`}>
                      {STATUS_LABEL[order.status]}
                    </div>
                  )}
                </div>
              ))}
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