import { useEffect, useState } from "react";
import { fetchAdminPriceCards, setPriceCardEnabled, setPriceCardOrderable, setPriceCardOverride } from "../api";

function fa(n, opts) {
  if (n == null) return "—";
  return Number(n).toLocaleString("fa-IR", opts);
}

const TYPE_LABEL = { 1: "طلا (گرم/عیار)", 2: "سکه" };

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
              دریافت شد: {lastFetched.toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
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
        دکمه‌های «خرید» و «فروش» مستقل از هم هستند - می‌توانید فقط یک طرف را برای هر کارت فعال کنید،
        قیمت طرف دیگر همچنان نمایش داده می‌شود ولی امکان سفارش ندارد.
      </p>

      <div className="admin-prices__grid">
        {cards.map((c) => (
          <div key={c.goldbridge_item_id} className={`admin-price-card ${!c.active ? "admin-price-card--inactive" : ""}`}>
            <div className="admin-price-card__top">
              <span className="admin-price-card__name">{c.display_name}</span>
              <span className="admin-price-card__type">{TYPE_LABEL[c.type] || "—"}</span>
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
              <span className={`admin-price-card__flag ${c.active ? "is-on" : "is-off"}`}>
                {c.active ? "فعال در goldbridge" : "غیرفعال در goldbridge"}
              </span>
              <span className={`admin-price-card__flag ${c.allow_buy ? "is-on" : "is-off"}`}>
                خرید {c.allow_buy ? "مجاز در منبع" : "غیرمجاز در منبع"}
              </span>
              <span className={`admin-price-card__flag ${c.allow_sell ? "is-on" : "is-off"}`}>
                فروش {c.allow_sell ? "مجاز در منبع" : "غیرمجاز در منبع"}
              </span>
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

              {c.orderable_buy && !c.allow_buy && !c.override_source_restriction && (
                <p className="price-cards-admin__blocked-note">
                  ⚠ خرید توسط شما فعال شده اما چون منبع (goldbridge) خرید این آیتم را غیرمجاز اعلام کرده،
                  برای مشتری غیرفعال نمایش داده می‌شود.
                </p>
              )}
              {c.orderable_sell && !c.allow_sell && !c.override_source_restriction && (
                <p className="price-cards-admin__blocked-note">
                  ⚠ فروش توسط شما فعال شده اما چون منبع (goldbridge) فروش این آیتم را غیرمجاز اعلام کرده،
                  برای مشتری غیرفعال نمایش داده می‌شود.
                </p>
              )}

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
            </div>

            <div className="admin-price-card__footer">
              <span>id: {c.goldbridge_item_id}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}