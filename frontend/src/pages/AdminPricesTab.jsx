import { useEffect, useState } from "react";
import { TEHRAN_TZ } from "../utils/tehranTime";
import {
  fetchAdminPriceCards,
  setPriceCardEnabled,
  setPriceCardOrderable,
  setPriceCardOverride,
  setPriceCardManualPrice,
  setPriceCardRoleCommission,
} from "../api";

function fa(n, opts) {
  if (n == null) return "—";
  return Number(n).toLocaleString("fa-IR", opts);
}

const TYPE_LABEL = { 1: "طلا (گرم/عیار)", 2: "سکه" };

function ManualPriceEditor({ card, busy, onSave }) {
  const [useManual, setUseManual] = useState(!!card.use_manual_price);
  const [buy, setBuy] = useState(card.manual_buy != null ? String(card.manual_buy) : "");
  const [sell, setSell] = useState(card.manual_sell != null ? String(card.manual_sell) : "");

  useEffect(() => {
    setUseManual(!!card.use_manual_price);
    setBuy(card.manual_buy != null ? String(card.manual_buy) : "");
    setSell(card.manual_sell != null ? String(card.manual_sell) : "");
  }, [card.goldbridge_item_id, card.use_manual_price, card.manual_buy, card.manual_sell]);

  return (
    <div className="price-cards-admin__manual">
      <label className="price-cards-admin__toggle">
        <input
          type="checkbox"
          checked={useManual}
          disabled={busy}
          onChange={(e) => setUseManual(e.target.checked)}
        />
        قیمت دستی (وقتی goldbridge غیرفعال است / به‌جای فید)
      </label>
      <div className="price-cards-admin__manual-inputs">
        <label>
          خرید (مثقال)
          <input
            type="number"
            inputMode="decimal"
            value={buy}
            disabled={busy || !useManual}
            onChange={(e) => setBuy(e.target.value)}
            placeholder="مثلاً ۳۴۵۰۰۰۰۰"
          />
        </label>
        <label>
          فروش (مثقال)
          <input
            type="number"
            inputMode="decimal"
            value={sell}
            disabled={busy || !useManual}
            onChange={(e) => setSell(e.target.value)}
            placeholder="مثلاً ۳۴۴۰۰۰۰۰"
          />
        </label>
      </div>
      <button
        type="button"
        className="price-cards-admin__save-btn"
        disabled={busy}
        onClick={() =>
          onSave({
            useManualPrice: useManual,
            manualBuy: buy === "" ? null : Number(buy),
            manualSell: sell === "" ? null : Number(sell),
          })
        }
      >
        ذخیره قیمت دستی
      </button>
      {card.price_source === "manual" && (
        <p className="price-cards-admin__manual-note">در حال نمایش قیمت دستی به مشتری</p>
      )}
    </div>
  );
}

