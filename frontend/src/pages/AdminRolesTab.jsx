import { useEffect, useState } from "react";
import { fetchRoles, createRole, updateRoleCommission } from "../api";

function fa(n) {
  return Number(n).toLocaleString("fa-IR");
}

function RoleRow({ role, onUpdated }) {
  const [type, setType] = useState(role.commission_type);
  const [value, setValue] = useState(role.commission_value);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await updateRoleCommission(role.id, type, Number(value));
      setSaved(true);
      onUpdated();
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      alert(e.message || "خطا در ذخیره");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="role-row">
      <span className="role-row__name">{role.name}</span>
      <div className="role-row__controls">
        <select className="field__input role-row__type" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="fixed">مبلغ ثابت (تومان)</option>
          <option value="percentage">درصدی (٪)</option>
        </select>
        <input
          type="number"
          className="field__input role-row__value"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button className="role-row__save-btn" onClick={handleSave} disabled={saving}>
          {saved ? "✓" : saving ? "…" : "ذخیره"}
        </button>
      </div>
    </div>
  );
}

export default function AdminRolesTab() {
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("fixed");
  const [newValue, setNewValue] = useState("");
  const [error, setError] = useState("");

  function reload() {
    fetchRoles()
      .then(setRoles)
      .catch(console.error)
      .finally(() => setLoading(false));
  }

  useEffect(reload, []);

  async function handleCreate(e) {
    e.preventDefault();
    setError("");
    if (!newName || newValue === "") {
      setError("نام و مقدار کمیسیون الزامی هستند");
      return;
    }
    try {
      await createRole(newName, newType, Number(newValue));
      setNewName("");
      setNewValue("");
      reload();
    } catch (e) {
      setError(e.message || "خطا در ایجاد دسته‌بندی");
    }
  }

  return (
    <div>
      <h3 className="notice-editor__hint">دسته‌بندی‌های موجود</h3>
      {loading ? (
        <p className="myorders__empty">در حال بارگذاری…</p>
      ) : roles.length === 0 ? (
        <p className="myorders__empty">هنوز دسته‌بندی‌ای ساخته نشده.</p>
      ) : (
        <div className="role-list">
          {roles.map((r) => (
            <RoleRow key={r.id} role={r} onUpdated={reload} />
          ))}
        </div>
      )}

      <h3 className="notice-editor__hint" style={{ marginTop: 24 }}>
        افزودن دسته‌بندی جدید
      </h3>
      <form className="add-user-form" onSubmit={handleCreate}>
        <label className="field">
          <span className="field__label">نام دسته‌بندی</span>
          <input
            type="text"
            className="field__input"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="مثلا: همکار ویترین دار"
          />
        </label>
        <div className="role-row__controls" style={{ marginBottom: 14 }}>
          <select className="field__input role-row__type" value={newType} onChange={(e) => setNewType(e.target.value)}>
            <option value="fixed">مبلغ ثابت (تومان)</option>
            <option value="percentage">درصدی (٪)</option>
          </select>
          <input
            type="number"
            className="field__input role-row__value"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder={newType === "fixed" ? "مثلا 10000" : "مثلا 0.5"}
          />
        </div>
        {error && <p className="field__error">{error}</p>}
        <button type="submit" className="modal-btn modal-btn--buy">
          ایجاد دسته‌بندی
        </button>
      </form>
    </div>
  );
}