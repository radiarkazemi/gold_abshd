import { useState } from "react";
import { adminLogin, setAdminToken } from "../api";

export default function AdminLoginPage({ onLoggedIn }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await adminLogin(username, password);
      setAdminToken(res.token);
      onLoggedIn();
    } catch (err) {
      setError(err.message || "ورود ناموفق بود");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login">
      <div className="login__card">
        <h1 className="login__title">ورود ادمین</h1>
        <p className="login__subtitle">آبشده قصر طلا — پنل مدیریت</p>

        <form onSubmit={handleSubmit}>
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