import { useState } from "react";
import { useTheme } from "../context/ThemeContext";

const NAV_ITEMS = [
  { key: "dashboard", label: "داشبورد", icon: "◆" },
  { key: "orders", label: "سفارش‌ها", icon: "▤", badgeKey: "pending" },
  { key: "phone-order", label: "حواله تلفنی", icon: "☎" },
  { key: "users", label: "کاربران", icon: "◈" },
  { key: "add-user", label: "کاربر جدید", icon: "+" },
  { key: "roles", label: "دسته‌بندی‌ها", icon: "≡" },
  { key: "prices", label: "قیمت‌ها", icon: "⛁" },
  { key: "kyc", label: "احراز هویت", icon: "🪪" },
  { key: "transfers", label: "ثبت حواله", icon: "↺" },
  { key: "calendar", label: "تقویم", icon: "▦" },
  { key: "notice", label: "اطلاعیه", icon: "!" },
];

// Only shown to the super-admin - manages sub-admin accounts and the
// activity log, so it isn't part of the regular permission-scope list.
const SUPER_ONLY_NAV_ITEM = { key: "admins", label: "مدیران", icon: "🛡" };

const TITLES = {
  dashboard: "داشبورد",
  orders: "سفارش‌ها",
  "phone-order": "حواله تلفنی",
  users: "کاربران",
  "add-user": "کاربر جدید",
  roles: "دسته‌بندی‌ها",
  prices: "قیمت‌ها",
  kyc: "احراز هویت",
  transfers: "ثبت حواله",
  calendar: "تقویم",
  notice: "اطلاعیه",
  admins: "مدیران",
};

const MOBILE_PRIMARY = ["dashboard", "orders", "users"];

export default function AdminShell({ activeTab, onTabChange, pendingCount, connected, onLogout, children, identity }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();

  const isSuper = identity?.is_super !== false; // default true for backwards compatibility
  const allowedKeys = identity?.permissions || [];

  const visibleItems = NAV_ITEMS.filter((item) => isSuper || allowedKeys.includes(item.key));
  const navItems = isSuper ? [...visibleItems, SUPER_ONLY_NAV_ITEM] : visibleItems;

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

  const mobileTabs = navItems.filter((i) => MOBILE_PRIMARY.includes(i.key));

  return (
    <div className="admin-shell">
      <aside className="admin-shell__sidebar">
        <div className="admin-shell__brand">
          <span className="admin-shell__brand-title">آبشده قصر طلا</span>
          <span className="admin-shell__brand-sub">پنل مدیریت</span>
        </div>

        <nav className="admin-nav">
          {navItems.map((item) => renderNavButton(item))}
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
              {navItems.map((item) => renderNavButton(item, "-drawer"))}
            </nav>
            <button className="admin-shell__logout" onClick={onLogout}>خروج از پنل</button>
          </div>
        </div>
      )}
    </div>
  );
}