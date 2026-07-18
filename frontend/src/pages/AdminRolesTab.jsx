import { useEffect, useState } from "react";
import { fetchRoles, createRole, updateRoleCommission } from "../api";

function emptyLimits(role) {
  return {
    minWeight: role?.min_weight ?? "",
    maxWeight: role?.max_weight ?? "",
    minAmount: role?.min_amount ?? "",
    maxAmount: role?.max_amount ?? "",
    priceLabelMode: role?.price_label_mode || "mesghal_and_gram18",
  };
}

function toExtra(limits) {
  return {
    minWeight: limits.minWeight === "" ? null : Number(limits.minWeight),
    maxWeight: limits.maxWeight === "" ? null : Number(limits.maxWeight),
    minAmount: limits.minAmount === "" ? null : Number(limits.minAmount),
    maxAmount: limits.maxAmount === "" ? null : Number(limits.maxAmount),
    priceLabelMode: limits.priceLabelMode,
  };
}

function RoleRow({ role, onUpdated }) {
  const [type, setType] = useState(role.commission_type);
  const [value, setValue] = useState(role.commission_value);
  const [limits, setLimits] = useState(emptyLimits(role));
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await updateRoleCommission(role.id, type, Number(value), toExtra(limits));
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

      <button type="button" className="role-row__toggle" onClick={() => setExpanded((s) => !s)}>
        {expanded ? "بستن تنظیمات پیشرفته ‹" : "تنظیمات پیشرفته (محدودیت‌ها و نمایش قیمت) ›"}
      </button>

      {expanded && (
        <div className="role-row__advanced">
          <div className="role-row__advanced-grid">
            <label className="order-limits-box__field">
              <span>حداقل وزن (گرم ۱۸) — خالی = پیش‌فرض عمومی</span>
              <input type="number" value={limits.minWeight} onChange={(e) => setLimits({ ...limits, minWeight: e.target.value })} />
            </label>
            <label className="order-limits-box__field">
              <span>حداکثر وزن (گرم ۱۸)</span>
              <input type="number" value={limits.maxWeight} onChange={(e) => setLimits({ ...limits, maxWeight: e.target.value })} />
            </label>
            <label className="order-limits-box__field">
              <span>حداقل مبلغ (تومان)</span>
              <input type="number" value={limits.minAmount} onChange={(e) => setLimits({ ...limits, minAmount: e.target.value })} />
            </label>
            <label className="order-limits-box__field">
              <span>حداکثر مبلغ (تومان)</span>
              <input type="number" value={limits.maxAmount} onChange={(e) => setLimits({ ...limits, maxAmount: e.target.value })} />
            </label>
          </div>
          <label className="order-limits-box__field">
            <span>نحوه نمایش قیمت به کاربران این دسته</span>
            <select
              className="field__input"
              value={limits.priceLabelMode}
              onChange={(e) => setLimits({ ...limits, priceLabelMode: e.target.value })}
            >
              <option value="mesghal_and_gram18">مثقال ۱۷ + گرم ۱۸</option>
              <option value="gram18_only">فقط گرم ۱۸</option>
            </select>
          </label>
          <button className="order-limits-box__save" onClick={handleSave} disabled={saving}>
            {saved ? "ذخیره شد ✓" : saving ? "در حال ذخیره…" : "ذخیره تنظیمات پیشرفته"}
          </button>
        </div>
      )}
    </div>
  );
}

export default function AdminRolesTab() {
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("fixed");
  const [newValue, setNewValue] = useState("");
  const [newLimits, setNewLimits] = useState(emptyLimits(null));
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
      await createRole(newName, newType, Number(newValue), toExtra(newLimits));
      setNewName("");
      setNewValue("");
      setNewLimits(emptyLimits(null));
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

        <div className="role-row__advanced-grid">
          <label className="order-limits-box__field">
            <span>حداقل وزن (گرم ۱۸) — خالی = پیش‌فرض عمومی</span>
            <input type="number" value={newLimits.minWeight} onChange={(e) => setNewLimits({ ...newLimits, minWeight: e.target.value })} />
          </label>
          <label className="order-limits-box__field">
            <span>حداکثر وزن (گرم ۱۸)</span>
            <input type="number" value={newLimits.maxWeight} onChange={(e) => setNewLimits({ ...newLimits, maxWeight: e.target.value })} />
          </label>
          <label className="order-limits-box__field">
            <span>حداقل مبلغ (تومان)</span>
            <input type="number" value={newLimits.minAmount} onChange={(e) => setNewLimits({ ...newLimits, minAmount: e.target.value })} />
          </label>
          <label className="order-limits-box__field">
            <span>حداکثر مبلغ (تومان)</span>
            <input type="number" value={newLimits.maxAmount} onChange={(e) => setNewLimits({ ...newLimits, maxAmount: e.target.value })} />
          </label>
        </div>
        <label className="order-limits-box__field" style={{ marginBottom: 14 }}>
          <span>نحوه نمایش قیمت به کاربران این دسته</span>
          <select
            className="field__input"
            value={newLimits.priceLabelMode}
            onChange={(e) => setNewLimits({ ...newLimits, priceLabelMode: e.target.value })}
          >
            <option value="mesghal_and_gram18">مثقال ۱۷ + گرم ۱۸</option>
            <option value="gram18_only">فقط گرم ۱۸</option>
          </select>
        </label>

        {error && <p className="field__error">{error}</p>}
        <button type="submit" className="modal-btn modal-btn--buy">
          ایجاد دسته‌بندی
        </button>
      </form>
    </div>
  );
}