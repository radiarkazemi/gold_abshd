import { useEffect, useRef, useState, useCallback } from "react";
import { formatTehranTime } from "../utils/tehranTime";
import { fetchOrders, decideOrder, openAdminSocket, getAdminToken, clearAdminToken, fetchReceiptBlobUrlAsAdmin, getAdminIdentity, refreshAdminSession, fetchPrice, fetchAdminKycPending } from "../api";
import PendingCountdown from "../components/PendingCountdown";
import AdminUsersTab from "./AdminUsersTab";
import AdminLoginPage from "./AdminLoginPage";
import AdminNoticeTab from "./AdminNoticeTab";
import AdminAddUserTab from "./AdminAddUserTab";
import AdminRolesTab from "./AdminRolesTab";
import AdminCalendarTab from "./AdminCalendarTab";
import AdminDashboardTab from "./AdminDashboardTab";
import AdminExpertTab from "./AdminExpertTab";
import AdminPhoneOrderTab from "./AdminPhoneOrderTab";
import AdminPricesTab from "./AdminPricesTab";
import AdminAccountsTab from "./AdminAccountsTab";
import AdminKycTab from "./AdminKycTab";
import AdminTransfersTab from "./AdminTransfersTab";
import AdminShell from "../components/AdminShell";
import JalaliDateInput from "../components/JalaliDateInput";
import { playNotificationSound, playKycNotificationSound, unlockNotificationAudio } from "../utils/notificationSound";
import {
  ensureNotificationPermission,
  notifyNewOrder,
  notifyNewKyc,
  registerNotifyServiceWorker,
  subscribeAdminPush,
  pushSupportInfo,
} from "../utils/desktopNotify";
import { applyAdminPwaManifest } from "../utils/adminManifest";
import AdminNotifyBanner from "../components/AdminNotifyBanner";
import { orderGoldWeight, orderTotalMoney, summarizeOrders } from "../utils/orderCalc";
import { formatCashStatus } from "../utils/balanceFormat";
import { remainingFromOrder } from "../utils/orderCountdown";
import { orderPriceChangeLabel } from "../utils/orderPriceChange";

function fa(n, opts) {
  return Number(n).toLocaleString("fa-IR", opts);
}

const SIDE_LABEL = { buy: "خرید مشتری از ما", sell: "فروش مشتری به ما" };
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
  return formatTehranTime(iso);
}


function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function shouldShowInOrdersTable(order) {
  if (order.status !== "pending") return true;
  return remainingFromOrder(order) > 0;
}

