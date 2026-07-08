import { useEffect, useState } from "react";
import {
  fetchAdminUsers,
  fetchAdminUserDetail,
  adjustUserBalance,
  setUserBlocked,
} from "../api";

function fa(n, opts) {
  return Number(n).toLocaleString("fa-IR", opts);
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
  admin_adjustment: "تنظیم دستی ادمین",
};

function UserDetail({ userId, onClose, onChanged }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [goldChange, setGoldChange] = useState("");
  const [cashChange, setCashChange] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function reload() {
    setLoading(true);
    fetchAdminUserDetail(userId)
      .then(setDetail)
      .catch(console.error)
      .finally(() => setLoading(false));
  }

  useEffect(reload, [userId]);

  async function handleAdjust(e) {
    e.preventDefault();
    setError("");
    const g = parseFloat(goldChange) || 0;
    const c = parseFloat(cashChange) || 0;
    if (!g && !c) {
      setError("حداقل یکی از مقادیر طلا یا نقدی را وارد کنید");
      return;
    }
    setBusy(true);
    try {
      await adjustUserBalance(userId, { goldChange: g, cashChange: c, note });
      setGoldChange("");
      setCashChange("");
      setNote("");
      reload();
      onChanged?.();
    } catch (err) {
      setError(err.message || "خطا در ثبت تغییر موجودی");
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleBlock() {
    setBusy(true);
    try {
      await setUserBlocked(userId, !detail.is_blocked);
      reload();
      onChanged?.();
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="user-detail" onClick={(e) => e.stopPropagation()}>
        <div className="modal-sheet__handle" />
        {loading || !detail ? (
          <p className="myorders__empty">در حال بارگذاری…</p>
        ) : (
          <>
            <div className="user-detail__header">
              <div>
                <h2 className="user-detail__phone">{detail.phone_number}</h2>
                <span className="user-detail__joined">
                  عضویت از {formatDate(detail.created_at)}
                </span>
              </div>
              <button
                className={detail.is_blocked ? "user-detail__block-btn is-blocked" : "user-detail__block-btn"}
                onClick={handleToggleBlock}
                disabled={busy}
              >
                {detail.is_blocked ? "رفع مسدودیت" : "مسدود کردن"}
              </button>
            </div>

            <div className="balance-card">
              <div className="balance-card__item">
                <span className="balance-card__label">موجودی طلا</span>
                <span className="balance-card__value">
                  {fa(detail.gold_balance, { maximumFractionDigits: 4 })}
                  <span className="balance-card__unit"> مثقال</span>
                </span>
              </div>
              <div className="balance-card__divider" />
              <div className="balance-card__item">
                <span className="balance-card__label">موجودی نقدی</span>
                <span className="balance-card__value">
                  {fa(Math.round(detail.cash_balance))}
                  <span className="balance-card__unit"> تومان</span>
                </span>
              </div>
            </div>

            <form className="adjust-form" onSubmit={handleAdjust}>
              <h3 className="adjust-form__title">تنظیم دستی موجودی</h3>
              <div className="adjust-form__row">
                <label className="field">
                  <span className="field__label">تغییر طلا (مثقال)</span>
                  <input
                    type="number"
                    step="any"
                    className="field__input"
                    placeholder="مثبت یا منفی، مثلاً 1.5 یا -1.5"
                    value={goldChange}
                    onChange={(e) => setGoldChange(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span className="field__label">تغییر نقدی (تومان)</span>
                  <input
                    type="number"
                    step="any"
                    className="field__input"
                    placeholder="مثبت یا منفی"
                    value={cashChange}
                    onChange={(e) => setCashChange(e.target.value)}
                  />
                </label>
              </div>
              <label className="field">
                <span className="field__label">یادداشت</span>
                <input
                  type="text"
                  className="field__input"
                  placeholder="مثلاً: واریز نقدی حضوری"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
              {error && <p className="field__error">{error}</p>}
              <button type="submit" className="modal-btn modal-btn--buy" disabled={busy}>
                {busy ? "در حال ثبت…" : "ثبت تغییر"}
              </button>
            </form>

            <h3 className="adjust-form__title">تاریخچه تراکنش‌ها</h3>
            {detail.transactions.length === 0 ? (
              <p className="myorders__empty">تراکنشی ثبت نشده</p>
            ) : (
              <div className="txn-list">
                {detail.transactions.map((t) => (
                  <div key={t.id} className="txn-row">
                    <div>
                      <span className="txn-row__reason">{REASON_LABEL[t.reason] || t.reason}</span>
                      {t.note && <span className="txn-row__note"> — {t.note}</span>}
                    </div>
                    <div className="txn-row__amounts">
                      {t.gold_change !== 0 && (
                        <span className={t.gold_change > 0 ? "txn-row__pos" : "txn-row__neg"}>
                          {t.gold_change > 0 ? "+" : ""}
                          {fa(t.gold_change, { maximumFractionDigits: 4 })} مثقال
                        </span>
                      )}
                      {t.cash_change !== 0 && (
                        <span className={t.cash_change > 0 ? "txn-row__pos" : "txn-row__neg"}>
                          {t.cash_change > 0 ? "+" : ""}
                          {fa(Math.round(t.cash_change))} تومان
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function AdminUsersTab() {
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);

  function reload() {
    setLoading(true);
    fetchAdminUsers(search || undefined)
      .then(setUsers)
      .catch(console.error)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    const t = setTimeout(reload, 300); // debounce search
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  return (
    <div>
      <input
        type="text"
        className="field__input admin__search"
        placeholder="جستجو با شماره موبایل…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {loading ? (
        <p className="myorders__empty">در حال بارگذاری…</p>
      ) : users.length === 0 ? (
        <p className="myorders__empty">کاربری پیدا نشد.</p>
      ) : (
        <div className="admin__list">
          {users.map((u) => (
            <button
              key={u.id}
              className="user-row"
              onClick={() => setSelectedId(u.id)}
            >
              <div className="user-row__main">
                <span className="user-row__phone">{u.phone_number}</span>
                {u.is_blocked && <span className="user-row__blocked-tag">مسدود</span>}
              </div>
              <div className="user-row__balances">
                <span>{fa(u.gold_balance, { maximumFractionDigits: 2 })} مثقال</span>
                <span>{fa(Math.round(u.cash_balance))} تومان</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {selectedId && (
        <UserDetail
          userId={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={reload}
        />
      )}
    </div>
  );
}