function RoleCommissionEditor({ card, busy, onSave }) {
  const rows = card.role_commissions || [];
  const [drafts, setDrafts] = useState({});
  const manualMode = !!card.use_manual_price || card.price_source === "manual";

  useEffect(() => {
    const next = {};
    for (const r of rows) {
      next[r.role_id] = {
        commission_type: r.commission_type || "fixed",
        commission_value: String(r.commission_value ?? 0),
        can_order: r.can_order !== false,
      };
    }
    setDrafts(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.goldbridge_item_id, JSON.stringify(rows)]);

  if (!rows.length) {
    return <p className="price-cards-admin__hint">هنوز دسته‌بندی کاربری تعریف نشده.</p>;
  }

  return (
    <div className="price-cards-admin__commissions">
      <div className="price-cards-admin__commissions-title">کمیسیون و دسترسی هر دسته‌بندی برای این کارت</div>
      {manualMode && (
        <p className="price-cards-admin__manual-note">
          حالت قیمت دستی فعال است — با سوییچ «مجاز به سفارش» مشخص کنید کدام دسته‌بندی می‌تواند با این قیمت سفارش بدهد.
        </p>
      )}
      {rows.map((r) => {
        const draft = drafts[r.role_id] || {
          commission_type: r.commission_type,
          commission_value: String(r.commission_value ?? 0),
          can_order: r.can_order !== false,
        };
        return (
          <div key={r.role_id} className="price-cards-admin__commission-row">
            <div className="price-cards-admin__commission-role">
              <span>{r.role_name}</span>
              {r.is_override ? (
                <em className="is-override">سفارشی</em>
              ) : (
                <em>پیش‌فرض نقش</em>
              )}
            </div>
            <label className="price-cards-admin__toggle">
              <input
                type="checkbox"
                checked={draft.can_order !== false}
                disabled={busy}
                onChange={(e) =>
                  setDrafts((prev) => ({
                    ...prev,
                    [r.role_id]: { ...draft, can_order: e.target.checked },
                  }))
                }
              />
              مجاز به سفارش{manualMode ? " با قیمت دستی" : ""}
            </label>
            <div className="price-cards-admin__commission-fields">
              <select
                value={draft.commission_type}
                disabled={busy}
                onChange={(e) =>
                  setDrafts((prev) => ({
                    ...prev,
                    [r.role_id]: { ...draft, commission_type: e.target.value },
                  }))
                }
              >
                <option value="fixed">ثابت (تومان)</option>
                <option value="percentage">درصدی</option>
              </select>
              <input
                type="number"
                inputMode="decimal"
                value={draft.commission_value}
                disabled={busy}
                onChange={(e) =>
                  setDrafts((prev) => ({
                    ...prev,
                    [r.role_id]: { ...draft, commission_value: e.target.value },
                  }))
                }
              />
              <button
                type="button"
                className="price-cards-admin__save-btn"
                disabled={busy}
                onClick={() =>
                  onSave({
                    roleId: r.role_id,
                    commissionType: draft.commission_type,
                    commissionValue: Number(draft.commission_value || 0),
                    canOrder: draft.can_order !== false,
                  })
                }
              >
                ذخیره
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function AdminPricesTab() {
  const [cards, setCards] = useState(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [lastFetched, setLastFetched] = useState(null);

  function reload() {
    fetchAdminPriceCards()
      .then((data) => {
        setCards(data);
        setError("");
        setLastFetched(new Date());
      })
      .catch((e) => {
        console.error(e);
        setError("دریافت قیمت‌ها با خطا مواجه شد.");
      });
  }

  useEffect(() => {
    reload();
    const interval = setInterval(reload, 3000);
    return () => clearInterval(interval);
  }, []);

  async function toggleEnabled(card) {
    setBusyId(card.goldbridge_item_id);
    try {
      const updated = await setPriceCardEnabled(card.goldbridge_item_id, !card.is_enabled);
      setCards(updated);
    } catch (e) {
      alert(e.message || "خطا در تغییر وضعیت نمایش");
    } finally {
      setBusyId(null);
    }
  }

  async function toggleOrderable(card, side) {
    setBusyId(card.goldbridge_item_id);
    try {
      const nextBuy = side === "buy" ? !card.orderable_buy : card.orderable_buy;
      const nextSell = side === "sell" ? !card.orderable_sell : card.orderable_sell;
      const updated = await setPriceCardOrderable(card.goldbridge_item_id, nextBuy, nextSell);
      setCards(updated);
    } catch (e) {
      alert(e.message || "خطا در تغییر وضعیت سفارش‌پذیری");
    } finally {
      setBusyId(null);
    }
  }

  async function toggleOverride(card) {
    setBusyId(card.goldbridge_item_id);
    try {
      const updated = await setPriceCardOverride(card.goldbridge_item_id, !card.override_source_restriction);
      setCards(updated);
    } catch (e) {
      alert(e.message || "خطا در تغییر وضعیت override");
    } finally {
      setBusyId(null);
    }
  }

  async function saveManual(card, payload) {
    setBusyId(card.goldbridge_item_id);
    try {
      const updated = await setPriceCardManualPrice(card.goldbridge_item_id, payload);
      setCards(updated);
    } catch (e) {
      alert(e.message || "خطا در ذخیره قیمت دستی");
    } finally {
      setBusyId(null);
    }
  }

  async function saveCommission(card, payload) {
    setBusyId(card.goldbridge_item_id);
    try {
      const updated = await setPriceCardRoleCommission(card.goldbridge_item_id, payload);
      setCards(updated);
    } catch (e) {
      alert(e.message || "خطا در ذخیره کمیسیون");
    } finally {
      setBusyId(null);
    }
  }

  if (error && !cards) {
    return <p className="myorders__empty">{error}</p>;
  }
  if (!cards) {
    return <p className="myorders__empty">در حال بارگذاری…</p>;
  }

  const anyOrderable = cards.some((c) => c.orderable_buy || c.orderable_sell);

  return (
    <div className="admin-prices">
      <div className="admin-prices__head">
        <h3 className="dashboard__section-title">مدیریت کارت‌های قیمت</h3>
        <div className="admin-prices__meta">
          {lastFetched && (
            <span className="admin-prices__fetched">
              دریافت شد: {lastFetched.toLocaleTimeString("fa-IR", { timeZone: TEHRAN_TZ, hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          )}
        </div>
      </div>

      {!anyOrderable && (
        <p className="price-cards-admin__warning">
          در حال حاضر هیچ کارتی برای خرید یا فروش فعال نیست - مشتریان نمی‌توانند سفارش ثبت کنند.
        </p>
      )}

      <p className="price-cards-admin__hint">
        «نمایش به مشتری» یعنی قیمت این کارت روی صفحه اصلی نشان داده می‌شود.
        دکمه‌های «خرید» و «فروش» مستقل از هم هستند. کمیسیون هر دسته‌بندی روی همین کارت قابل تنظیم روزانه است.
        کارت‌های «متفرقه» و «نقد کارتخوان» قیمت را از آیتم id:1 می‌گیرند؛ کارمزد/اختلاف را از همین صفحه برای هر دسته‌بندی تنظیم کنید.
      </p>

      <div className="admin-prices__grid">
        {cards.map((c) => {
          const isMirrored = !!c.price_source_item_id || c.price_source === "mirrored";
          const sourceLabel =
            c.price_source === "manual"
              ? "دستی"
              : c.price_source === "mirrored" || isMirrored
                ? `آینه id:${c.price_source_item_id || 1}`
                : c.price_source === "live"
                  ? "زنده"
                  : "ناموجود";
          const labelModeFa =
            c.price_label_mode === "gram18_only"
              ? "نمایش: گرم ۱۸"
              : c.price_label_mode === "mesghal17_only"
                ? "نمایش: مثقال ۱۷"
                : c.price_label_mode === "mesghal_and_gram18"
                  ? "نمایش: مثقال + گرم"
                  : null;
          return (
          <div key={c.goldbridge_item_id} className={`admin-price-card ${!c.active && !isMirrored ? "admin-price-card--inactive" : ""}`}>
            <div className="admin-price-card__top">
              <span className="admin-price-card__name">{c.display_name}</span>
              <span className="admin-price-card__type">{TYPE_LABEL[c.type] || (isMirrored ? "طلا (گرم/عیار)" : "—")}</span>
            </div>

            <div className="admin-price-card__values">
              <div className="admin-price-card__value-item admin-price-card__value-item--sell">
                <span className="admin-price-card__value-label">فروش</span>
                <span className="admin-price-card__value-amount">{fa(c.sell)}</span>
              </div>
              <div className="admin-price-card__value-item admin-price-card__value-item--buy">
                <span className="admin-price-card__value-label">خرید</span>
                <span className="admin-price-card__value-amount">{fa(c.buy)}</span>
              </div>
            </div>

            <div className="admin-price-card__flags">
              {isMirrored ? (
                <span className="admin-price-card__flag is-on">کارت ویژه (آینه قیمت)</span>
              ) : (
                <span className={`admin-price-card__flag ${c.active ? "is-on" : "is-off"}`}>
                  {c.active ? "فعال در goldbridge" : "غیرفعال در goldbridge"}
                </span>
              )}
              <span className={`admin-price-card__flag ${c.price_source !== "unavailable" ? "is-on" : "is-off"}`}>
                منبع: {sourceLabel}
              </span>
              {labelModeFa && (
                <span className="admin-price-card__flag is-on">{labelModeFa}</span>
              )}
              {!isMirrored && (
                <>
                  <span className={`admin-price-card__flag ${c.allow_buy ? "is-on" : "is-off"}`}>
                    خرید {c.allow_buy ? "مجاز در منبع" : "غیرمجاز در منبع"}
                  </span>
                  <span className={`admin-price-card__flag ${c.allow_sell ? "is-on" : "is-off"}`}>
                    فروش {c.allow_sell ? "مجاز در منبع" : "غیرمجاز در منبع"}
                  </span>
                </>
              )}
            </div>

            <div className="price-cards-admin__actions">
              <label className="price-cards-admin__toggle">
                <input
                  type="checkbox"
                  checked={c.is_enabled}
                  disabled={busyId === c.goldbridge_item_id}
                  onChange={() => toggleEnabled(c)}
                />
                نمایش به مشتری
              </label>

              <div className="price-cards-admin__side-toggles">
                <button
                  className={c.orderable_buy ? "price-cards-admin__orderable-btn is-active" : "price-cards-admin__orderable-btn"}
                  disabled={busyId === c.goldbridge_item_id}
                  onClick={() => toggleOrderable(c, "buy")}
                >
                  {c.orderable_buy ? "✓ خرید فعال" : "فعال کردن خرید"}
                </button>
                <button
                  className={c.orderable_sell ? "price-cards-admin__orderable-btn is-active" : "price-cards-admin__orderable-btn"}
                  disabled={busyId === c.goldbridge_item_id}
                  onClick={() => toggleOrderable(c, "sell")}
                >
                  {c.orderable_sell ? "✓ فروش فعال" : "فعال کردن فروش"}
                </button>
              </div>

              {c.orderable_buy && !c.allow_buy && !c.override_source_restriction && c.price_source !== "manual" && !isMirrored && (
                <p className="price-cards-admin__blocked-note">
                  ⚠ خرید توسط شما فعال شده اما چون منبع (goldbridge) خرید این آیتم را غیرمجاز اعلام کرده،
                  برای مشتری غیرفعال نمایش داده می‌شود.
                </p>
              )}
              {c.orderable_sell && !c.allow_sell && !c.override_source_restriction && c.price_source !== "manual" && !isMirrored && (
                <p className="price-cards-admin__blocked-note">
                  ⚠ فروش توسط شما فعال شده اما چون منبع (goldbridge) فروش این آیتم را غیرمجاز اعلام کرده،
                  برای مشتری غیرفعال نمایش داده می‌شود.
                </p>
              )}

              {!isMirrored && (
                <>
                  <label className="price-cards-admin__toggle price-cards-admin__toggle--override">
                    <input
                      type="checkbox"
                      checked={c.override_source_restriction}
                      disabled={busyId === c.goldbridge_item_id}
                      onChange={() => toggleOverride(c)}
                    />
                    نادیده گرفتن محدودیت منبع (goldbridge) - تصمیم من نهایی باشد
                  </label>
                  {c.override_source_restriction && (
                    <p className="price-cards-admin__override-note">
                      فعال است: حتی اگر منبع این آیتم را غیرمجاز اعلام کند، تنظیمات بالای شما ملاک است.
                    </p>
                  )}

                  <ManualPriceEditor
                    card={c}
                    busy={busyId === c.goldbridge_item_id}
                    onSave={(payload) => saveManual(c, payload)}
                  />
                </>
              )}

              {isMirrored && (
                <p className="price-cards-admin__manual-note">
                  قیمت این کارت همیشه از آیتم id:{c.price_source_item_id || 1} گرفته می‌شود.
                  کارمزد/اختلاف هر دسته‌بندی را پایین تنظیم کنید.
                </p>
              )}

              <RoleCommissionEditor
                card={c}
                busy={busyId === c.goldbridge_item_id}
                onSave={(payload) => saveCommission(c, payload)}
              />
            </div>

            <div className="admin-price-card__footer">
              <span>id: {c.goldbridge_item_id}</span>
            </div>
          </div>
          );
        })}
      </div>
    </div>
  );
}