function AdminPanel({ onLogout, identity }) {
  const [tab, setTab] = useState(
    identity.is_super || (identity.permissions || []).includes("dashboard")
      ? "dashboard"
      : (identity.permissions || [])[0] || "dashboard"
  );
  const [orders, setOrders] = useState([]);
  const [filter, setFilter] = useState("pending");
  const [connected, setConnected] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [kycPendingCount, setKycPendingCount] = useState(0);
  const [newOrderFlash, setNewOrderFlash] = useState(false);
  const [newKycFlash, setNewKycFlash] = useState(false);
  const [notifyBanner, setNotifyBanner] = useState(null); // { kind, title, body, tab }
  const [pushHint, setPushHint] = useState("");
  const notifyTimerRef = useRef(null);
  const [wsTick, setWsTick] = useState(0);
  const [dateFrom, setDateFrom] = useState(todayIso());
  const [dateTo, setDateTo] = useState(todayIso());
  const [liveCards, setLiveCards] = useState([]);
  const visibleOrders = orders.filter(shouldShowInOrdersTable);
  const dateFilteredOrders = visibleOrders.filter((o) => {
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

  function refreshKycPendingCount() {
    fetchAdminKycPending()
      .then((data) => {
        const list = Array.isArray(data) ? data : [];
        // API returns pending + approved; badge must count pending only.
        setKycPendingCount(list.filter((row) => row.kyc_status === "pending").length);
      })
      .catch(() => {});
  }

  const handlePendingExpire = useCallback((orderId) => {
    setOrders((list) => list.filter((o) => o.id !== orderId));
    if (filter === "pending" || filter === null) {
      setPendingCount((c) => Math.max(0, c - 1));
    }
  }, [filter]);

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
    refreshKycPendingCount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  useEffect(() => {
    // Point "Add to Home Screen" at the admin panel, not the client app.
    return applyAdminPwaManifest();
  }, []);

  useEffect(() => {
    // OS notifications: Windows Action Center when the browser is
    // minimized/backgrounded, and native mobile notifications + Web Push
    // so locked phones still get order alerts with sound.
    (async () => {
      const info = pushSupportInfo();
      if (!info.secureContext) {
        setPushHint(
          "برای اعلان بالای صفحه وقتی مرورگر بسته است، سایت باید HTTPS باشد. الان فقط با باز بودن پنل صدا/بنر کار می‌کند."
        );
      }
      await registerNotifyServiceWorker();
      const perm = await ensureNotificationPermission();
      if (perm === "granted") {
        const ok = await subscribeAdminPush();
        if (!ok && info.secureContext) {
          setPushHint("ثبت اعلان پس‌زمینه ناموفق بود — یک‌بار از پنل خارج شوید و دوباره وارد شوید.");
        } else if (ok) {
          setPushHint("");
        }
      } else if (perm === "denied") {
        setPushHint("مجوز اعلان مرورگر رد شده است — از تنظیمات سایت مجوز Notifications را فعال کنید.");
      }
    })();

    // Unlock WebAudio on first user gesture so later order chimes play
    // reliably on mobile (browsers suspend AudioContext until then).
    const unlock = () => {
      unlockNotificationAudio();
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      window.removeEventListener("touchstart", unlock);
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    window.addEventListener("touchstart", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      window.removeEventListener("touchstart", unlock);
    };
  }, []);

  function showNotifyBanner(item) {
    setNotifyBanner(item);
    if (notifyTimerRef.current) clearTimeout(notifyTimerRef.current);
    // Brief popup — auto-dismiss quickly like Samsung/Android brief style.
    notifyTimerRef.current = setTimeout(() => setNotifyBanner(null), 5500);
  }

  // Push arrived while this admin client is alive (background or foreground):
  // play our custom WAV + show the brief top popup card.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return undefined;
    function onSwMessage(event) {
      const msg = event.data || {};
      if (msg.type !== "ADMIN_PUSH_ALERT") return;
      unlockNotificationAudio();
      const isKyc = msg.kind === "new_kyc";
      if (isKyc) {
        playKycNotificationSound();
        refreshKycPendingCount();
      } else {
        playNotificationSound();
        refreshPendingCount();
        reload(filter);
      }
      showNotifyBanner({
        kind: isKyc ? "kyc" : "order",
        title: msg.title || (isKyc ? "احراز هویت جدید" : "سفارش جدید"),
        body: msg.body || "",
        tab: isKyc ? "kyc" : "orders",
      });
    }
    navigator.serviceWorker.addEventListener("message", onSwMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onSwMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  useEffect(() => {
    function loadPrices() {
      fetchPrice()
        .then((payload) => setLiveCards(payload.cards || []))
        .catch(() => {});
    }
    loadPrices();
    const interval = setInterval(loadPrices, 2000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const ws = openAdminSocket((message) => {
      setWsTick((t) => t + 1);

      if (message?.type === "new_kyc") {
        refreshKycPendingCount();
        unlockNotificationAudio();
        playKycNotificationSound();
        setNewKycFlash(true);
        setTimeout(() => setNewKycFlash(false), 3200);
        const u = message.user || {};
        const name = u.full_name || "مشتری";
        const code = u.user_code != null ? `#${u.user_code}` : "";
        showNotifyBanner({
          kind: "kyc",
          title: `${name} ${code}`.trim(),
          body: u.phone_number || "درخواست احراز هویت جدید",
          tab: "kyc",
        });
        notifyNewKyc(message.user);
        return;
      }

      // order events: refresh the current orders view + pending badge
      reload(filter);
      refreshPendingCount();

      if (message?.type === "new_order") {
        unlockNotificationAudio();
        playNotificationSound();
        setNewOrderFlash(true);
        setTimeout(() => setNewOrderFlash(false), 2500);
        const o = message.order || {};
        const side = o.side === "buy" ? "خرید" : o.side === "sell" ? "فروش" : "سفارش";
        const name = o.customer_name || "مشتری";
        const code = o.customer_code != null ? `#${o.customer_code}` : "";
        const unit = o.amount_type === "weight" ? "گرم ۱۸" : "تومان";
        const value =
          o.value != null ? `${Number(o.value).toLocaleString("fa-IR")} ${unit}` : "";
        showNotifyBanner({
          kind: "order",
          title: `${side} — ${name} ${code}`.trim(),
          body: value,
          tab: "orders",
        });
        // System notification (Windows when browser is down + mobile notif)
        notifyNewOrder(message.order);
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
      kycPendingCount={kycPendingCount}
      connected={connected}
      onLogout={onLogout}
      identity={identity}
    >
      {notifyBanner && (
        <AdminNotifyBanner
          item={notifyBanner}
          onClose={() => setNotifyBanner(null)}
          onOpen={() => {
            if (notifyBanner.tab) setTab(notifyBanner.tab);
            setNotifyBanner(null);
          }}
        />
      )}
      {pushHint && <p className="admin-push-hint">{pushHint}</p>}
      {newOrderFlash && (
        <div className="new-order-flash">سفارش جدید دریافت شد</div>
      )}
      {newKycFlash && (
        <div className="new-kyc-flash">درخواست احراز هویت جدید دریافت شد</div>
      )}
      {tab === "dashboard" ? (
        <AdminDashboardTab onGoToOrders={() => setTab("orders")} refreshSignal={wsTick} />
      ) : tab === "expert" ? (
        <AdminExpertTab refreshSignal={wsTick} />
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
      ) : tab === "prices" ? (
        <AdminPricesTab />
      ) : tab === "kyc" ? (
        <AdminKycTab
          refreshSignal={wsTick}
          onPendingChange={(n) => setKycPendingCount(n)}
        />
      ) : tab === "transfers" ? (
        <AdminTransfersTab />
      ) : tab === "admins" ? (
        <AdminAccountsTab />
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
                    <th>مهلت</th>
                    <th>وضعیت</th>
                    <th>عملیات</th>
                  </tr>
                </thead>
                <tbody>
                  {dateFilteredOrders.map((order) => {
                    const priceMove = orderPriceChangeLabel(order, liveCards);
                    return (
                    <tr key={order.id}>
                      <td data-label="نوع">
                        <span className={`order-card__badge order-card__badge--${order.side}`}>
                          {SIDE_LABEL[order.side]}
                        </span>
                        {order.is_manual && <span className="manual-order-tag">دستی</span>}
                        {priceMove && <span className="order-price-changed-tag">قیمت تغییر کرد</span>}
                      </td>
                      <td data-label="وزن طلا">{fa(orderGoldWeight(order), { maximumFractionDigits: 3 })} گرم۱۸</td>
                      <td data-label="مبلغ کل">{fa(Math.round(orderTotalMoney(order)))} ت</td>
                      <td data-label="قیمت (مثقال ۱۷)">
                        {order.mesghal17_price_at_submit ? fa(Math.round(order.mesghal17_price_at_submit)) : "—"}
                        {priceMove && (
                          <span className="order-price-changed-note">
                            {" "}الان: {fa(priceMove.to)}
                          </span>
                        )}
                      </td>
                      <td data-label="مشتری" dir="ltr" className="order-table__customer">
                        {order.customer_name || "بدون نام"} #{order.customer_code}
                      </td>
                      <td data-label="موجودی مشتری" className="order-table__balance">
                        <span>{fa(order.customer_gold_balance, { maximumFractionDigits: 3 })} گرم۱۸</span>
                        <span className={formatCashStatus(order.customer_cash_balance).className}>
                          {formatCashStatus(order.customer_cash_balance).amount} ت
                        </span>
                      </td>
                      <td data-label="زمان">{formatTime(order.created_at)}</td>
                      <td data-label="مهلت">
                        {order.status === "pending" ? (
                          <PendingCountdown order={order} onExpire={handlePendingExpire} />
                        ) : (
                          <span className="order-card__countdown order-card__countdown--na">—</span>
                        )}
                      </td>
                      <td data-label="وضعیت">
                        {order.status === "pending" ? (
                          <span className="order-card__status order-card__status--pending">در انتظار</span>
                        ) : order.reject_reason === "price_change" ? (
                          <span className="order-card__status order-card__status--rejected">
                            رد — تغییر مظنه
                          </span>
                        ) : (
                          <span className={`order-card__status order-card__status--${order.status}`}>
                            {STATUS_LABEL[order.status]}
                          </span>
                        )}
                      </td>
                      <td data-label="عملیات">
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
                              <button
                                className="order-btn order-btn--reject-price"
                                disabled={busyId === order.id}
                                onClick={() => handleDecision(order.id, "rejected_price_change")}
                              >
                                رد به دلیل تغییر مظنه
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
                        </div>
                      </td>
                    </tr>
                    );
                  })}
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
  const [identity, setIdentity] = useState(() => getAdminIdentity());
  const [sessionReady, setSessionReady] = useState(!getAdminToken());

  useEffect(() => {
    if (!loggedIn) {
      setSessionReady(true);
      return undefined;
    }
    let cancelled = false;
    setSessionReady(false);
    refreshAdminSession()
      .then((data) => {
        if (cancelled) return;
        setIdentity({
          is_super: data.is_super,
          permissions: data.permissions || [],
          display_name: data.display_name || "",
        });
        setSessionReady(true);
      })
      .catch((e) => {
        if (cancelled) return;
        if (e.message === "ADMIN_SESSION_EXPIRED") {
          clearAdminToken();
          setLoggedIn(false);
        }
        setSessionReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [loggedIn]);

  function handleLogout() {
    clearAdminToken();
    setLoggedIn(false);
  }

  function handleLoggedIn() {
    setIdentity(getAdminIdentity());
    setLoggedIn(true);
  }

  if (!loggedIn) {
    return <AdminLoginPage onLoggedIn={handleLoggedIn} />;
  }

  if (!sessionReady) {
    return <p className="myorders__empty">در حال آماده‌سازی پنل…</p>;
  }

  return <AdminPanel onLogout={handleLogout} identity={identity} />;
}
