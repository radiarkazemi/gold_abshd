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

const SLOTS = [
  { key: "idFront", label: "عکس روی کارت ملی", accept: "image/*,.jpg,.jpeg,.png,.webp,.pdf" },
  { key: "idBack", label: "عکس پشت کارت ملی", accept: "image/*,.jpg,.jpeg,.png,.webp,.pdf" },
  { key: "birthCert", label: "عکس صفحه اول شناسنامه", accept: "image/*,.jpg,.jpeg,.png,.webp,.pdf" },
];

const emptyFiles = () => ({ idFront: null, idBack: null, birthCert: null });

export default function KycPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [status, setStatus] = useState(null);
  const [files, setFiles] = useState(emptyFiles);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function reload() {
    fetchKycStatus().then(setStatus).catch(() => {});
  }

  useEffect(() => {
    reload();
  }, []);

  function setSlotFile(key, file) {
    setFiles((prev) => ({ ...prev, [key]: file || null }));
  }

  async function handleSubmit() {
    if (!files.idFront || !files.idBack || !files.birthCert) {
      setError("لطفا هر سه تصویر را انتخاب کنید");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const res = await submitKyc({
        idFront: files.idFront,
        idBack: files.idBack,
        birthCert: files.birthCert,
      });
      setStatus(res);
      setFiles(emptyFiles());
    } catch (err) {
      setError(err.message || "ارسال با خطا مواجه شد");
    } finally {
      setBusy(false);
    }
  }

  const meta = status ? STATUS_META[status.kyc_status] : null;
  const canSubmit = status && (status.kyc_status === "none" || status.kyc_status === "rejected");
  const allPicked = !!(files.idFront && files.idBack && files.birthCert);

  return (
    <div className="app">
      <header className="app__header">
        <button type="button" className="placeholder-page__back" onClick={() => navigate(-1)}>
          ‹ بازگشت
        </button>
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
            <p className="kyc-page__done">
              هویت شما تایید شده است و امکان ثبت سفارش برای شما فعال است.
            </p>
          )}

          {status?.kyc_status === "pending" && (
            <p className="kyc-page__done">
              مدارک شما ارسال شده و در انتظار بررسی مدیریت است. تا زمان تایید، ثبت سفارش غیرفعال است.
            </p>
          )}

          {canSubmit && (
            <>
              <p className="upload-receipt__label">
                برای فعال‌سازی خرید و فروش، هر سه تصویر زیر را با کیفیت واضح بارگذاری کنید:
              </p>
              <div className="kyc-page__slots">
                {SLOTS.map((slot) => (
                  <label key={slot.key} className="kyc-page__slot">
                    <span className="kyc-page__slot-label">{slot.label}</span>
                    <input
                      type="file"
                      accept={slot.accept}
                      onChange={(e) => setSlotFile(slot.key, e.target.files?.[0] || null)}
                    />
                    {files[slot.key] ? (
                      <span className="kyc-page__slot-file">{files[slot.key].name}</span>
                    ) : (
                      <span className="kyc-page__slot-placeholder">انتخاب تصویر…</span>
                    )}
                  </label>
                ))}
              </div>
              {error && <p className="login__error">{error}</p>}
              <button
                type="button"
                className="login__btn"
                disabled={busy || !allPicked}
                onClick={handleSubmit}
              >
                {busy ? "در حال ارسال…" : "ارسال درخواست احراز هویت"}
              </button>
            </>
          )}
        </div>
      </main>

      <BottomTabBar userPhone={user?.phone_number} onLogout={logout} />
    </div>
  );
}
