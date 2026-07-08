import { useState } from "react";
import { requestOtp, verifyOtp } from "../api";
import { useAuth } from "../context/AuthContext";

function normalizePhone(value) {
  return value.replace(/[^\d]/g, "");
}

export default function LoginPage() {
  const { login } = useAuth();
  const [step, setStep] = useState("phone"); // "phone" | "otp"
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [debugCode, setDebugCode] = useState(null);

  async function handlePhoneSubmit(e) {
    e.preventDefault();
    setError("");
    if (phone.length < 10) {
      setError("شماره موبایل را کامل وارد کنید");
      return;
    }
    setLoading(true);
    try {
      const res = await requestOtp(phone);
      setDebugCode(res.debug_code || null);
      setStep("otp");
    } catch (err) {
      console.error(err);
      setError("ارسال کد با خطا مواجه شد. دوباره تلاش کنید.");
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
    setLoading(true);
    try {
      const res = await verifyOtp(phone, code);
      login(res.token, res.user);
    } catch (err) {
      setError(err.message === "Failed to verify OTP" ? "کد نامعتبر است" : err.message || "کد نامعتبر است");
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setError("");
    setLoading(true);
    try {
      const res = await requestOtp(phone);
      setDebugCode(res.debug_code || null);
    } catch (err) {
      setError("ارسال مجدد کد با خطا مواجه شد.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login">
      <div className="login__card">
        <h1 className="login__title">آبشده حسین</h1>
        <p className="login__subtitle">
          {step === "phone"
            ? "برای ورود، شماره موبایل خود را وارد کنید"
            : `کد ارسال شده به ${phone} را وارد کنید`}
        </p>

        {step === "phone" ? (
          <form onSubmit={handlePhoneSubmit}>
            <input
              type="tel"
              inputMode="numeric"
              autoFocus
              placeholder="۰۹۱۲۱۲۳۴۵۶۷"
              className="login__input"
              value={phone}
              onChange={(e) => setPhone(normalizePhone(e.target.value))}
            />
            {error && <p className="login__error">{error}</p>}
            <button type="submit" className="login__btn" disabled={loading}>
              {loading ? "در حال ارسال…" : "دریافت کد تایید"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleOtpSubmit}>
            <input
              type="text"
              inputMode="numeric"
              autoFocus
              placeholder="کد ۶ رقمی"
              className="login__input login__input--otp"
              value={code}
              onChange={(e) => setCode(normalizePhone(e.target.value))}
              maxLength={6}
            />
            {debugCode && (
              <p className="login__debug">کد تست (فقط در حالت توسعه): {debugCode}</p>
            )}
            {error && <p className="login__error">{error}</p>}
            <button type="submit" className="login__btn" disabled={loading}>
              {loading ? "در حال بررسی…" : "ورود"}
            </button>
            <div className="login__links">
              <button type="button" className="login__link" onClick={() => setStep("phone")}>
                تغییر شماره
              </button>
              <button type="button" className="login__link" onClick={handleResend} disabled={loading}>
                ارسال مجدد کد
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}