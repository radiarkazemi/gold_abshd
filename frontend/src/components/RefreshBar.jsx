import { useEffect, useState } from "react";
import { fetchMyBalance } from "../api";
import { formatCashStatus, formatGoldStatus } from "../utils/balanceFormat";
import { formatTehranMonthDayTime } from "../utils/tehranTime";

export default function RefreshBar({ onRefresh, refreshSignal }) {
  const [balance, setBalance] = useState(null);
  const [spinning, setSpinning] = useState(false);

  function loadBalance() {
    return fetchMyBalance().then(setBalance).catch(() => {});
  }

  useEffect(() => {
    loadBalance();
    const interval = setInterval(loadBalance, 6000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (refreshSignal === undefined) return;
    loadBalance();
  }, [refreshSignal]);

  async function handleClick() {
    setSpinning(true);
    try {
      await Promise.all([onRefresh?.(), loadBalance()]);
    } finally {
      setTimeout(() => setSpinning(false), 400);
    }
  }

  const cashStatus = balance ? formatCashStatus(balance.cash_balance) : null;
  const goldStatus = balance ? formatGoldStatus(balance.gold_balance) : null;
  const updatedLabel = balance?.updated_at
    ? formatTehranMonthDayTime(balance.updated_at)
    : "—";

  return (
    <div className="refresh-bar">
      <div className="refresh-bar__body">
        <div className="refresh-bar__balances">
          <div className="refresh-bar__balance">
            <span className="refresh-bar__balance-label">مانده طلا</span>
            <span className={`refresh-bar__balance-value ${goldStatus ? goldStatus.className : ""}`}>
              {goldStatus ? goldStatus.amount : "—"}
              <span className="refresh-bar__balance-unit">
                {" "}
                گرم ۱۸{goldStatus?.label ? ` · ${goldStatus.label}` : ""}
              </span>
            </span>
          </div>
          <div className="refresh-bar__balance-divider" />
          <div className="refresh-bar__balance">
            <span className="refresh-bar__balance-label">مانده نقدی</span>
            <span className={`refresh-bar__balance-value ${cashStatus ? cashStatus.className : ""}`}>
              {cashStatus ? cashStatus.amount : "—"}
              <span className="refresh-bar__balance-unit">
                {" "}
                تومان{cashStatus?.label ? ` · ${cashStatus.label}` : ""}
              </span>
            </span>
          </div>
        </div>
        <span className="refresh-bar__time">
          آخرین بروزرسانی حساب‌ها:{" "}
          <span dir="ltr">{updatedLabel}</span>
        </span>
      </div>
      <button
        type="button"
        className={`refresh-bar__btn ${spinning ? "is-spinning" : ""}`}
        onClick={handleClick}
        aria-label="بروزرسانی"
      >
        ↻
      </button>
    </div>
  );
}
