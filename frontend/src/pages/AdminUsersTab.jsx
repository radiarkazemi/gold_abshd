import { useEffect, useState } from "react";
import { formatTehranDateTime } from "../utils/tehranTime";
import {
  fetchAdminUsers,
  fetchAdminUserDetail,
  adjustUserBalance,
  setUserBlocked,
  setUserTradingBanned,
  updateUserAdmin,
  deleteUserAdmin,
  revokeUserDeviceAdmin,
  fetchRoles,
} from "../api";
import { formatCashStatus, formatGoldStatus } from "../utils/balanceFormat";
import FormattedNumberInput from "../components/FormattedNumberInput";
import TermsSignaturesReportModal from "../components/TermsSignaturesReportModal";
import "../components/TermsSignaturesReportModal.css";

function fa(n, opts) {
  return Number(n).toLocaleString("fa-IR", opts);
}

function formatDate(iso) {
  return formatTehranDateTime(iso);
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
  const [referrer, setReferrer] = useState(detail.referrer || "");
  const [maxDevices, setMaxDevices] = useState(detail.max_devices || 1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await updateUserAdmin(detail.id, {
        fullName,
        roleId,
        nationalId,
        notes,
        referrer,
        maxDevices: Number(maxDevices) || 1,
      });
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
      <label className="field">
        <span className="field__label">معرف</span>
        <input className="field__input" value={referrer} onChange={(e) => setReferrer(e.target.value)} />
      </label>
      <label className="field">
        <span className="field__label">تعداد دستگاه مجاز</span>
        <input
          type="number"
          className="field__input"
          value={maxDevices}
          onChange={(e) => setMaxDevices(e.target.value)}
          min={1}
          max={20}
        />
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
  const [signaturesOpen, setSignaturesOpen] = useState(false);

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

  async function handleToggleTradingBan() {
    setBusy(true);
    try {
      await setUserTradingBanned(userId, !detail.is_trading_banned);
      reload();
      onChanged?.();
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleRevokeDevice(deviceRowId) {
    if (!window.confirm("این دستگاه از لیست مجاز حذف شود؟")) return;
    setBusy(true);
    setError("");
    try {
      await revokeUserDeviceAdmin(userId, deviceRowId);
      reload();
      onChanged?.();
    } catch (err) {
      setError(err.message || "خطا در حذف دستگاه");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteUser() {
    const ok = window.confirm(
      `کاربر «${detail.full_name || detail.phone_number}» و تمام سفارش‌ها/تراکنش‌هایش حذف شوند؟ این عمل برگشت‌ناپذیر است.`
    );
    if (!ok) return;
    setBusy(true);
    setError("");
    try {
      await deleteUserAdmin(userId);
      onChanged?.();
      onClose();
    } catch (err) {
      setError(err.message || "خطا در حذف کاربر");
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
                {detail.referrer && <div className="user-detail__joined">معرف: {detail.referrer}</div>}
              </div>
              <div className="user-detail__actions">
                <button className="user-detail__edit-btn" onClick={() => setEditing(true)}>ویرایش</button>
                <button
                  className={detail.is_trading_banned ? "user-detail__block-btn is-blocked" : "user-detail__block-btn"}
                  onClick={handleToggleTradingBan}
                  disabled={busy}
                >
                  {detail.is_trading_banned ? "رفع ممنوعیت معامله" : "ممنوعیت معامله"}
                </button>
                <button
                  className={detail.is_blocked ? "user-detail__block-btn is-blocked" : "user-detail__block-btn"}
                  onClick={handleToggleBlock}
                  disabled={busy}
                >
                  {detail.is_blocked ? "رفع مسدودیت" : "مسدود کردن"}
                </button>
                <button
                  className="user-detail__delete-btn"
                  onClick={handleDeleteUser}
                  disabled={busy}
                >
                  حذف کاربر
                </button>
              </div>
            </div>

            {detail.role && (
              <div className="user-detail__role-tag">{detail.role.name}</div>
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
                </>
              ) : (
                <p className="myorders__empty">کدی صادر نشده</p>
              )}
            </div>

            <div className="reg-key-box">
              <h3 className="adjust-form__title">
                دستگاه‌ها ({(detail.devices || []).length} از {detail.max_devices || 1})
              </h3>
              {(detail.devices || []).length === 0 ? (
                <p className="myorders__empty">هنوز دستگاهی فعال نشده</p>
              ) : (
                <div className="device-list">
                  {(detail.devices || []).map((d) => (
                    <div key={d.id} className="device-row">
                      <div className="device-row__info">
                        <span className="device-row__ua">{d.device_info || "دستگاه ناشناس"}</span>
                        <span className="reg-key-box__meta">
                          ثبت: {formatDate(d.created_at)}
                          {d.last_seen_at ? ` — آخرین ورود: ${formatDate(d.last_seen_at)}` : ""}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="user-detail__delete-btn"
                        onClick={() => handleRevokeDevice(d.id)}
                        disabled={busy}
                      >
                        حذف دستگاه
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="reg-key-box">
              <button
                type="button"
                className="sig-report-open-btn"
                onClick={() => setSignaturesOpen(true)}
              >
                <span>امضای دیجیتال ورود کاربر</span>
                <span className="sig-report-open-btn__count">
                  {fa(detail.terms_acceptance_count || 0)} رکورد
                </span>
              </button>
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
      {signaturesOpen && detail && (
        <TermsSignaturesReportModal
          userId={userId}
          userLabel={`${detail.full_name || "بدون نام"} — ${detail.phone_number}`}
          onClose={() => setSignaturesOpen(false)}
        />
      )}
    </div>
  );
}

export default function AdminUsersTab() {
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState(null);

  function reload() {
    setLoading(true);
    setError("");
    fetchAdminUsers(search || undefined)
      .then(setUsers)
      .catch((e) => {
        console.error(e);
        setUsers([]);
        setError(e.message || "بارگذاری کاربران با خطا مواجه شد");
      })
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
      ) : error ? (
        <p className="myorders__empty">{error}</p>
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
              {u.is_trading_banned && <span className="user-row__blocked-tag">ممنوع‌المعامله</span>}
              {u.referrer && <span className="user-card__role">معرف: {u.referrer}</span>}
              <span className="user-card__role">
                دستگاه: {fa(u.device_count || 0)}/{fa(u.max_devices || 1)}
              </span>
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