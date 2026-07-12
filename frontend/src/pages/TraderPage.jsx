import { useState, useEffect } from "react";
import { usePriceFeed } from "../hooks/usePriceFeed";
import { submitOrder, fetchSettlementLabel, fetchTradingStatus } from "../api";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import PriceButton from "../components/PriceButton";
import OrderModal from "../components/OrderModal";
import NoticeCard from "../components/NoticeCard";
import RecentOrdersTable from "../components/RecentOrdersTable";
import BalanceStrip from "../components/BalanceStrip";
import BottomTabBar from "../components/BottomTabBar";
import RefreshBar from "../components/RefreshBar";

export default function TraderPage() {
  const { price, prevPrice, connected } = usePriceFeed();
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [activeSide, setActiveSide] = useState(null); // "buy" | "sell" | null
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

  function openModal(side) {
    if (!tradingOnline) return;
    setResult(null);
    setError("");
    setActiveSide(side);
  }

  function closeModal() {
    setActiveSide(null);
    setResult(null);
    setError("");
  }

  async function handleSubmit(payload) {
    setSubmitting(true);
    setError("");
    try {
      const order = await submitOrder(payload);
      setResult(order);
    } catch (e) {
      console.error(e);
      setError(e.message || "ارسال درخواست با خطا مواجه شد. دوباره تلاش کنید.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="app">
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
        <BalanceStrip key={refreshKey} />

        {price?.updated_at && (
          <p className="price-updated-note">
            آخرین آپدیت قیمت:{" "}
            {new Date(price.updated_at).toLocaleString("fa-IR", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              weekday: "long",
            })}
            {settlement && <span className="settlement-badge"> · {settlement.label}</span>}
          </p>
        )}
        {!tradingOnline && (
          <p className="trading-offline-note">
            در حال حاضر امکان ثبت سفارش خرید و فروش وجود ندارد.
          </p>
        )}
        <RefreshBar onRefresh={handleManualRefresh} />
        <div className={`price-stage ${!tradingOnline ? "price-stage--disabled" : ""}`}>
          <PriceButton side="buy" price={price} prevPrice={prevPrice} onClick={openModal} disabled={!tradingOnline} />
          <PriceButton side="sell" price={price} prevPrice={prevPrice} onClick={openModal} disabled={!tradingOnline} />
        </div>
        <NoticeCard />
        <RecentOrdersTable key={refreshKey} limit={5} />
      </main>

      {activeSide && (
        <OrderModal
          side={activeSide}
          price={price}
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