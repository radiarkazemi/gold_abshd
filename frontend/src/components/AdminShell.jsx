import { useState } from "react";
import { useTheme } from "../context/ThemeContext";

const NAV_ITEMS = [
  { key: "dashboard", label: "داشبورد", icon: "◆" },
  { key: "orders", label: "سفارش‌ها", icon: "▤", badgeKey: "pending" },
  { key: "phone-order", label: "حواله تلفنی", icon: "☎" },
  { key: "users", label: "کاربران", icon: "◈" },
  { key: "add-user", label: "کاربر جدید", icon: "+" },
  { key: "roles", label: "دسته‌بندی‌ها", icon: "≡" },
  { key: "calendar", label: "تقویم", icon: "▦" },
  { key: "notice", label: "اطلاعیه", icon: "!" },
];

const TITLES = {
  dashboard: "داشبورد",
  orders: "سفارش‌ها",
  "phone-order": "حواله تلفنی",
  users: "کاربران",
  "add-user": "کاربر جدید",
  roles: "دسته‌بندی‌ها",
  calendar: "تقویم",
  notice: "اطلاعیه",
};

const MOBILE_PRIMARY = ["dashboard", "orders", "users"];

export default function AdminShell({ activeTab, onTabChange, pendingCount, connected, onLogout, children }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();

  function selectTab(key) {
    onTabChange(key);
    setDrawerOpen(false);
  }

  function renderNavButton(item, keySuffix = "") {
    return (
      <button
        key={item.key + keySuffix}
        className={activeTab === item.key ? "admin-nav__item is-active" : "admin-nav__item"}
        onClick={() => selectTab(item.key)}
      >
        <span className="admin-nav__icon">{item.icon}</span>
        <span className="admin-nav__label">{item.label}</span>
        {item.badgeKey === "pending" && pendingCount > 0 && (
          <span className="admin-nav__badge">{pendingCount}</span>
        )}
      </button>
    );
  }

  const mobileTabs = NAV_ITEMS.filter((i) => MOBILE_PRIMARY.includes(i.key));

  return (
    <div className="admin-shell">
      <aside className="admin-shell__sidebar">
        <div className="admin-shell__brand">
          <span className="admin-shell__brand-title">آبشده قصر طلا</span>
          <span className="admin-shell__brand-sub">پنل مدیریت</span>
        </div>

        <nav className="admin-nav">
          {NAV_ITEMS.map((item) => renderNavButton(item))}
        </nav>

        <div className="admin-shell__footer">
          <div className="admin-shell__live">
            <span className={`admin-shell__live-dot ${connected ? "is-live" : ""}`} />
            {connected ? "اتصال زنده فعال" : "در حال اتصال…"}
          </div>
          <button className="admin-shell__theme-toggle" onClick={toggleTheme}>
            {theme === "dark" ? "☀ حالت روشن" : "☾ حالت تیره"}
          </button>
          <button className="admin-shell__logout" onClick={onLogout}>خروج از پنل</button>
        </div>
      </aside>

      <div className="admin-shell__main">
        <header className="admin-shell__header">
          <h1 className="admin-shell__title">{TITLES[activeTab]}</h1>
          <div className="admin-shell__header-actions">
            <button className="theme-toggle-btn admin-shell__theme-toggle-mobile" onClick={toggleTheme} aria-label="تغییر پوسته">
              {theme === "dark" ? "☀" : "☾"}
            </button>
            <span className="admin-shell__avatar">ا.ا</span>
          </div>
        </header>

        <div className="admin-shell__content">{children}</div>

        <nav className="admin-shell__mobile-nav">
          {mobileTabs.map((item) => renderNavButton(item, "-mobile"))}
          <button className="admin-nav__item" onClick={() => setDrawerOpen(true)}>
            <span className="admin-nav__icon">☰</span>
            <span className="admin-nav__label">بیشتر</span>
          </button>
        </nav>
      </div>

      {drawerOpen && (
        <div className="side-menu__backdrop" onClick={() => setDrawerOpen(false)}>
          <div className="admin-shell__drawer" onClick={(e) => e.stopPropagation()}>
            <div className="admin-shell__brand" style={{ marginBottom: 22, paddingBottom: 16, borderBottom: "1px solid var(--hairline)" }}>
              <span className="admin-shell__brand-title">آبشده قصر طلا</span>
              <span className="admin-shell__brand-sub">پنل مدیریت</span>
            </div>
            <nav className="admin-nav" style={{ flex: 1, overflowY: "auto" }}>
              {NAV_ITEMS.map((item) => renderNavButton(item, "-drawer"))}
            </nav>
            <button className="admin-shell__logout" onClick={onLogout}>خروج از پنل</button>
          </div>
        </div>
      )}
    </div>
  );
}