import { useState } from "react";
import { Link } from "react-router-dom";
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
  const [error, setError] = useState("");

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
        <h1 className="app__title">آبشده حسین</h1>
        <div className="app__header-right">
          <span className={`app__status ${connected ? "is-live" : ""}`}>
            <span className="app__status-dot" />
            {connected ? "قیمت زنده" : "در حال اتصال…"}
          </span>
          <Link to="/my-orders" className="app__nav-link">سفارش‌های من</Link>
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