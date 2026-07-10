import { useState, useEffect } from "react";
import { usePriceFeed } from "../hooks/usePriceFeed";
import { submitOrder, fetchSettlementLabel } from "../api";
import { useAuth } from "../context/AuthContext";
import PriceButton from "../components/PriceButton";
import OrderModal from "../components/OrderModal";
import SideMenu from "../components/SideMenu";
import NoticeCard from "../components/NoticeCard";
import RecentOrdersTable from "../components/RecentOrdersTable";

export default function TraderPage() {
  const { price, prevPrice, connected } = usePriceFeed();
  const { user, logout } = useAuth();
  const [activeSide, setActiveSide] = useState(null); // "buy" | "sell" | null
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [settlement, setSettlement] = useState(null);

  useEffect(() => {
    fetchSettlementLabel().then(setSettlement).catch(() => {});
  }, []);

  function openModal(side) {
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
        <SideMenu userPhone={user?.phone_number} onLogout={logout} />
        <h1 className="app__title">آبشده قصر طلا</h1>
        <span className={`app__status ${connected ? "is-live" : ""}`}>
          <span className="app__status-dot" />
          {connected ? "قیمت زنده" : "در حال اتصال…"}
        </span>
      </header>

      <main className="app__main">
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
        <div className="price-stage">
          <PriceButton side="buy" price={price} prevPrice={prevPrice} onClick={openModal} />
          <PriceButton side="sell" price={price} prevPrice={prevPrice} onClick={openModal} />
        </div>
        <NoticeCard />
        <RecentOrdersTable limit={5} />
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
    </div>
  );
}