import { useEffect, useState } from "react";
import { fetchRoles, createUserAdmin } from "../api";
import { copyText } from "../utils/clipboard";

export default function AdminAddUserTab() {
  const [roles, setRoles] = useState([]);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [fullName, setFullName] = useState("");
  const [roleId, setRoleId] = useState("");
  const [nationalId, setNationalId] = useState("");
  const [notes, setNotes] = useState("");
  const [referrer, setReferrer] = useState("");
  const [keyTtlDays, setKeyTtlDays] = useState(14);
  const [maxDevices, setMaxDevices] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");

  useEffect(() => {
    fetchRoles()
      .then((data) => {
        setRoles(data);
        if (data.length > 0) setRoleId(data[0].id);
      })
      .catch(console.error);
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!phoneNumber || !fullName || !roleId || !nationalId) {
      setError("شماره موبایل، نام، دسته‌بندی و کد ملی الزامی هستند");
      return;
    }
    setSubmitting(true);
    try {
      const res = await createUserAdmin({
        phoneNumber,
        fullName,
        roleId,
        nationalId,
        notes,
        referrer,
        keyTtlDays: Number(keyTtlDays),
        maxDevices: Number(maxDevices) || 1,
      });
      setResult(res);
    } catch (err) {
      setError(err.message || "خطا در ایجاد کاربر");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCopy() {
    setCopyError("");
    try {
      await copyText(result.registration_key);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError("کپی نشد — کد را دستی انتخاب و کپی کنید");
    }
  }

  function handleReset() {
    setResult(null);
    setPhoneNumber("");
    setFullName("");
    setNationalId("");
    setNotes("");
    setReferrer("");
    setMaxDevices(1);
    setCopied(false);
    setCopyError("");
  }

  if (result) {
    return (
      <div className="add-user-result">
        <h3 className="add-user-result__title">کاربر با موفقیت ایجاد شد ✓</h3>
        <p className="add-user-result__phone">{result.phone_number}</p>

        <div className="add-user-result__key-box">
          <span className="add-user-result__key-label">کد ثبت‌نام</span>
          <span className="add-user-result__key" dir="ltr">{result.registration_key}</span>
          <button type="button" className="add-user-result__copy-btn" onClick={handleCopy}>
            {copied ? "کپی شد ✓" : "کپی"}
          </button>
          {copyError && <p className="field__error">{copyError}</p>}
        </div>

        <p className="add-user-result__warning">
          ⚠️ این کد فقط همین یک بار نمایش داده می‌شود. آن را همراه با شماره موبایل
          به کاربر بدهید تا بتواند برای اولین بار وارد شود. این کد تا{" "}
          {new Date(result.expires_at).toLocaleDateString("fa-IR")} معتبر است.
        </p>

        <button className="modal-btn modal-btn--buy" onClick={handleReset}>
          افزودن کاربر دیگر
        </button>
      </div>
    );
  }

  return (
    <form className="add-user-form" onSubmit={handleSubmit}>
      <label className="field">
        <span className="field__label">شماره موبایل</span>
        <input
          type="tel"
          className="field__input"
          value={phoneNumber}
          onChange={(e) => setPhoneNumber(e.target.value.replace(/[^\d]/g, ""))}
          placeholder="09121234567"
          dir="ltr"
        />
      </label>

      <label className="field">
        <span className="field__label">نام و نام خانوادگی</span>
        <input
          type="text"
          className="field__input"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
      </label>

      <label className="field">
        <span className="field__label">دسته‌بندی (نقش)</span>
        <select
          className="field__input"
          value={roleId}
          onChange={(e) => setRoleId(e.target.value)}
        >
          {roles.length === 0 && <option value="">ابتدا یک دسته‌بندی بسازید</option>}
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} (
              {r.commission_type === "fixed"
                ? `${r.commission_value.toLocaleString("fa-IR")} تومان`
                : `${r.commission_value}٪`}
              )
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span className="field__label">کد ملی</span>
        <input
          type="text"
          className="field__input"
          value={nationalId}
          onChange={(e) => setNationalId(e.target.value)}
          dir="ltr"
          required
        />
      </label>

      <label className="field">
        <span className="field__label">معرف</span>
        <input
          type="text"
          className="field__input"
          value={referrer}
          onChange={(e) => setReferrer(e.target.value)}
          placeholder="مثلاً: معرفی توسط آقای احمدی"
        />
      </label>

      <label className="field">
        <span className="field__label">یادداشت (اختیاری)</span>
        <textarea
          className="field__textarea"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
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

      <label className="field">
        <span className="field__label">اعتبار کد ثبت‌نام (روز)</span>
        <input
          type="number"
          className="field__input"
          value={keyTtlDays}
          onChange={(e) => setKeyTtlDays(e.target.value)}
          min={1}
        />
      </label>

      {error && <p className="field__error">{error}</p>}

      <button type="submit" className="modal-btn modal-btn--buy" disabled={submitting || roles.length === 0}>
        {submitting ? "در حال ایجاد…" : "ایجاد کاربر و دریافت کد ثبت‌نام"}
      </button>
    </form>
  );
}