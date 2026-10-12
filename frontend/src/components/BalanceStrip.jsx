import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchMyBalance } from "../api";
import { formatCashStatus, formatGoldStatus } from "../utils/balanceFormat";

export default function BalanceStrip({ refreshSignal }) {
  const [balance, setBalance] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    function load(refresh = false) {
      fetchMyBalance({ refresh }).then(setBalance).catch(() => {});
    }
    load(true);
    const interval = setInterval(() => load(false), 6000);
    function onVis() {
      if (document.visibilityState === "visible") load(true);
    }
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  useEffect(() => {
    if (refreshSignal === undefined) return;
    fetchMyBalance({ refresh: true }).then(setBalance).catch(() => {});
  }, [refreshSignal]);

  const cashStatus = balance ? formatCashStatus(balance.cash_balance) : null;
  const goldStatus = balance ? formatGoldStatus(balance.gold_balance) : null;

  return (
    <button className="balance-strip" onClick={() => navigate("/balance")}>
      <div className="balance-strip__item">
        <span className="balance-strip__label">موجودی طلا</span>
        <span className="balance-strip__value">
          {goldStatus ? goldStatus.amount : "—"}
          <span className="balance-strip__unit"> گرم ۱۸</span>
        </span>
        {goldStatus?.label && (
          <span className={`balance-strip__status ${goldStatus.className}`}>{goldStatus.label}</span>
        )}
      </div>
      <div className="balance-strip__divider" />
      <div className="balance-strip__item">
        <span className="balance-strip__label">وضعیت نقدی</span>
        <span className="balance-strip__value">
          {cashStatus ? cashStatus.amount : "—"}
          <span className="balance-strip__unit"> تومان</span>
        </span>
        {cashStatus?.label && (
          <span className={`balance-strip__status ${cashStatus.className}`}>{cashStatus.label}</span>
        )}
      </div>
      <span className="balance-strip__chevron">‹</span>
    </button>
  );
}
