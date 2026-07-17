import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchMyTransfers, submitTransfer } from "../api";
import BottomTabBar from "../components/BottomTabBar";
import JalaliDateInput from "../components/JalaliDateInput";
import { useAuth } from "../context/AuthContext";

function fa(n) {
  return Number(n).toLocaleString("fa-IR");
}

const STATUS_LABEL = { pending: "در انتظار بررسی", accepted: "تایید شده", rejected: "رد شده" };

export default function RegisterTransferPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [transfers, setTransfers] = useState(null);
  const [amount, setAmount] = useState("");
  const [bankReference, setBankReference] = useState("");
  const [transferDate, setTransferDate] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);

  function reload() {
    fetchMyTransfers().then(setTransfers).catch(() => setTransfers([]));
  }

  useEffect(() => { reload(); }, []);

  async function handleSubmit() {
    const numeric = parseFloat(amount);
    if (!numeric || numeric <= 0) {
      setError("مبلغ معتبر وارد کنید");
      return;
    }
    setError("");
    setBusy(true);
    try {
      await submitTransfer({ amount: numeric, bank_reference: bankReference, transfer_date: transferDate, description, file });
      setAmount(""); setBankReference(""); setTransferDate(""); setDescription(""); setFile(null);
      setShowForm(false);
      reload();
    } catch (err) {
      setError(err.message || "ثبت حواله با خطا مواجه شد");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <header className="app__header">
        <button className="placeholder-page__back" onClick={() => navigate(-1)}>‹ بازگشت</button>
        <h1 className="app__title">ثبت حواله</h1>
        <span />
      </header>

      <main className="app__main app__main--with-tabbar">
        <div className="register-transfer">
          <button className="dashboard__see-all register-transfer__toggle" onClick={() => setShowForm((s) => !s)}>
            {showForm ? "بستن ‹" : "+ ثبت حواله جدید"}
          </button>

          {showForm && (
            <div className="register-transfer__form">
              <label className="order-limits-box__field">
                <span>مبلغ واریزی (تومان)</span>
                <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} dir="ltr" />
              </label>
              <label className="order-limits-box__field">
                <span>شماره پیگیری / کد رهگیری</span>
                <input value={bankReference} onChange={(e) => setBankReference(e.target.value)} dir="ltr" />
              </label>
              <JalaliDateInput label="تاریخ واریز" value={transferDate} onChange={setTransferDate} />
              <label className="order-limits-box__field">
                <span>توضیحات (اختیاری)</span>
                <input value={description} onChange={(e) => setDescription(e.target.value)} />
              </label>
              <label className="upload-receipt__file-label">
                <span>فیش واریزی (اختیاری)</span>
                <input type="file" accept=".jpg,.jpeg,.png,.webp,.pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} />
              </label>
              {file && <p className="upload-receipt__filename">{file.name}</p>}
              {error && <p className="login__error">{error}</p>}
              <button className="login__btn" disabled={busy} onClick={handleSubmit}>
                {busy ? "در حال ثبت…" : "ثبت حواله"}
              </button>
            </div>
          )}

          <h3 className="dashboard__section-title">حواله‌های ثبت‌شده</h3>
          {!transfers ? (
            <p className="myorders__empty">در حال بارگذاری…</p>
          ) : transfers.length === 0 ? (
            <p className="myorders__empty">هنوز حواله‌ای ثبت نکرده‌اید.</p>
          ) : (
            <div className="register-transfer__list">
              {transfers.map((t) => (
                <div key={t.id} className="register-transfer__card">
                  <div className="register-transfer__card-top">
                    <span className="register-transfer__amount">{fa(Math.round(t.amount))} تومان</span>
                    <span className={`register-transfer__status register-transfer__status--${t.status}`}>
                      {STATUS_LABEL[t.status]}
                    </span>
                  </div>
                  {t.bank_reference && <span className="register-transfer__meta">کد پیگیری: {t.bank_reference}</span>}
                  {t.transfer_date && <span className="register-transfer__meta">تاریخ: {t.transfer_date}</span>}
                  {t.admin_note && <span className="register-transfer__meta">یادداشت مدیر: {t.admin_note}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      <BottomTabBar userPhone={user?.phone_number} onLogout={logout} />
    </div>
  );
}