import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { usePriceFeed } from "../hooks/usePriceFeed";
import { submitOrder, fetchSettlementLabel, fetchTradingStatus } from "../api";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { logoUrl } from "../brandAssets";
import PriceCardRow from "../components/PriceCardRow";
import OrderModal from "../components/OrderModal";
import NoticeCard from "../components/NoticeCard";
import RecentOrdersTable from "../components/RecentOrdersTable";
import BottomTabBar from "../components/BottomTabBar";
import RefreshBar from "../components/RefreshBar";

export default function TraderPage() {
  const { cards, prevCards, updatedAt, connected, priceLabelMode, tradingBanned, kycApproved, kycStatus } =
    usePriceFeed();
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [activeOrder, setActiveOrder] = useState(null); // { card, side } | null
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [settlement, setSettlement] = useState(null);
  const [tradingOnline, setTradingOnline] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const ordersLocked = tradingBanned || !kycApproved;

  async function handleManualRefresh() {
    setRefreshKey((k) => k + 1);
    await Promise.all([
      fetchSettlementLabel().then(setSettlement).catch(() => {}),
      fetchTradingStatus().then((s) => setTradingOnline(s.is_online)).catch(() => {}),
    ]);
  }

  useEffect(() => {
    fetchSettlementLabel().then(setSettlement).catch(() => {});
  }, []);

  useEffect(() => {
    function checkStatus() {
      fetchTradingStatus().then((s) => setTradingOnline(s.is_online)).catch(() => {});
    }
    checkStatus();
    const interval = setInterval(checkStatus, 10000);
    return () => clearInterval(interval);
  }, []);

  function openModal(card, side) {
    if (!tradingOnline || ordersLocked) return;
    setResult(null);
    setError("");
    setActiveOrder({ card, side });
  }

  function closeModal() {
    setActiveOrder(null);
    setResult(null);
    setError("");
  }

  async function handleSubmit(payload) {
    setSubmitting(true);
    setError("");
    try {
      const order = await submitOrder({ ...payload, goldbridgeItemId: activeOrder.card.goldbridge_item_id });
      setResult(order);
    } catch (e) {
      console.error(e);
      setError(e.message || "ارسال درخواست با خطا مواجه شد. دوباره تلاش کنید.");
    } finally {
      setSubmitting(false);
    }
  }

  const primaryCard = cards.find((c) => c.is_primary);
  const otherCards = cards.filter((c) => !c.is_primary);
  const prevByItemId = Object.fromEntries((prevCards || []).map((c) => [c.goldbridge_item_id, c]));
  // Keep the open modal on the LIVE card from the feed so form/confirm
  // price-change tags track market moves before submit.
  const liveModalCard = activeOrder
    ? cards.find((c) => c.goldbridge_item_id === activeOrder.card.goldbridge_item_id) || activeOrder.card
    : null;

  return (
    <div className="app">
      <header className="app__header">
        <span className={`app__status ${tradingOnline ? "is-live" : "is-offline"}`}>
          <span className="app__status-dot" />
          {tradingOnline ? "مدیر آنلاین" : "مدیر آفلاین"}
        </span>
        <h1 className="app__title">
          <img className="app__logo" src={logoUrl} alt="" width="36" height="36" />
          آبشده قصر طلا
        </h1>
        <button className="theme-toggle-btn" onClick={toggleTheme} aria-label="تغییر پوسته">
          {theme === "dark" ? "☀" : "☾"}
        </button>
      </header>

      <div className={`trading-status-bar ${tradingOnline ? "is-online" : "is-offline"}`} />

      <main className="app__main app__main--with-tabbar">
        <RefreshBar onRefresh={handleManualRefresh} />

        {!tradingOnline && (
          <p className="trading-offline-note">
            در حال حاضر امکان ثبت سفارش خرید و فروش وجود ندارد.
          </p>
        )}
        {tradingBanned && (
          <p className="trading-offline-note">
            امکان خرید و فروش برای این حساب غیرفعال شده است. مشاهده قیمت‌ها همچنان فعال است.
          </p>
        )}
        {!tradingBanned && !kycApproved && (
          <p className="trading-offline-note">
            {kycStatus === "pending"
              ? "مدارک احراز هویت در حال بررسی است؛ تا تایید مدیریت امکان ثبت سفارش ندارید. "
              : "برای ثبت سفارش باید احراز هویت را تکمیل کنید. "}
            <Link to="/kyc" className="trading-offline-note__link">
              رفتن به احراز هویت
            </Link>
          </p>
        )}

        {!primaryCard && otherCards.length === 0 ? (
          <p className="price-updated-note">در حال دریافت قیمت…</p>
        ) : (
          <>
            {primaryCard && (
              <PriceCardRow
                card={primaryCard}
                prevCard={prevByItemId[primaryCard.goldbridge_item_id]}
                onOrder={openModal}
                disabled={!tradingOnline || ordersLocked}
                priceLabelMode={priceLabelMode}
                feedUpdatedAt={updatedAt}
              />
            )}
            {otherCards.length > 0 && (
              <div className="secondary-cards-grid">
                {otherCards.map((card) => (
                  <PriceCardRow
                    key={card.goldbridge_item_id}
                    card={card}
                    prevCard={prevByItemId[card.goldbridge_item_id]}
                    onOrder={openModal}
                    disabled={!tradingOnline || ordersLocked}
                    priceLabelMode={priceLabelMode}
                    feedUpdatedAt={updatedAt}
                  />
                ))}
              </div>
            )}
          </>
        )}

        <NoticeCard />
        <RecentOrdersTable refreshSignal={refreshKey} limit={5} />
      </main>

      {activeOrder && liveModalCard && (
        <OrderModal
          card={liveModalCard}
          side={activeOrder.side}
          onClose={closeModal}
          onSubmit={handleSubmit}
          submitting={submitting}
          result={result}
          error={error}
        />
      )}

      <BottomTabBar userPhone={user?.phone_number} onLogout={logout} />
    </div>
  );
}