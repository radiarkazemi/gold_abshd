import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { fetchMyBalance, fetchMyTransactions } from "../api";
import { formatCashStatus, formatGoldStatus } from "../utils/balanceFormat";
import BottomTabBar from "../components/BottomTabBar";

function fa(n, opts) {
  return Number(n).toLocaleString("en-US", opts);
}

function formatDate(iso) {
  return new Date(iso).toLocaleString("fa-IR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const REASON_LABEL = {
  order_accepted: "سفارش تایید شده",
  admin_adjustment: "تنظیم دستی مدیریت",
};

export default function BalancePage() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [balance, setBalance] = useState(null);
  const [transactions, setTransactions] = useState(null);

  function reload() {
    fetchMyBalance().then(setBalance).catch(console.error);
    fetchMyTransactions().then(setTransactions).catch(console.error);
  }

  useEffect(() => {
    reload();
    // Poll every 6s so this screen reflects new admin decisions/adjustments
    // without the user needing to manually refresh.
    const interval = setInterval(reload, 6000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="app">
      <header className="app__header">
        <span />
        <h1 className="app__title">مانده حساب</h1>
        <button className="theme-toggle-btn" onClick={toggleTheme} aria-label="تغییر پوسته">
          {theme === "dark" ? "☀" : "☾"}
        </button>
      </header>

      <main className="app__main app__main--with-tabbar">
        <div className="balance-card">
          <div className="balance-card__item">
            <span className="balance-card__label">موجودی طلا</span>
            {balance ? (
              (() => {
                const gStatus = formatGoldStatus(balance.gold_balance);
                return (
                  <span className={`balance-card__value cash-status ${gStatus.className}`}>
                    {gStatus.amount}
                    <span className="balance-card__unit"> گرم ۱۸</span>
                    {gStatus.label && <span className="cash-status__label">{gStatus.label}</span>}
                  </span>
                );
              })()
            ) : (
              <span className="balance-card__value">—</span>
            )}
          </div>
          <div className="balance-card__divider" />
          <div className="balance-card__item">
            <span className="balance-card__label">وضعیت نقدی</span>
            {balance ? (
              (() => {
                const status = formatCashStatus(balance.cash_balance);
                return (
                  <span className={`balance-card__value cash-status ${status.className}`}>
                    {status.amount}
                    <span className="balance-card__unit"> تومان</span>
                    <span className="cash-status__label">{status.label}</span>
                  </span>
                );
              })()
            ) : (
              <span className="balance-card__value">—</span>
            )}
          </div>
        </div>

        <h3 className="recent-orders__title" style={{ marginTop: 20 }}>تراکنش‌های اخیر</h3>

        {transactions === null ? (
          <p className="myorders__empty">در حال بارگذاری…</p>
        ) : transactions.length === 0 ? (
          <p className="myorders__empty">تراکنشی ثبت نشده است.</p>
        ) : (
          <div className="txn-list" style={{ width: "100%", maxWidth: 720 }}>
            {transactions.map((t) => (
              <div key={t.id} className="txn-row">
                <div>
                  <span className="txn-row__reason">{REASON_LABEL[t.reason] || t.reason}</span>
                  {t.note && <span className="txn-row__note"> — {t.note}</span>}
                  <br />
                  <span className="reg-key-box__meta">{formatDate(t.created_at)}</span>
                </div>
                <div className="txn-row__amounts">
                  {t.gold_change !== 0 && (
                    <span className={t.gold_change > 0 ? "txn-row__pos" : "txn-row__neg"}>
                      {t.gold_change > 0 ? "+" : ""}
                      {fa(t.gold_change, { maximumFractionDigits: 3 })} گرم ۱۸
                    </span>
                  )}
                  {t.cash_change !== 0 && (
                    <span className={t.cash_change < 0 ? "txn-row__pos" : "txn-row__neg"}>
                      {t.cash_change > 0 ? "+" : ""}
                      {fa(Math.round(t.cash_change))} تومان
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      <BottomTabBar userPhone={user?.phone_number} onLogout={logout} />
    </div>
  );
}