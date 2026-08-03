import { useNavigate } from "react-router-dom";
import BottomTabBar from "../components/BottomTabBar";
import { useAuth } from "../context/AuthContext";

const LINKS = [
  {
    id: "national",
    label: "سامانه ریگیری کشوری",
    href: "https://reygiri.com/index.asp",
  },
  {
    id: "abhar",
    label: "سامانه ریگیری ابهر",
    href: "https://reygir.ir/",
  },
];

export default function ReygiriLinksPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  return (
    <div className="app">
      <header className="app__header">
        <button type="button" className="placeholder-page__back" onClick={() => navigate(-1)}>
          ‹ بازگشت
        </button>
        <h1 className="app__title">سامانه‌های ریگیری</h1>
        <span />
      </header>

      <main className="app__main app__main--with-tabbar">
        <div className="reygiri-page">
          <p className="reygiri-page__hint">یکی از سامانه‌ها را انتخاب کنید؛ در مرورگر باز می‌شود.</p>
          <div className="reygiri-page__actions">
            {LINKS.map((item) => (
              <a
                key={item.id}
                className="reygiri-page__btn"
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span className="reygiri-page__btn-label">{item.label}</span>
                <span className="reygiri-page__btn-url">{item.href.replace(/^https?:\/\//, "")}</span>
              </a>
            ))}
          </div>
        </div>
      </main>

      <BottomTabBar userPhone={user?.phone_number} onLogout={logout} />
    </div>
  );
}
