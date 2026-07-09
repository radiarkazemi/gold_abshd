import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTheme } from "../context/ThemeContext";

export default function SideMenu({ userPhone, onLogout }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();

  const items = [
    { label: "قیمت‌ها", to: "/" },
    { label: "سفارش‌های من", to: "/my-orders" },
  ];

  return (
    <>
      <button
        className="side-menu__trigger"
        onClick={() => setOpen(true)}
        aria-label="باز کردن منو"
      >
        <span />
        <span />
        <span />
      </button>

      {open && (
        <div className="side-menu__backdrop" onClick={() => setOpen(false)}>
          <div className="side-menu__drawer" onClick={(e) => e.stopPropagation()}>
            <div className="side-menu__header">
              <span className="side-menu__brand">آبشده قصر طلا</span>
              {userPhone && <span className="side-menu__phone">{userPhone}</span>}
            </div>

            <nav className="side-menu__nav">
              {items.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className={
                    location.pathname === item.to
                      ? "side-menu__item is-active"
                      : "side-menu__item"
                  }
                  onClick={() => setOpen(false)}
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
                setOpen(false);
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