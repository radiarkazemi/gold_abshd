import { useEffect, useState } from "react";
import SideMenu from "../components/SideMenu";
import { useAuth } from "../context/AuthContext";
import { fetchMyBalance } from "../api";
import { formatCashStatus } from "../utils/balanceFormat";

function fa(n, opts) {
  return Number(n).toLocaleString("fa-IR", opts);
}

export default function BalancePage() {
  const { user, logout } = useAuth();
  const [balance, setBalance] = useState(null);

  useEffect(() => {
    fetchMyBalance().then(setBalance).catch(console.error);
  }, []);

  return (
    <div className="app">
      <header className="app__header">
        <SideMenu userPhone={user?.phone_number} onLogout={logout} />
        <h1 className="app__title">مانده حساب</h1>
        <span />
      </header>

      <main className="app__main">
        <div className="balance-card">
          <div className="balance-card__item">
            <span className="balance-card__label">موجودی طلا</span>
            <span className="balance-card__value">
              {balance ? fa(balance.gold_balance, { maximumFractionDigits: 4 }) : "—"}
              <span className="balance-card__unit"> گرم ۱۸</span>
            </span>
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
      </main>
    </div>
  );
}