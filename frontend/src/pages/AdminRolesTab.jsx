import { useEffect, useState } from "react";
import { fetchRoles, createRole, updateRoleCommission, fetchPrice, openPriceSocket } from "../api";
import { personalizePrice } from "../utils/priceCommission";

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

function pickPrimaryGoldCard(payload) {
  const cards = payload?.cards || [];
  return cards.find((c) => c.type === 1 && c.is_primary) || cards.find((c) => c.type === 1) || null;
}

/** Amount helpers use raw card price (fees are set per-card on قیمت‌ها). */
function autoAmountFromWeight(weight, rawGoldCard) {
  if (weight === "" || weight == null || !rawGoldCard) return "";
  const numericWeight = Number(weight);
  if (!numericWeight) return "";
  const personalized = personalizePrice(rawGoldCard, "fixed", 0);
  const gram18 = personalized?.gram18_buy_price;
  if (!gram18) return "";
  const displayedUnit = Math.round(gram18);
  return String(Math.round(numericWeight * displayedUnit));
}

function RoleRow({ role, onUpdated, rawGoldCard }) {
  const [limits, setLimits] = useState(emptyLimits(role));
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setLimits((prev) => {
      const nextMinAmount = autoAmountFromWeight(prev.minWeight, rawGoldCard);
      const nextMaxAmount = autoAmountFromWeight(prev.maxWeight, rawGoldCard);
      if (prev.minAmount === nextMinAmount && prev.maxAmount === nextMaxAmount) return prev;
      return { ...prev, minAmount: nextMinAmount, maxAmount: nextMaxAmount };
    });
  }, [rawGoldCard]);

  async function handleSave() {
    setSaving(true);
    try {
      // Keep existing role commission untouched; fees live on قیمت‌ها.
      await updateRoleCommission(role.id, null, null, toExtra(limits));
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
      <div className="role-row__top">
        <span className="role-row__name">{role.name}</span>
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
              <input
                type="number"
                value={limits.minWeight}
                onChange={(e) => {
                  const minWeight = e.target.value;
                  setLimits({
                    ...limits,
                    minWeight,
                    minAmount: autoAmountFromWeight(minWeight, rawGoldCard),
                  });
                }}
              />
            </label>
            <label className="order-limits-box__field">
              <span>حداکثر وزن (گرم ۱۸)</span>
              <input
                type="number"
                value={limits.maxWeight}
                onChange={(e) => {
                  const maxWeight = e.target.value;
                  setLimits({
                    ...limits,
                    maxWeight,
                    maxAmount: autoAmountFromWeight(maxWeight, rawGoldCard),
                  });
                }}
              />
            </label>
            <label className="order-limits-box__field">
              <span>حداقل مبلغ (تومان) — خودکار از قیمت گرم ۱۸</span>
              <input type="number" value={limits.minAmount} readOnly />
            </label>
            <label className="order-limits-box__field">
              <span>حداکثر مبلغ (تومان) — خودکار از قیمت گرم ۱۸</span>
              <input type="number" value={limits.maxAmount} readOnly />
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
  const [rawGoldCard, setRawGoldCard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [newLimits, setNewLimits] = useState(emptyLimits(null));
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState("");

  function reload() {
    fetchRoles()
      .then(setRoles)
      .catch(console.error)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    reload();
    function applyPrice(payload) {
      setRawGoldCard(pickPrimaryGoldCard(payload));
    }
    fetchPrice().then(applyPrice).catch(() => {});
    const ws = openPriceSocket(applyPrice);
    return () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    };
  }, []);

  useEffect(() => {
    setNewLimits((prev) => {
      const nextMinAmount = autoAmountFromWeight(prev.minWeight, rawGoldCard);
      const nextMaxAmount = autoAmountFromWeight(prev.maxWeight, rawGoldCard);
      if (prev.minAmount === nextMinAmount && prev.maxAmount === nextMaxAmount) return prev;
      return { ...prev, minAmount: nextMinAmount, maxAmount: nextMaxAmount };
    });
  }, [rawGoldCard]);

  async function handleCreate(e) {
    e.preventDefault();
    setError("");
    if (!newName.trim()) {
      setError("نام دسته‌بندی الزامی است");
      return;
    }
    try {
      // Fees are configured per card on قیمت‌ها; create with zero role commission.
      await createRole(newName.trim(), "fixed", 0, toExtra(newLimits));
      setNewName("");
      setNewLimits(emptyLimits(null));
      setShowAdvanced(false);
      reload();
    } catch (e) {
      setError(e.message || "خطا در ایجاد دسته‌بندی");
    }
  }

  return (
    <div>
      <p className="notice-editor__hint" style={{ marginBottom: 12 }}>
        کارمزد هر کارت را از صفحه «قیمت‌ها» تنظیم کنید. اینجا فقط دسته‌بندی و محدودیت‌ها ساخته می‌شود.
      </p>

      <h3 className="notice-editor__hint">دسته‌بندی‌های موجود</h3>
      {loading ? (
        <p className="myorders__empty">در حال بارگذاری…</p>
      ) : roles.length === 0 ? (
        <p className="myorders__empty">هنوز دسته‌بندی‌ای ساخته نشده.</p>
      ) : (
        <div className="role-list">
          {roles.map((r) => (
            <RoleRow key={r.id} role={r} onUpdated={reload} rawGoldCard={rawGoldCard} />
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

        <button
          type="button"
          className="role-row__toggle"
          onClick={() => setShowAdvanced((s) => !s)}
        >
          {showAdvanced ? "بستن تنظیمات پیشرفته ‹" : "تنظیمات پیشرفته (اختیاری) ›"}
        </button>

        {showAdvanced && (
          <>
            <div className="role-row__advanced-grid">
              <label className="order-limits-box__field">
                <span>حداقل وزن (گرم ۱۸) — خالی = پیش‌فرض عمومی</span>
                <input
                  type="number"
                  value={newLimits.minWeight}
                  onChange={(e) => {
                    const minWeight = e.target.value;
                    setNewLimits({
                      ...newLimits,
                      minWeight,
                      minAmount: autoAmountFromWeight(minWeight, rawGoldCard),
                    });
                  }}
                />
              </label>
              <label className="order-limits-box__field">
                <span>حداکثر وزن (گرم ۱۸)</span>
                <input
                  type="number"
                  value={newLimits.maxWeight}
                  onChange={(e) => {
                    const maxWeight = e.target.value;
                    setNewLimits({
                      ...newLimits,
                      maxWeight,
                      maxAmount: autoAmountFromWeight(maxWeight, rawGoldCard),
                    });
                  }}
                />
              </label>
              <label className="order-limits-box__field">
                <span>حداقل مبلغ (تومان) — خودکار از قیمت گرم ۱۸</span>
                <input type="number" value={newLimits.minAmount} readOnly />
              </label>
              <label className="order-limits-box__field">
                <span>حداکثر مبلغ (تومان) — خودکار از قیمت گرم ۱۸</span>
                <input type="number" value={newLimits.maxAmount} readOnly />
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
          </>
        )}

        {error && <p className="field__error">{error}</p>}
        <button type="submit" className="modal-btn modal-btn--buy">
          ایجاد دسته‌بندی
        </button>
      </form>
    </div>
  );
}
