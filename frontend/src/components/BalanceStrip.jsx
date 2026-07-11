import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchMyBalance } from "../api";
import { formatCashStatus, formatGoldStatus } from "../utils/balanceFormat";

function fa(n, opts) {
  return Number(n).toLocaleString("en-US", opts);
}

export default function BalanceStrip() {
  const [balance, setBalance] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    function load() {
      fetchMyBalance().then(setBalance).catch(() => {});
    }
    load();
    const interval = setInterval(load, 6000);
    return () => clearInterval(interval);
  }, []);

  const cashStatus = balance ? formatCashStatus(balance.cash_balance) : null;
  const goldStatus = balance ? formatGoldStatus(balance.gold_balance) : null;

  return (
    <button className="balance-strip" onClick={() => navigate("/balance")}>
      <div className="balance-strip__item">
        <span className="balance-strip__label">موجودی طلا</span>
        <span className={`balance-strip__value ${goldStatus ? goldStatus.className : ""}`}>
          {goldStatus ? goldStatus.amount : "—"}
          <span className="balance-strip__unit">
            {" "}
            گرم ۱۸{goldStatus?.label ? ` · ${goldStatus.label}` : ""}
          </span>
        </span>
      </div>
      <div className="balance-strip__divider" />
      <div className="balance-strip__item">
        <span className="balance-strip__label">وضعیت نقدی</span>
        <span className={`balance-strip__value ${cashStatus ? cashStatus.className : ""}`}>
          {cashStatus ? cashStatus.amount : "—"}
          <span className="balance-strip__unit">
            {" "}
            تومان{cashStatus ? ` · ${cashStatus.label}` : ""}
          </span>
        </span>
      </div>
      <span className="balance-strip__chevron">‹</span>
    </button>
  );
}