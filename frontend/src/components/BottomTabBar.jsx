import { useState } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { useTheme } from "../context/ThemeContext";

const MORE_ITEMS = [
  { label: "احراز هویت", to: "/kyc" },
  { label: "ارسال فیش واریز", to: "/upload-receipt" },
  { label: "ثبت حواله", to: "/register-transfer" },
  { label: "شرایط و قوانین", to: "/terms" },
  { label: "درباره ما", to: "/about" },
];

function HomeIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 11.5 12 4l8 7.5" />
      <path d="M6 10v9a1 1 0 0 0 1 1h4v-6h2v6h4a1 1 0 0 0 1-1v-9" />
    </svg>
  );
}

function OrdersIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2Z" />
      <path d="M9 8h6M9 12h6" />
    </svg>
  );
}

function BalanceIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18" />
      <circle cx="16" cy="14" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <circle cx="5" cy="12" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="19" cy="12" r="1.7" />
    </svg>
  );
}

export default function BottomTabBar({ userPhone, onLogout }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();

  const tabs = [
    { label: "خانه", to: "/", icon: HomeIcon },
    { label: "سفارش‌ها", to: "/my-orders", icon: OrdersIcon },
    { label: "حساب", to: "/balance", icon: BalanceIcon },
  ];

  return (
    <>
      <nav className="bottom-tab-bar">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = location.pathname === tab.to;
          return (
            <button
              key={tab.to}
              className={active ? "bottom-tab-bar__btn is-active" : "bottom-tab-bar__btn"}
              onClick={() => navigate(tab.to)}
            >
              <Icon />
              {tab.label}
            </button>
          );
        })}
        <button className="bottom-tab-bar__btn" onClick={() => setDrawerOpen(true)}>
          <MoreIcon />
          بیشتر
        </button>
      </nav>

      {drawerOpen && (
        <div className="side-menu__backdrop" onClick={() => setDrawerOpen(false)}>
          <div className="side-menu__drawer" onClick={(e) => e.stopPropagation()}>
            <div className="side-menu__header">
              <span className="side-menu__brand">آبشده قصر طلا</span>
              {userPhone && <span className="side-menu__phone">{userPhone}</span>}
            </div>

            <nav className="side-menu__nav">
              {MORE_ITEMS.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className="side-menu__item"
                  onClick={() => setDrawerOpen(false)}
                >
                  {item.label}
                </Link>
              ))}
              <button className="side-menu__item side-menu__theme-toggle" onClick={toggleTheme}>
                <span>{theme === "dark" ? "حالت روشن" : "حالت تیره"}</span>
                <span className="side-menu__theme-icon">{theme === "dark" ? "☀" : "☾"}</span>
              </button>
            </nav>

            <button
              className="side-menu__logout"
              onClick={() => {
                setDrawerOpen(false);
                onLogout();
              }}
            >
              خروج
            </button>
          </div>
        </div>
      )}
    </>
  );
}