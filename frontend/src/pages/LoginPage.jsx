import { useState } from "react";
import { requestOtp, verifyOtp } from "../api";
import { useAuth } from "../context/AuthContext";
import { logoUrl } from "../brandAssets";
import TermsAcceptModal from "../components/TermsAcceptModal";

function normalizePhone(value) {
  return value.replace(/[^\d]/g, "");
}

function normalizeKey(value) {
  return value.toUpperCase().replace(/[^A-Z0-9-]/g, "");
}

function isNetworkError(err) {
  const msg = String(err?.message || err || "");
  return (
    err?.name === "TypeError" ||
    /failed to fetch|networkerror|load failed|network request failed|fetch/i.test(msg)
  );
}

/** Clear SW/caches and hard-reload once — recovers phones stuck on an old broken build. */
async function recoverStaleClientOnce() {
  const key = "goldapp_stale_recover_v1";
  try {
    if (sessionStorage.getItem(key) === "1") return false;
    sessionStorage.setItem(key, "1");
  } catch {
    /* private mode */
  }
  try {
    if (typeof caches !== "undefined") {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    /* ignore */
  }
  try {
    if (navigator.serviceWorker?.getRegistrations) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister().catch(() => {})));
    }
  } catch {
    /* ignore */
  }
  const url = new URL(window.location.href);
  url.searchParams.set("_", String(Date.now()));
  window.location.replace(url.toString());
  return true;
}

