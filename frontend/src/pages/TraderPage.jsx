import { useState, useEffect } from "react";
import { usePriceFeed } from "../hooks/usePriceFeed";
import { submitOrder, fetchSettlementLabel, fetchTradingStatus } from "../api";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import PriceCardRow from "../components/PriceCardRow";
import OrderModal from "../components/OrderModal";
import NoticeCard from "../components/NoticeCard";
import NoticeModal from "../components/NoticeModal";
import RecentOrdersTable from "../components/RecentOrdersTable";
import BottomTabBar from "../components/BottomTabBar";
import RefreshBar from "../components/RefreshBar";

export default function TraderPage() {
  const { cards, prevCards, connected, priceLabelMode } = usePriceFeed();
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [activeOrder, setActiveOrder] = useState(null); // { card, side } | null
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [settlement, setSettlement] = useState(null);
  const [tradingOnline, setTradingOnline] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

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
    if (!tradingOnline) return;
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

  return (
    <div className="app">
      <NoticeModal />
      <header className="app__header">
        <span className={`app__status ${tradingOnline ? "is-live" : "is-offline"}`}>
          <span className="app__status-dot" />
          {tradingOnline ? "مدیر آنلاین" : "مدیر آفلاین"}
        </span>
        <h1 className="app__title">آبشده قصر طلا</h1>
        <button className="theme-toggle-btn" onClick={toggleTheme} aria-label="تغییر پوسته">
          {theme === "dark" ? "☀" : "☾"}
        </button>
      </header>

      <div className={`trading-status-bar ${tradingOnline ? "is-online" : "is-offline"}`} />

      <main className="app__main app__main--with-tabbar">
        <RefreshBar onRefresh={handleManualRefresh} />

        {settlement && (
          <p className="price-updated-note">
            <span className="settlement-badge">{settlement.label}</span>
          </p>
        )}
        {!tradingOnline && (
          <p className="trading-offline-note">
            در حال حاضر امکان ثبت سفارش خرید و فروش وجود ندارد.
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
                disabled={!tradingOnline}
                priceLabelMode={priceLabelMode}
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
                    disabled={!tradingOnline}
                    priceLabelMode={priceLabelMode}
                  />
                ))}
              </div>
            )}
          </>
        )}

        <NoticeCard />
        <RecentOrdersTable refreshSignal={refreshKey} limit={5} />
      </main>

      {activeOrder && (
        <OrderModal
          card={activeOrder.card}
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