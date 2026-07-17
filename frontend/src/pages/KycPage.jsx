import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchKycStatus, submitKyc } from "../api";
import BottomTabBar from "../components/BottomTabBar";
import { useAuth } from "../context/AuthContext";

const STATUS_META = {
  none: { label: "هنوز ثبت نشده", className: "" },
  pending: { label: "در حال بررسی", className: "kyc-status--pending" },
  approved: { label: "تایید شده", className: "kyc-status--approved" },
  rejected: { label: "رد شده", className: "kyc-status--rejected" },
};

export default function KycPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [status, setStatus] = useState(null);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function reload() {
    fetchKycStatus().then(setStatus).catch(() => {});
  }

  useEffect(() => { reload(); }, []);

  async function handleSubmit() {
    if (!file) {
      setError("یک فایل انتخاب کنید");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const res = await submitKyc(file);
      setStatus(res);
      setFile(null);
    } catch (err) {
      setError(err.message || "ارسال با خطا مواجه شد");
    } finally {
      setBusy(false);
    }
  }

  const meta = status ? STATUS_META[status.kyc_status] : null;
  const canSubmit = status && (status.kyc_status === "none" || status.kyc_status === "rejected");

  return (
    <div className="app">
      <header className="app__header">
        <button className="placeholder-page__back" onClick={() => navigate(-1)}>‹ بازگشت</button>
        <h1 className="app__title">احراز هویت</h1>
        <span />
      </header>

      <main className="app__main app__main--with-tabbar">
        <div className="kyc-page">
          {meta && (
            <div className={`kyc-status ${meta.className}`}>
              وضعیت: {meta.label}
            </div>
          )}

          {status?.kyc_status === "rejected" && status.kyc_reject_reason && (
            <p className="kyc-page__reject-reason">دلیل رد: {status.kyc_reject_reason}</p>
          )}

          {status?.kyc_status === "approved" && (
            <p className="kyc-page__done">هویت شما تایید شده و نیاز به اقدام دیگری نیست.</p>
          )}

          {status?.kyc_status === "pending" && (
            <p className="kyc-page__done">مدرک شما ارسال شده و در انتظار بررسی مدیریت است.</p>
          )}

          {canSubmit && (
            <>
              <p className="upload-receipt__label">
                لطفا تصویر واضح کارت ملی یا مدرک هویتی خود را ارسال کنید:
              </p>
              <label className="upload-receipt__file-label">
                <span>انتخاب فایل (عکس یا PDF)</span>
                <input
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp,.pdf"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
              </label>
              {file && <p className="upload-receipt__filename">{file.name}</p>}
              {error && <p className="login__error">{error}</p>}
              <button className="login__btn" disabled={busy || !file} onClick={handleSubmit}>
                {busy ? "در حال ارسال…" : "ارسال مدرک"}
              </button>
            </>
          )}
        </div>
      </main>

      <BottomTabBar userPhone={user?.phone_number} onLogout={logout} />
    </div>
  );
}