export default function LoginPage() {
  const { login } = useAuth();
  const [step, setStep] = useState("phone"); // "phone" | "otp"
  const [phone, setPhone] = useState("");
  const [regKey, setRegKey] = useState("");
  const [needsKey, setNeedsKey] = useState(false);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [debugCode, setDebugCode] = useState(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [termsVersion, setTermsVersion] = useState(null);
  const [termsModalOpen, setTermsModalOpen] = useState(false);

  async function handlePhoneSubmit(e) {
    e.preventDefault();
    setError("");
    if (phone.length < 10) {
      setError("شماره موبایل را کامل وارد کنید");
      return;
    }
    setLoading(true);
    try {
      const res = await requestOtp(phone, regKey || undefined);
      setDebugCode(res.debug_code || null);
      setTermsAccepted(false);
      setTermsVersion(null);
      setStep("otp");
      try {
        sessionStorage.removeItem("goldapp_stale_recover_v1");
      } catch {
        /* ignore */
      }
    } catch (err) {
      if (isNetworkError(err)) {
        const recovering = await recoverStaleClientOnce();
        if (recovering) return;
        setError(
          "اتصال به سرور برقرار نشد. اپ را کامل ببندید، از صفحه خارج شوید و دوباره باز کنید. اگر روی خانه نصب کرده‌اید، یک‌بار از مرورگر http://ghasrtala.ir باز کنید."
        );
        setLoading(false);
        return;
      }
      const msg = err.message || "ارسال کد با خطا مواجه شد. دوباره تلاش کنید.";
      if (msg.includes("کد ثبت‌نام لازم است")) {
        setNeedsKey(true);
        setError("این اولین ورود شماست - لطفا کد ثبت‌نامی که از مدیریت دریافت کرده‌اید را وارد کنید");
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleOtpSubmit(e) {
    e.preventDefault();
    setError("");
    if (code.length < 4) {
      setError("کد تایید را کامل وارد کنید");
      return;
    }
    if (!termsAccepted) {
      setError("برای ورود باید قوانین و مقررات را بپذیرید");
      setTermsModalOpen(true);
      return;
    }
    setLoading(true);
    try {
      const res = await verifyOtp(phone, code, regKey || undefined, {
        termsAccepted: true,
        termsVersion,
      });
      login(res.token, res.user);
    } catch (err) {
      if (isNetworkError(err)) {
        const recovering = await recoverStaleClientOnce();
        if (recovering) return;
      }
      setError(err.message || "کد نامعتبر است");
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setError("");
    setLoading(true);
    try {
      const res = await requestOtp(phone, regKey || undefined);
      setDebugCode(res.debug_code || null);
    } catch (err) {
      setError(err.message || "ارسال مجدد کد با خطا مواجه شد.");
    } finally {
      setLoading(false);
    }
  }

  function handleTermsToggle() {
    if (termsAccepted) {
      // Unchecking means they withdraw acceptance for this login attempt.
      setTermsAccepted(false);
      setTermsVersion(null);
      return;
    }
    setTermsModalOpen(true);
  }

  function handleTermsAccept({ version }) {
    setTermsAccepted(true);
    setTermsVersion(version || null);
    setTermsModalOpen(false);
    setError("");
  }

  function handleTermsReject() {
    setTermsAccepted(false);
    setTermsVersion(null);
    setTermsModalOpen(false);
    setError("بدون پذیرش قوانین و مقررات امکان ورود وجود ندارد");
  }

  return (
    <div className="login">
      <div className="login__card">
        <img className="login__logo" src={logoUrl} alt="آبشده قصر طلا" width="96" height="96" />
        <h1 className="login__title">آبشده قصر طلا</h1>
        <p className="login__subtitle">
          {step === "phone" ? "برای ورود شماره موبایل خود را وارد کنید" : "کد تایید ارسال‌شده را وارد کنید"}
        </p>

        {step === "phone" ? (
          <form onSubmit={handlePhoneSubmit}>
            <input
              className="login__input"
              type="tel"
              inputMode="numeric"
              placeholder="۰۹۱۲۱۲۳۴۵۶۷"
              value={phone}
              onChange={(e) => setPhone(normalizePhone(e.target.value))}
              dir="ltr"
              autoFocus
            />
            {needsKey && (
              <input
                className="login__input login__input--key"
                type="text"
                placeholder="کد ثبت‌نام"
                value={regKey}
                onChange={(e) => setRegKey(normalizeKey(e.target.value))}
                dir="ltr"
              />
            )}
            {error && <p className="login__error">{error}</p>}
            <button type="submit" className="login__btn" disabled={loading}>
              {loading ? "در حال ارسال…" : "دریافت کد تایید"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleOtpSubmit}>
            <input
              className="login__input login__input--otp"
              type="tel"
              inputMode="numeric"
              placeholder="کد تایید"
              value={code}
              onChange={(e) => setCode(normalizePhone(e.target.value))}
              dir="ltr"
              autoFocus
            />
            {debugCode && (
              <p className="login__debug">کد تست (فقط در حالت توسعه): {debugCode}</p>
            )}

            <label className="login__terms">
              <input
                type="checkbox"
                checked={termsAccepted}
                onChange={handleTermsToggle}
              />
              <span>
                تمامی قوانین و مقررات برنامه را می‌پذیرم
                <button
                  type="button"
                  className="login__terms-link"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setTermsModalOpen(true);
                  }}
                >
                  {" "}
                  (مشاهده قوانین)
                </button>
              </span>
            </label>

            {error && <p className="login__error">{error}</p>}
            <button
              type="submit"
              className="login__btn"
              disabled={loading || !termsAccepted}
            >
              {loading ? "در حال بررسی…" : "ورود"}
            </button>
            <div className="login__links">
              <button
                type="button"
                className="login__link"
                onClick={() => {
                  setStep("phone");
                  setTermsAccepted(false);
                  setTermsVersion(null);
                }}
              >
                تغییر شماره
              </button>
              <button type="button" className="login__link" onClick={handleResend} disabled={loading}>
                ارسال مجدد کد
              </button>
            </div>
          </form>
        )}
      </div>

      <TermsAcceptModal
        open={termsModalOpen}
        onAccept={handleTermsAccept}
        onReject={handleTermsReject}
      />
    </div>
  );
}
