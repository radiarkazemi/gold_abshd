import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { fetchKycStatus, submitKyc } from "../api";
import BottomTabBar from "../components/BottomTabBar";
import { useAuth } from "../context/AuthContext";
import { compressImageFile, formatFileSize } from "../utils/compressImage";

const STATUS_META = {
  none: { label: "هنوز ثبت نشده", className: "", hint: "برای فعال‌سازی خرید و فروش، مدارک زیر را ارسال کنید." },
  pending: { label: "در حال بررسی", className: "kyc-status--pending", hint: "مدارک شما دریافت شد و در صف بررسی مدیریت است." },
  approved: { label: "تایید شده", className: "kyc-status--approved", hint: "هویت شما تایید شده و امکان ثبت سفارش فعال است." },
  rejected: { label: "رد شده", className: "kyc-status--rejected", hint: "درخواست قبلی رد شده؛ می‌توانید دوباره مدارک را ارسال کنید." },
};

const SLOTS = [
  { key: "idFront", label: "عکس روی کارت ملی", hint: "چهره و شماره ملی واضح باشد", accept: "image/*,.jpg,.jpeg,.png,.webp" },
  { key: "idBack", label: "عکس پشت کارت ملی", hint: "متن پشت کارت خوانا باشد", accept: "image/*,.jpg,.jpeg,.png,.webp" },
  { key: "birthCert", label: "صفحه اول شناسنامه", hint: "صفحه مشخصات صاحب سند", accept: "image/*,.jpg,.jpeg,.png,.webp" },
];

const emptyFiles = () => ({ idFront: null, idBack: null, birthCert: null });
const emptyPreviews = () => ({ idFront: null, idBack: null, birthCert: null });

export default function KycPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [status, setStatus] = useState(null);
  const [files, setFiles] = useState(emptyFiles);
  const [previews, setPreviews] = useState(emptyPreviews);
  const [busy, setBusy] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [error, setError] = useState("");
  const previewUrlsRef = useRef([]);

  function revokePreviews() {
    previewUrlsRef.current.forEach((u) => {
      try {
        URL.revokeObjectURL(u);
      } catch {
        /* ignore */
      }
    });
    previewUrlsRef.current = [];
  }

  function reload() {
    fetchKycStatus().then(setStatus).catch(() => {});
  }

  useEffect(() => {
    reload();
    return () => revokePreviews();
  }, []);

  async function setSlotFile(key, rawFile) {
    setError("");
    if (!rawFile) {
      setFiles((prev) => ({ ...prev, [key]: null }));
      setPreviews((prev) => {
        if (prev[key]) {
          try {
            URL.revokeObjectURL(prev[key]);
          } catch {
            /* ignore */
          }
        }
        return { ...prev, [key]: null };
      });
      return;
    }

    setCompressing(true);
    try {
      const compressed = await compressImageFile(rawFile);
      const url = URL.createObjectURL(compressed);
      previewUrlsRef.current.push(url);
      setFiles((prev) => ({ ...prev, [key]: compressed }));
      setPreviews((prev) => {
        if (prev[key]) {
          try {
            URL.revokeObjectURL(prev[key]);
          } catch {
            /* ignore */
          }
        }
        return { ...prev, [key]: url };
      });
    } catch {
      setError("فشرده‌سازی تصویر با خطا مواجه شد؛ فایل دیگری انتخاب کنید");
    } finally {
      setCompressing(false);
    }
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
      revokePreviews();
      setFiles(emptyFiles());
      setPreviews(emptyPreviews());
    } catch (err) {
      setError(err.message || "ارسال با خطا مواجه شد");
    } finally {
      setBusy(false);
    }
  }

  const meta = status ? STATUS_META[status.kyc_status] : null;
  const canSubmit = status && (status.kyc_status === "none" || status.kyc_status === "rejected");
  const pickedCount = SLOTS.filter((s) => files[s.key]).length;
  const allPicked = pickedCount === SLOTS.length;

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
            <div className={`kyc-hero ${meta.className}`}>
              <div className={`kyc-status ${meta.className}`}>وضعیت: {meta.label}</div>
              <p className="kyc-hero__hint">{meta.hint}</p>
            </div>
          )}

          {status?.kyc_status === "rejected" && status.kyc_reject_reason && (
            <p className="kyc-page__reject-reason">دلیل رد: {status.kyc_reject_reason}</p>
          )}

          {canSubmit && (
            <>
              <div className="kyc-page__progress">
                <span>
                  {pickedCount.toLocaleString("fa-IR")} از {SLOTS.length.toLocaleString("fa-IR")} مدرک
                </span>
                <div className="kyc-page__progress-bar" aria-hidden>
                  <i style={{ width: `${(pickedCount / SLOTS.length) * 100}%` }} />
                </div>
              </div>

              <p className="upload-receipt__label">
                تصاویر به‌صورت خودکار کوچک و فشرده می‌شوند تا حجم سرور حفظ شود. لطفا عکس واضح و بدون تاری بگیرید.
              </p>

              <div className="kyc-page__slots">
                {SLOTS.map((slot) => {
                  const file = files[slot.key];
                  const preview = previews[slot.key];
                  return (
                    <label key={slot.key} className={`kyc-page__slot${file ? " is-filled" : ""}`}>
                      <span className="kyc-page__slot-label">{slot.label}</span>
                      <span className="kyc-page__slot-hint">{slot.hint}</span>
                      <input
                        type="file"
                        accept={slot.accept}
                        capture="environment"
                        onChange={(e) => setSlotFile(slot.key, e.target.files?.[0] || null)}
                      />
                      {preview ? (
                        <img className="kyc-page__slot-preview" src={preview} alt={slot.label} />
                      ) : (
                        <span className="kyc-page__slot-placeholder">لمس کنید تا تصویر انتخاب شود</span>
                      )}
                      {file && (
                        <span className="kyc-page__slot-file">
                          آماده · {formatFileSize(file.size)}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>

              {error && <p className="login__error">{error}</p>}
              <button
                type="button"
                className="login__btn"
                disabled={busy || compressing || !allPicked}
                onClick={handleSubmit}
              >
                {compressing ? "در حال آماده‌سازی تصاویر…" : busy ? "در حال ارسال…" : "ارسال درخواست احراز هویت"}
              </button>
            </>
          )}
        </div>
      </main>

      <BottomTabBar userPhone={user?.phone_number} onLogout={logout} />
    </div>
  );
}
