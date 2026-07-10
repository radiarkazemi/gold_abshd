import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import BottomTabBar from "../components/BottomTabBar";

export default function PlaceholderPage({ title }) {
  const { user, logout } = useAuth();

  return (
    <div className="app">
      <header className="app__header">
        <span />
        <h1 className="app__title">{title}</h1>
        <span />
      </header>

      <main className="placeholder-page app__main--with-tabbar">
        <div className="placeholder-page__icon">🛠</div>
        <h2 className="placeholder-page__title">{title}</h2>
        <p className="placeholder-page__text">این بخش به‌زودی راه‌اندازی می‌شود.</p>
        <Link to="/" className="placeholder-page__back">بازگشت به صفحه اصلی</Link>
      </main>

      <BottomTabBar userPhone={user?.phone_number} onLogout={logout} />
    </div>
  );
}