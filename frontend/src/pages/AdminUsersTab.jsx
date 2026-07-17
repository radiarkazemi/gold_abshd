import { useEffect, useState } from "react";
import {
  fetchAdminUsers,
  fetchAdminUserDetail,
  adjustUserBalance,
  setUserBlocked,
  updateUserAdmin,
  fetchRoles,
} from "../api";
import { formatCashStatus, formatGoldStatus } from "../utils/balanceFormat";
import FormattedNumberInput from "../components/FormattedNumberInput";

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

function formatDateOnly(iso) {
  return new Date(iso).toLocaleDateString("fa-IR");
}

const REASON_LABEL = {
  order_accepted: "سفارش تایید شده",
  admin_adjustment: "تنظیم دستی ادمین",
};

const KEY_STATUS_LABEL = {
  pending: "در انتظار فعال‌سازی",
  active: "فعال",
  banned: "مسدود",
};

function EditUserForm({ detail, roles, onSaved, onCancel }) {
  const [fullName, setFullName] = useState(detail.full_name || "");
  const [roleId, setRoleId] = useState(detail.role?.id || "");
  const [nationalId, setNationalId] = useState(detail.national_id || "");
  const [notes, setNotes] = useState(detail.notes || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await updateUserAdmin(detail.id, { fullName, roleId, nationalId, notes });
      onSaved();
    } catch (err) {
      setError(err.message || "خطا در ذخیره تغییرات");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="adjust-form" onSubmit={handleSave}>
      <h3 className="adjust-form__title">ویرایش اطلاعات کاربر</h3>
      <label className="field">
        <span className="field__label">نام و نام خانوادگی</span>
        <input className="field__input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
      </label>
      <label className="field">
        <span className="field__label">دسته‌بندی</span>
        <select className="field__input" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field__label">کد ملی</span>
        <input className="field__input" value={nationalId} onChange={(e) => setNationalId(e.target.value)} dir="ltr" />
      </label>
      <label className="field">
        <span className="field__label">یادداشت</span>
        <textarea className="field__textarea" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      {error && <p className="field__error">{error}</p>}
      <div className="modal-actions">
        <button type="button" className="modal-btn modal-btn--ghost" onClick={onCancel}>انصراف</button>
        <button type="submit" className="modal-btn modal-btn--buy" disabled={saving}>
          {saving ? "در حال ذخیره…" : "ذخیره تغییرات"}
        </button>
      </div>
    </form>
  );
}

