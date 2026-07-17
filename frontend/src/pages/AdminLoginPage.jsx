import { useState } from "react";
import { adminLogin, adminVerify, setAdminToken } from "../api";

export default function AdminLoginPage({ onLoggedIn }) {
  const [step, setStep] = useState("password"); // "password" | "verify"
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // verification step state
  const [pending, setPending] = useState(null); // { admin_user_id, is_first_activation, display_name }
  const [code, setCode] = useState("");
  const [registrationKey, setRegistrationKey] = useState("");
  const [debugCode, setDebugCode] = useState(null);

  async function handlePasswordSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await adminLogin(username, password);
      if (res.requires_verification) {
        setPending({
          admin_user_id: res.admin_user_id,
          is_first_activation: res.is_first_activation,
          display_name: res.display_name,
        });
        setDebugCode(res.debug_code || null);
        setStep("verify");
      } else {
        setAdminToken(res.token);
        onLoggedIn();
      }
    } catch (err) {
      setError(err.message || "ورود ناموفق بود");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifySubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await adminVerify(pending.admin_user_id, code, pending.is_first_activation ? registrationKey : undefined);
      setAdminToken(res.token);
      onLoggedIn();
    } catch (err) {
      setError(err.message || "تایید کد با خطا مواجه شد");
    } finally {
      setLoading(false);
    }
  }

  if (step === "verify") {
    return (
      <div className="login">
        <div className="login__card">
          <h1 className="login__title">تایید ورود</h1>
          <p className="login__subtitle">
            {pending.display_name} — کد پیامک‌شده به شماره موبایل ثبت‌شده را وارد کنید
          </p>

          <form onSubmit={handleVerifySubmit}>
            <input
              type="text"
              autoFocus
              inputMode="numeric"
              placeholder="کد تایید پیامکی"
              className="login__input"
              dir="ltr"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            {debugCode && (
              <p className="login__debug">کد تست (فقط در حالت توسعه): {debugCode}</p>
            )}
            {pending.is_first_activation && (
              <input
                type="text"
                placeholder="کد ثبت‌نام (ارائه شده توسط مدیر اصلی)"
                className="login__input"
                dir="ltr"
                value={registrationKey}
                onChange={(e) => setRegistrationKey(e.target.value)}
              />
            )}
            {error && <p className="login__error">{error}</p>}
            <button type="submit" className="login__btn" disabled={loading}>
              {loading ? "در حال بررسی…" : "تایید و ورود"}
            </button>
            <button
              type="button"
              className="login__btn login__btn--ghost"
              onClick={() => { setStep("password"); setError(""); setCode(""); setRegistrationKey(""); setDebugCode(null); }}
            >
              بازگشت
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="login">
      <div className="login__card">
        <h1 className="login__title">ورود ادمین</h1>
        <p className="login__subtitle">آبشده قصر طلا — پنل مدیریت</p>

        <form onSubmit={handlePasswordSubmit}>
          <input
            type="text"
            autoFocus
            placeholder="نام کاربری"
            className="login__input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <input
            type="password"
            placeholder="رمز عبور"
            className="login__input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <p className="login__error">{error}</p>}
          <button type="submit" className="login__btn" disabled={loading}>
            {loading ? "در حال ورود…" : "ورود"}
          </button>
        </form>
      </div>
    </div>
  );
}