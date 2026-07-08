import { useState } from "react";
import { usePriceFeed } from "../hooks/usePriceFeed";
import { submitOrder } from "../api";
import { useAuth } from "../context/AuthContext";
import PriceButton from "../components/PriceButton";
import OrderModal from "../components/OrderModal";

export default function TraderPage() {
  const { price, prevPrice, connected } = usePriceFeed();
  const { user, logout } = useAuth();
  const [activeSide, setActiveSide] = useState(null); // "buy" | "sell" | null
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);

  function openModal(side) {
    setResult(null);
    setActiveSide(side);
  }

  function closeModal() {
    setActiveSide(null);
    setResult(null);
  }

  async function handleSubmit(payload) {
    setSubmitting(true);
    try {
      const order = await submitOrder(payload);
      setResult(order);
    } catch (e) {
      console.error(e);
      alert("ارسال درخواست با خطا مواجه شد. دوباره تلاش کنید.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">آبشده حسین</h1>
        <div className="app__header-right">
          <span className={`app__status ${connected ? "is-live" : ""}`}>
            <span className="app__status-dot" />
            {connected ? "قیمت زنده" : "در حال اتصال…"}
          </span>
          <span className="app__user">
            {user?.phone_number}
            <button className="app__logout" onClick={logout}>خروج</button>
          </span>
        </div>
      </header>

      <main className="app__main">
        <div className="price-stage">
          <PriceButton side="buy" price={price} prevPrice={prevPrice} onClick={openModal} />
          <PriceButton side="sell" price={price} prevPrice={prevPrice} onClick={openModal} />
        </div>
      </main>

      {activeSide && (
        <OrderModal
          side={activeSide}
          onClose={closeModal}
          onSubmit={handleSubmit}
          submitting={submitting}
          result={result}
        />
      )}
    </div>
  );
}