function UserDetail({ userId, onClose, onChanged }) {
  const [detail, setDetail] = useState(null);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
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

  useEffect(() => {
    reload();
    fetchRoles().then(setRoles).catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

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
        ) : editing ? (
          <EditUserForm
            detail={detail}
            roles={roles}
            onSaved={() => { setEditing(false); reload(); onChanged?.(); }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <>
            <div className="user-detail__header">
              <div>
                <h2 className="user-detail__phone">
                  {detail.full_name || "بدون نام"}
                  <span className="user-detail__code"> #{detail.user_code}</span>
                </h2>
                <span className="user-detail__joined" dir="ltr">{detail.phone_number}</span>
                <br />
                <span className="user-detail__joined">
                  عضویت از {formatDate(detail.created_at)}
                  {detail.is_online && <span className="user-detail__online-dot" title="آنلاین" />}
                </span>
              </div>
              <div className="user-detail__actions">
                <button className="user-detail__edit-btn" onClick={() => setEditing(true)}>ویرایش</button>
                <button
                  className={detail.is_blocked ? "user-detail__block-btn is-blocked" : "user-detail__block-btn"}
                  onClick={handleToggleBlock}
                  disabled={busy}
                >
                  {detail.is_blocked ? "رفع مسدودیت" : "مسدود کردن"}
                </button>
              </div>
            </div>

            {detail.role && (
              <div className="user-detail__role-tag">
                {detail.role.name} —{" "}
                {detail.role.commission_type === "fixed"
                  ? `${fa(detail.role.commission_value)} تومان کمیسیون`
                  : `${detail.role.commission_value}٪ کمیسیون`}
              </div>
            )}

            <div className="balance-card">
              <div className="balance-card__item">
                <span className="balance-card__label">موجودی طلا</span>
                {(() => {
                  const goldStatus = formatGoldStatus(detail.gold_balance);
                  return (
                    <span className={`balance-card__value cash-status ${goldStatus.className}`}>
                      {goldStatus.amount}
                      <span className="balance-card__unit"> گرم ۱۸</span>
                      {goldStatus.label && <span className="cash-status__label">{goldStatus.label}</span>}
                    </span>
                  );
                })()}
              </div>
              <div className="balance-card__divider" />
              <div className="balance-card__item">
                <span className="balance-card__label">وضعیت نقدی</span>
                {(() => {
                  const status = formatCashStatus(detail.cash_balance);
                  return (
                    <span className={`balance-card__value cash-status ${status.className}`}>
                      {status.amount}
                      <span className="balance-card__unit"> تومان</span>
                      <span className="cash-status__label">{status.label}</span>
                    </span>
                  );
                })()}
              </div>
            </div>

            <div className="reg-key-box">
              <h3 className="adjust-form__title">کد ثبت‌نام</h3>
              {detail.registration_key ? (
                <>
                  <div className="reg-key-box__row">
                    <span className="reg-key-box__key">{detail.registration_key.key}</span>
                    <span className={`reg-key-box__status reg-key-box__status--${detail.registration_key.status}`}>
                      {KEY_STATUS_LABEL[detail.registration_key.status]}
                    </span>
                  </div>
                  <span className="reg-key-box__meta">
                    انقضا: {formatDateOnly(detail.registration_key.expires_at)}
                    {detail.registration_key.activated_at &&
                      ` — فعال‌شده: ${formatDateOnly(detail.registration_key.activated_at)}`}
                  </span>
                  {detail.device_info && (
                    <span className="reg-key-box__meta">دستگاه: {detail.device_info}</span>
                  )}
                </>
              ) : (
                <p className="myorders__empty">کدی صادر نشده</p>
              )}
            </div>

            <form className="adjust-form" onSubmit={handleAdjust}>
              <h3 className="adjust-form__title">تنظیم دستی موجودی</h3>
              <div className="adjust-form__row">
                <label className="field">
                  <span className="field__label">تغییر طلا (گرم ۱۸)</span>
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
                  <FormattedNumberInput
                    value={cashChange}
                    onChange={setCashChange}
                    className="field__input"
                    placeholder="مثبت یا منفی"
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
        placeholder="جستجو با نام، شماره یا کد کاربر…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {loading ? (
        <p className="myorders__empty">در حال بارگذاری…</p>
      ) : users.length === 0 ? (
        <p className="myorders__empty">کاربری پیدا نشد.</p>
      ) : (
        <div className="user-grid">
          {users.map((u) => (
            <button
              key={u.id}
              className="user-card"
              onClick={() => setSelectedId(u.id)}
            >
              <div className="user-card__top">
                <span className="user-card__name">
                  {u.is_online && <span className="user-card__online-dot" title="آنلاین" />}
                  {u.full_name || "بدون نام"}
                </span>
                <span className="user-card__code">#{u.user_code}</span>
              </div>
              {u.role && <span className="user-card__role">{u.role.name}</span>}
              <span className="user-card__phone" dir="ltr">{u.phone_number}</span>
              {u.is_blocked && <span className="user-row__blocked-tag">مسدود</span>}
              <div className="user-row__balances">
                <span className={`cash-status ${formatGoldStatus(u.gold_balance).className}`}>
                  {fa(u.gold_balance, { maximumFractionDigits: 3 })} گرم ۱۸
                </span>
                <span className={`cash-status ${formatCashStatus(u.cash_balance).className}`}>
                  {formatCashStatus(u.cash_balance).amount} تومان
                </span>
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