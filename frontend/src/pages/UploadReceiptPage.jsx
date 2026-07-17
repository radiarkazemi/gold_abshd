import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchMyOrders, uploadReceipt } from "../api";
import BottomTabBar from "../components/BottomTabBar";
import { useAuth } from "../context/AuthContext";

function fa(n) {
  return Number(n).toLocaleString("fa-IR");
}

const SIDE_LABEL = { buy: "خرید", sell: "فروش" };

export default function UploadReceiptPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [orders, setOrders] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    fetchMyOrders()
      .then((all) => setOrders(all.filter((o) => o.status === "pending" && !o.has_receipt)))
      .catch(() => setOrders([]));
  }, []);

  async function handleUpload() {
    if (!selectedId || !file) {
      setError("یک سفارش و یک فایل انتخاب کنید");
      return;
    }
    setError("");
    setBusy(true);
    try {
      await uploadReceipt(selectedId, file);
      setSuccess(true);
      setOrders((prev) => prev.filter((o) => o.id !== selectedId));
      setSelectedId(null);
      setFile(null);
    } catch (err) {
      setError(err.message || "بارگذاری فیش با خطا مواجه شد");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <header className="app__header">
        <button className="placeholder-page__back" onClick={() => navigate(-1)}>‹ بازگشت</button>
        <h1 className="app__title">ارسال فیش واریزی</h1>
        <span />
      </header>

      <main className="app__main app__main--with-tabbar">
        <div className="upload-receipt">
          {success && (
            <p className="upload-receipt__success">فیش با موفقیت ثبت شد ✓</p>
          )}

          {!orders ? (
            <p className="myorders__empty">در حال بارگذاری…</p>
          ) : orders.length === 0 ? (
            <p className="myorders__empty">
              سفارش در انتظاری که نیاز به فیش داشته باشد وجود ندارد.
            </p>
          ) : (
            <>
              <p className="upload-receipt__label">سفارش مورد نظر را انتخاب کنید:</p>
              <div className="upload-receipt__order-list">
                {orders.map((o) => (
                  <button
                    key={o.id}
                    className={selectedId === o.id ? "upload-receipt__order is-selected" : "upload-receipt__order"}
                    onClick={() => setSelectedId(o.id)}
                  >
                    <span className={`upload-receipt__order-side upload-receipt__order-side--${o.side}`}>
                      {SIDE_LABEL[o.side]}
                    </span>
                    <span>{fa(Math.round(o.value))} {o.amount_type === "weight" ? "گرم ۱۸" : "تومان"}</span>
                  </button>
                ))}
              </div>

              <label className="upload-receipt__file-label">
                <span>انتخاب فایل فیش (عکس یا PDF)</span>
                <input
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp,.pdf"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
              </label>
              {file && <p className="upload-receipt__filename">{file.name}</p>}

              {error && <p className="login__error">{error}</p>}

              <button className="login__btn" disabled={busy || !selectedId || !file} onClick={handleUpload}>
                {busy ? "در حال ارسال…" : "ارسال فیش"}
              </button>
            </>
          )}
        </div>
      </main>

      <BottomTabBar userPhone={user?.phone_number} onLogout={logout} />
    </div>
  );
}