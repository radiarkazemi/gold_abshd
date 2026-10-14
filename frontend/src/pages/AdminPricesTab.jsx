import { useEffect, useMemo, useRef, useState } from "react";
import { TEHRAN_TZ } from "../utils/tehranTime";
import {
  fetchAdminPriceCards,
  setPriceCardEnabled,
  setPriceCardOrderable,
  setPriceCardOverride,
  setPriceCardManualPrice,
  setPriceCardRoleCommission,
} from "../api";
import FormattedNumberInput from "../components/FormattedNumberInput";
import "./AdminPricesTab.css";

const SPECIAL_MOTAFEREGHE_ID = 900001;
const SPECIAL_NAGHD_KARTKHAN_ID = 900002;
const SOURCE_MIRROR_ITEM_ID = 1;

function fa(n, opts) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return Number(n).toLocaleString("fa-IR", opts);
}

function parseFeeNumber(raw) {
  const s = String(raw ?? "")
    .replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
    .replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
    .replace(/,/g, "")
    .replace(/٬/g, "")
    .replace(/٫/g, ".")
    .trim();
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function syncMirroredCardQuotes(cards) {
  if (!Array.isArray(cards)) return cards;
  const source = cards.find((c) => Number(c.goldbridge_item_id) === SOURCE_MIRROR_ITEM_ID);
  if (!source) return cards;
  const buy = Number(source.buy);
  if (!(buy > 0)) return cards;
  const mirroredMode =
    source.use_manual_price || source.price_source === "manual" ? "manual" : "live";
  return cards.map((c) => {
    const id = Number(c.goldbridge_item_id);
    if (id !== SPECIAL_MOTAFEREGHE_ID && id !== SPECIAL_NAGHD_KARTKHAN_ID) return c;
    if (Number(c.buy) === buy && Number(c.sell) === buy && c.mirrored_source_mode === mirroredMode) {
      return c;
    }
    return {
      ...c,
      buy,
      sell: buy,
      price_source: "mirrored",
      mirrored_source_mode: mirroredMode,
    };
  });
}

function isMirroredCard(card) {
  return !!card.price_source_item_id || card.price_source === "mirrored";
}

function isBlocked(card) {
  if (isMirroredCard(card)) return false;
  if (card.price_source === "manual" || card.use_manual_price) return false;
  return !card.allow_buy || !card.allow_sell;
}

function cardKind(card) {
  return isMirroredCard(card) ? "derived" : "direct";
}

function cardTypeKey(card) {
  return Number(card.type) === 2 || card.unit === "count" ? "coin" : "gold";
}

function sourceLabel(card) {
  if (card.use_manual_price || card.price_source === "manual") return "قیمت دستی";
  if (isMirroredCard(card)) {
    return `آینه id:${card.price_source_item_id || 1}${card.mirrored_source_mode === "manual" ? " (دستی)" : ""}`;
  }
  if (card.price_source === "live") return "goldbridge";
  return "ناموجود";
}

function statusBadge(card) {
  if (card.override_source_restriction) return { label: "مجوز مدیریتی", warn: false };
  if (isBlocked(card) && !card.override_source_restriction) return { label: "محدودیت منبع", warn: true };
  if (card.use_manual_price || card.price_source === "manual") return { label: "دستی", warn: false };
  return { label: "از منبع", warn: false };
}

function cardSubtitle(card) {
  const kind = cardKind(card);
  const type = cardTypeKey(card);
  const base = type === "coin" ? "سکه · عدد" : "طلا · مثقال / عیار ۷۰۵";
  return kind === "derived" ? `${base}  /  قیمت محاسباتی` : base;
}

function footerStatus(card) {
  const blocked = isBlocked(card) && !card.override_source_restriction;
  if (blocked) return "△ سفارش محدود به مجوز منبع";
  if (card.use_manual_price || card.price_source === "manual") return "قیمت دستی فعال";
  if (card.is_enabled && (card.orderable_buy || card.orderable_sell)) return "● آماده نمایش و سفارش";
  return "کمیسیون · گروه‌های مشتری";
}

function draftFromRow(r) {
  const buy = r.commission_buy_value ?? r.commission_value ?? 0;
  const sell = r.commission_sell_value ?? r.commission_value ?? 0;
  return {
    commission_type: r.commission_type || "fixed",
    commission_buy_value: String(buy ?? 0),
    commission_sell_value: String(sell ?? 0),
    can_order: r.can_order !== false,
  };
}

function Switch({ on, onClick, label, disabled }) {
  return (
    <button
      type="button"
      className={`price-desk__switch ${on ? "is-on" : ""}`}
      role="switch"
      aria-checked={!!on}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    />
  );
}

function buildDrawerDraft(card) {
  const rows = card.role_commissions || [];
  const groups = {};
  for (const r of rows) {
    groups[r.role_id] = draftFromRow(r);
  }
  return {
    visible: !!card.is_enabled,
    b: !!card.orderable_buy,
    s: !!card.orderable_sell,
    override: !!card.override_source_restriction,
    manual: !!card.use_manual_price || card.price_source === "manual",
    manualBuy: card.manual_buy != null ? String(card.manual_buy) : card.buy != null ? String(card.buy) : "",
    manualSell: card.manual_sell != null ? String(card.manual_sell) : card.sell != null ? String(card.sell) : "",
    groups,
  };
}

export default function AdminPricesTab() {
  const [cards, setCards] = useState(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [lastFetched, setLastFetched] = useState(null);
  const [filter, setFilter] = useState("all");
  const [view, setView] = useState("cards");
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState("");
  const [drawerCardId, setDrawerCardId] = useState(null);
  const [drawerTab, setDrawerTab] = useState("price");
  const [draft, setDraft] = useState(null);
  const [savingDrawer, setSavingDrawer] = useState(false);
  const busyIdRef = useRef(null);
  const fetchGenRef = useRef(0);
  const toastTimer = useRef(null);

  useEffect(() => {
    busyIdRef.current = busyId;
  }, [busyId]);

  function showToast(msg) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 3200);
  }

  function reload({ force = false } = {}) {
    if (!force && busyIdRef.current != null) return;
    const gen = ++fetchGenRef.current;
    fetchAdminPriceCards()
      .then((data) => {
        if (gen !== fetchGenRef.current) return;
        if (!force && busyIdRef.current != null) return;
        setCards(syncMirroredCardQuotes(data));
        setError("");
        setLastFetched(new Date());
      })
      .catch((e) => {
        console.error(e);
        if (gen === fetchGenRef.current) setError("دریافت قیمت‌ها با خطا مواجه شد.");
      });
  }

  useEffect(() => {
    reload({ force: true });
    const interval = setInterval(() => reload(), 3000);
    return () => {
      clearInterval(interval);
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!drawerCardId) return;
    const onKey = (e) => {
      if (e.key === "Escape") closeDrawer();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [drawerCardId]);

  const drawerCard = useMemo(
    () => (cards || []).find((c) => Number(c.goldbridge_item_id) === Number(drawerCardId)) || null,
    [cards, drawerCardId]
  );

  const filtered = useMemo(() => {
    const list = cards || [];
    const q = search.trim();
    return list.filter((c) => {
      const blocked = isBlocked(c) && !c.override_source_restriction;
      if (filter === "gold" && cardTypeKey(c) !== "gold") return false;
      if (filter === "coin" && cardTypeKey(c) !== "coin") return false;
      if (filter === "review" && !blocked) return false;
      if (filter === "visible" && !c.is_enabled) return false;
      if (!q) return true;
      const hay = `${c.display_name || ""} ${sourceLabel(c)} ${c.goldbridge_item_id}`;
      return hay.includes(q);
    });
  }, [cards, filter, search]);

  const stats = useMemo(() => {
    const list = cards || [];
    return {
      total: list.length,
      visible: list.filter((c) => c.is_enabled).length,
      review: list.filter((c) => isBlocked(c) && !c.override_source_restriction).length,
    };
  }, [cards]);

  async function toggleEnabled(card) {
    busyIdRef.current = card.goldbridge_item_id;
    setBusyId(card.goldbridge_item_id);
    try {
      const updated = await setPriceCardEnabled(card.goldbridge_item_id, !card.is_enabled);
      setCards(syncMirroredCardQuotes(updated));
      fetchGenRef.current += 1;
      showToast("تنظیمات کارت ذخیره شد");
    } catch (e) {
      alert(e.message || "خطا در تغییر وضعیت نمایش");
    } finally {
      busyIdRef.current = null;
      setBusyId(null);
    }
  }

  async function toggleOrderable(card, side) {
    busyIdRef.current = card.goldbridge_item_id;
    setBusyId(card.goldbridge_item_id);
    try {
      const nextBuy = side === "buy" ? !card.orderable_buy : card.orderable_buy;
      const nextSell = side === "sell" ? !card.orderable_sell : card.orderable_sell;
      const updated = await setPriceCardOrderable(card.goldbridge_item_id, nextBuy, nextSell);
      setCards(syncMirroredCardQuotes(updated));
      fetchGenRef.current += 1;
      const blocked = isBlocked(card) && !card.override_source_restriction;
      showToast(
        blocked
          ? "تنظیم ذخیره شد؛ محدودیت منبع همچنان برقرار است"
          : "تنظیمات کارت ذخیره شد"
      );
    } catch (e) {
      alert(e.message || "خطا در تغییر وضعیت سفارش‌پذیری");
    } finally {
      busyIdRef.current = null;
      setBusyId(null);
    }
  }

  function openDrawer(card) {
    setDrawerCardId(card.goldbridge_item_id);
    setDrawerTab("price");
    setDraft(buildDrawerDraft(card));
  }

  function closeDrawer() {
    setDrawerCardId(null);
    setDraft(null);
    setSavingDrawer(false);
  }

  async function saveDrawer() {
    if (!drawerCard || !draft) return;
    if (draft.manual) {
      const buy = parseFeeNumber(draft.manualBuy);
      const sell = parseFeeNumber(draft.manualSell);
      if (!(buy > 0) || !(sell > 0)) {
        showToast("قیمت دستی باید بیشتر از صفر باشد");
        return;
      }
    }

    setSavingDrawer(true);
    busyIdRef.current = drawerCard.goldbridge_item_id;
    setBusyId(drawerCard.goldbridge_item_id);
    try {
      if (!!drawerCard.is_enabled !== !!draft.visible) {
        await setPriceCardEnabled(drawerCard.goldbridge_item_id, !!draft.visible);
      }
      if (
        !!drawerCard.orderable_buy !== !!draft.b
        || !!drawerCard.orderable_sell !== !!draft.s
      ) {
        await setPriceCardOrderable(drawerCard.goldbridge_item_id, !!draft.b, !!draft.s);
      }
      if (!isMirroredCard(drawerCard)) {
        if (!!drawerCard.override_source_restriction !== !!draft.override) {
          await setPriceCardOverride(drawerCard.goldbridge_item_id, !!draft.override);
        }
        const wasManual = !!drawerCard.use_manual_price || drawerCard.price_source === "manual";
        if (wasManual !== !!draft.manual || draft.manual) {
          await setPriceCardManualPrice(drawerCard.goldbridge_item_id, {
            useManualPrice: !!draft.manual,
            manualBuy: draft.manualBuy === "" ? null : parseFeeNumber(draft.manualBuy),
            manualSell: draft.manualSell === "" ? null : parseFeeNumber(draft.manualSell),
          });
        }
      }

      const rows = drawerCard.role_commissions || [];
      for (const r of rows) {
        const g = draft.groups?.[r.role_id] || draftFromRow(r);
        const buyFee = parseFeeNumber(g.commission_buy_value);
        const sellFee = parseFeeNumber(g.commission_sell_value);
        if (!Number.isFinite(buyFee) || !Number.isFinite(sellFee)) {
          throw new Error(`کارمزد نامعتبر برای ${r.role_name}`);
        }
        await setPriceCardRoleCommission(drawerCard.goldbridge_item_id, {
          roleId: r.role_id,
          commissionType: g.commission_type,
          commissionValue: buyFee,
          commissionBuyValue: buyFee,
          commissionSellValue: sellFee,
          canOrder: g.can_order !== false,
        });
      }

      fetchGenRef.current += 1;
      const fresh = await fetchAdminPriceCards();
      setCards(syncMirroredCardQuotes(fresh));
      setLastFetched(new Date());
      showToast(`تغییرات ${drawerCard.display_name} ذخیره شد`);
      closeDrawer();
    } catch (e) {
      alert(e.message || "خطا در ذخیره تنظیمات");
      reload({ force: true });
    } finally {
      busyIdRef.current = null;
      setBusyId(null);
      setSavingDrawer(false);
    }
  }

  if (error && !cards) {
    return <p className="price-desk__error">{error}</p>;
  }
  if (!cards) {
    return <p className="price-desk__loading">در حال بارگذاری…</p>;
  }

  const reviewCount = stats.review;
  const displayBuy = (c) =>
    c.use_manual_price || c.price_source === "manual"
      ? c.manual_buy ?? c.buy
      : c.buy;
  const displaySell = (c) =>
    c.use_manual_price || c.price_source === "manual"
      ? c.manual_sell ?? c.sell
      : c.sell;

  return (
    <div className="price-desk">
      <div className="price-desk__title">
        <div>
          <h1>مرکز قیمت</h1>
          <p>همه منابع قیمت، با کنترل دقیق و یک نگاه روشن.</p>
        </div>
        <button
          type="button"
          className="price-desk__btn"
          onClick={() => {
            reload({ force: true });
            showToast("قیمت‌ها بازخوانی شدند");
          }}
        >
          ↻ &nbsp; بازخوانی
        </button>
      </div>

      <div className="price-desk__overview">
        <button
          type="button"
          className="price-desk__stat"
          onClick={() => setFilter("all")}
          aria-label="همه کارت‌های قیمت"
        >
          <div>
            <span>کارت‌های قیمت</span>
            <b>{fa(stats.total)}</b>
          </div>
          <i>◈</i>
        </button>
        <button
          type="button"
          className="price-desk__stat"
          onClick={() => {
            setFilter("visible");
            setSearch("");
          }}
          aria-label="کارت‌های قابل نمایش"
        >
          <div>
            <span>نمایش به مشتری</span>
            <b>{fa(stats.visible)}</b>
          </div>
          <i>◉</i>
        </button>
        <button
          type="button"
          className="price-desk__stat"
          onClick={() => setFilter("review")}
          aria-label="کارت‌های نیازمند بررسی"
        >
          <div>
            <span>نیازمند بررسی</span>
            <b>{fa(stats.review)}</b>
          </div>
          <i>△</i>
        </button>
      </div>

      <div className="price-desk__toolbar">
        <div className="price-desk__tabs" role="tablist" aria-label="فیلتر قیمت‌ها">
          {[
            ["all", "همه قیمت‌ها"],
            ["gold", "آبشده و طلا"],
            ["coin", "سکه"],
            ["review", "نیازمند بررسی"],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={filter === key ? "is-active" : ""}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="price-desk__tools">
          <div className="price-desk__viewpicker" aria-label="نوع نمایش">
            <button
              type="button"
              className={view === "cards" ? "is-active" : ""}
              onClick={() => setView("cards")}
            >
              ▦ کارت‌ها
            </button>
            <button
              type="button"
              className={view === "compact" ? "is-active" : ""}
              onClick={() => setView("compact")}
            >
              ☷ فشرده
            </button>
          </div>
          <label className="price-desk__search">
            ⌕
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="جستجوی نام قیمت یا منبع..."
              aria-label="جستجوی قیمت"
            />
          </label>
        </div>
      </div>

      <div className="price-desk__notice">
        {reviewCount > 0 ? (
          <>
            <div>
              <b>{fa(reviewCount)} منبع نیاز به بررسی دارد</b>
              مجوز خرید و فروش این کارت‌ها از سمت منبع محدود شده است.
            </div>
            <button type="button" onClick={() => setFilter("review")}>
              بررسی کارت‌ها ←
            </button>
          </>
        ) : (
          <div>
            <b>همه محدودیت‌های منبع بررسی شده‌اند</b>
            وضعیت سفارش هر کارت از تنظیمات اختصاصی آن مشخص می‌شود.
          </div>
        )}
      </div>

      <div className="price-desk__sectionline">
        <span>{fa(filtered.length)} کارت قیمت</span>
        <span className="price-desk__meta">
          واحد مبالغ: تومان
          {lastFetched && (
            <>
              {" · "}
              دریافت{" "}
              {lastFetched.toLocaleTimeString("fa-IR", {
                timeZone: TEHRAN_TZ,
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </>
          )}
        </span>
      </div>

      <div className={`price-desk__grid ${view === "compact" ? "is-compact" : ""}`}>
        {filtered.length === 0 && <div className="price-desk__empty">قیمتی با این مشخصات پیدا نشد.</div>}
        {filtered.map((c) => {
          const busy = busyId === c.goldbridge_item_id;
          const badge = statusBadge(c);
          const blocked = isBlocked(c) && !c.override_source_restriction;
          return (
            <article key={c.goldbridge_item_id} className="price-desk__card">
              <div className="price-desk__cardhead">
                <div>
                  <h2>{c.display_name}</h2>
                  <span className="price-desk__sub">{cardSubtitle(c)}</span>
                </div>
                <div className="price-desk__symbol">{cardTypeKey(c) === "gold" ? "◇" : "◉"}</div>
              </div>

              <div className="price-desk__source">
                <span>
                  <span className="price-desk__dot" />
                  {sourceLabel(c)}
                </span>
                <span className={`price-desk__badge ${badge.warn ? "is-warn" : ""}`}>{badge.label}</span>
              </div>

              <div className="price-desk__prices">
                <div className="price-desk__price">
                  <span>خرید</span>
                  <b>{fa(displayBuy(c))}</b>
                  <small>تومان</small>
                </div>
                <div className="price-desk__price price-desk__price--sell">
                  <span>فروش</span>
                  <b>{fa(displaySell(c))}</b>
                  <small>تومان</small>
                </div>
              </div>

              <div className="price-desk__switchrow">
                <span className="price-desk__swlabel">
                  <Switch
                    on={!!c.orderable_buy}
                    disabled={busy}
                    label={`فعال بودن خرید ${c.display_name}`}
                    onClick={() => toggleOrderable(c, "buy")}
                  />
                  خرید
                </span>
                <span className="price-desk__swlabel">
                  <Switch
                    on={!!c.orderable_sell}
                    disabled={busy}
                    label={`فعال بودن فروش ${c.display_name}`}
                    onClick={() => toggleOrderable(c, "sell")}
                  />
                  فروش
                </span>
                <span className="price-desk__swlabel">
                  <Switch
                    on={!!c.is_enabled}
                    disabled={busy}
                    label={`نمایش به مشتری ${c.display_name}`}
                    onClick={() => toggleEnabled(c)}
                  />
                  نمایش
                </span>
              </div>

              <div className="price-desk__cardbottom">
                <span>{footerStatus(c)}</span>
                <button type="button" className="price-desk__edit" onClick={() => openDrawer(c)}>
                  تنظیمات قیمت <span>←</span>
                </button>
              </div>

              {blocked && (c.orderable_buy || c.orderable_sell) && (
                <div className="price-desk__hint" style={{ margin: "0 16px 14px" }}>
                  منبع خرید/فروش را محدود کرده؛ برای اعمال تنظیمات شما، «نادیده گرفتن محدودیت منبع» را در تنظیمات قیمت روشن کنید.
                </div>
              )}
            </article>
          );
        })}
      </div>

      <div className="price-desk__info">
        <span>◉ &nbsp; برای تغییر قیمت دستی، محدودیت منبع و کمیسیون گروه‌ها، «تنظیمات قیمت» را باز کنید.</span>
        <span>تغییرات روی سرور ذخیره می‌شوند.</span>
      </div>

      {drawerCard && draft && (
        <div
          className="price-desk__overlay is-open"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeDrawer();
          }}
        >
          <section className="price-desk__drawer" role="dialog" aria-modal="true" aria-labelledby="priceDeskDrawerTitle">
            <header className="price-desk__drawerhead">
              <div>
                <h2 id="priceDeskDrawerTitle">{drawerCard.display_name}</h2>
                <p>تنظیمات اختصاصی این کارت قیمت</p>
              </div>
              <button type="button" className="price-desk__close" aria-label="بستن" onClick={closeDrawer}>
                ×
              </button>
            </header>

            <div className="price-desk__drawerbody">
              <div className="price-desk__panel">
                <div className="price-desk__source" style={{ padding: 0 }}>
                  <span>منبع قیمت: {sourceLabel(drawerCard)}</span>
                  <span className={`price-desk__badge ${isBlocked(drawerCard) ? "is-warn" : ""}`}>
                    {isBlocked(drawerCard) ? "محدودیت منبع" : "منبع فعال"}
                  </span>
                </div>
                <div className="price-desk__two" style={{ marginTop: 15 }}>
                  <div>
                    <span className="price-desk__sub">خرید منبع</span>
                    <h3 style={{ margin: "5px 0", color: "#377453" }}>{fa(drawerCard.buy)}</h3>
                  </div>
                  <div>
                    <span className="price-desk__sub">فروش منبع</span>
                    <h3 style={{ margin: "5px 0", color: "#a66248" }}>{fa(drawerCard.sell)}</h3>
                  </div>
                </div>
              </div>

              <div className="price-desk__tabs">
                <button
                  type="button"
                  className={drawerTab === "price" ? "is-active" : ""}
                  onClick={() => setDrawerTab("price")}
                >
                  قیمت و دسترسی
                </button>
                <button
                  type="button"
                  className={drawerTab === "groups" ? "is-active" : ""}
                  onClick={() => setDrawerTab("groups")}
                >
                  کمیسیون گروه‌ها
                </button>
              </div>

              {drawerTab === "price" ? (
                <>
                  <div className="price-desk__panel">
                    <h3>دسترسی‌های این قیمت</h3>
                    {[
                      ["visible", "نمایش به مشتری"],
                      ["b", "فعال بودن خرید"],
                      ["s", "فعال بودن فروش"],
                    ].map(([key, label]) => (
                      <div className="price-desk__line" key={key}>
                        <span>{label}</span>
                        <Switch
                          on={!!draft[key]}
                          label={label}
                          onClick={() => setDraft((d) => ({ ...d, [key]: !d[key] }))}
                        />
                      </div>
                    ))}
                    {!isMirroredCard(drawerCard) && (
                      <>
                        <div className="price-desk__line">
                          <span>نادیده گرفتن محدودیت منبع</span>
                          <Switch
                            on={!!draft.override}
                            label="نادیده گرفتن محدودیت منبع"
                            onClick={() => setDraft((d) => ({ ...d, override: !d.override }))}
                          />
                        </div>
                        {isBlocked(drawerCard) && (
                          <div className="price-desk__hint">
                            منبع، خرید و فروش این قیمت را غیرمجاز اعلام کرده است. با فعال‌سازی گزینه بالا، تصمیم نهایی با تنظیمات شما خواهد بود.
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {!isMirroredCard(drawerCard) ? (
                    <div className="price-desk__panel">
                      <div className="price-desk__line" style={{ marginTop: 0 }}>
                        <h3 style={{ margin: 0 }}>قیمت دستی</h3>
                        <Switch
                          on={!!draft.manual}
                          label="قیمت دستی"
                          onClick={() => setDraft((d) => ({ ...d, manual: !d.manual }))}
                        />
                      </div>
                      <p style={{ fontSize: 10, lineHeight: 1.9, margin: "0 0 8px", color: "#7a8371" }}>
                        با فعال‌سازی، قیمت این کارت از مقادیر دستی استفاده می‌کند.
                      </p>
                      <div className="price-desk__two">
                        <div className="price-desk__field">
                          <label htmlFor="pd-manual-buy">خرید دستی · تومان</label>
                          <FormattedNumberInput
                            value={draft.manualBuy}
                            disabled={!draft.manual || savingDrawer}
                            onChange={(raw) => setDraft((d) => ({ ...d, manualBuy: raw }))}
                            placeholder="مثلاً 112,450,000"
                            aria-label="خرید دستی"
                          />
                        </div>
                        <div className="price-desk__field">
                          <label htmlFor="pd-manual-sell">فروش دستی · تومان</label>
                          <FormattedNumberInput
                            value={draft.manualSell}
                            disabled={!draft.manual || savingDrawer}
                            onChange={(raw) => setDraft((d) => ({ ...d, manualSell: raw }))}
                            placeholder="مثلاً 112,350,000"
                            aria-label="فروش دستی"
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="price-desk__hint">
                      {drawerCard.goldbridge_item_id === SPECIAL_MOTAFEREGHE_ID
                        ? "متفرقه: قیمت پایه از id:1 گرفته می‌شود؛ تبدیل عیار پس از کارمزد اعمال می‌شود."
                        : "نقد کارتخوان: قیمت از id:1 محاسبه می‌شود؛ مقدار ثابت پس از کارمزد اضافه می‌شود."}
                    </div>
                  )}
                </>
              ) : (
                <div className="price-desk__panel">
                  <h3>کارمزد و مجوز سفارش</h3>
                  <p style={{ fontSize: 10, lineHeight: 1.9, marginBottom: 20, color: "#7a8371" }}>
                    {cardKind(drawerCard) === "direct"
                      ? "کارمزد خرید به قیمت خرید اضافه و کارمزد فروش از قیمت فروش کسر می‌شود."
                      : "کارمزد گروه مطابق فرمول اختصاصی همین کارت اعمال می‌شود."}
                  </p>
                  {(drawerCard.role_commissions || []).length === 0 && (
                    <p className="price-desk__sub">هنوز دسته‌بندی کاربری تعریف نشده.</p>
                  )}
                  {(drawerCard.role_commissions || []).map((r) => {
                    const g = draft.groups?.[r.role_id] || draftFromRow(r);
                    const split = cardKind(drawerCard) === "direct"
                      && drawerCard.buy != null
                      && drawerCard.sell != null
                      && drawerCard.goldbridge_item_id !== SPECIAL_MOTAFEREGHE_ID
                      && drawerCard.goldbridge_item_id !== SPECIAL_NAGHD_KARTKHAN_ID;
                    return (
                      <div key={r.role_id} className="price-desk__group">
                        <div className="price-desk__grouphead">
                          <b>
                            {r.role_name}{" "}
                            <small>{r.is_override ? "سفارشی" : "پیش‌فرض نقش"}</small>
                          </b>
                          <span className="price-desk__swlabel">
                            مجوز سفارش
                            <Switch
                              on={g.can_order !== false}
                              label={`مجوز سفارش ${r.role_name}`}
                              onClick={() =>
                                setDraft((d) => ({
                                  ...d,
                                  groups: {
                                    ...d.groups,
                                    [r.role_id]: { ...g, can_order: !(g.can_order !== false) },
                                  },
                                }))
                              }
                            />
                          </span>
                        </div>
                        <div className="price-desk__commission">
                          <div>
                            <label>نوع کارمزد</label>
                            <select
                              value={g.commission_type}
                              onChange={(e) =>
                                setDraft((d) => ({
                                  ...d,
                                  groups: {
                                    ...d.groups,
                                    [r.role_id]: { ...g, commission_type: e.target.value },
                                  },
                                }))
                              }
                            >
                              <option value="fixed">ثابت (تومان)</option>
                              <option value="percentage">درصدی</option>
                            </select>
                          </div>
                          <div>
                            <label>{split ? "خرید" : "کارمزد"}</label>
                            <FormattedNumberInput
                              value={g.commission_buy_value}
                              onChange={(raw) =>
                                setDraft((d) => ({
                                  ...d,
                                  groups: {
                                    ...d.groups,
                                    [r.role_id]: {
                                      ...g,
                                      commission_buy_value: raw,
                                      commission_sell_value: split ? g.commission_sell_value : raw,
                                    },
                                  },
                                }))
                              }
                              placeholder={g.commission_type === "percentage" ? "۰٫۵" : "۲۰٬۰۰۰"}
                            />
                          </div>
                          {split && (
                            <div>
                              <label>فروش</label>
                              <FormattedNumberInput
                                value={g.commission_sell_value}
                                onChange={(raw) =>
                                  setDraft((d) => ({
                                    ...d,
                                    groups: {
                                      ...d.groups,
                                      [r.role_id]: { ...g, commission_sell_value: raw },
                                    },
                                  }))
                                }
                                placeholder={g.commission_type === "percentage" ? "۰٫۵" : "۲۰٬۰۰۰"}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="price-desk__summary">
                <span>
                  حالت قیمت
                  <b style={{ display: "block", marginTop: 4 }}>
                    {draft.manual ? "دستی" : cardKind(drawerCard) === "derived" ? "محاسباتی" : "از منبع"}
                  </b>
                </span>
                <span>
                  نمایش به مشتری
                  <b style={{ display: "block", marginTop: 4 }}>{draft.visible ? "فعال" : "مخفی"}</b>
                </span>
                <span>
                  مجوز منبع
                  <b style={{ display: "block", marginTop: 4 }}>
                    {draft.override ? "تصمیم مدیر" : isBlocked(drawerCard) ? "محدود" : "مجاز"}
                  </b>
                </span>
              </div>
              <p style={{ fontSize: 10, textAlign: "left", direction: "ltr", color: "#8b947e" }}>
                Card ID: {drawerCard.goldbridge_item_id}
              </p>
            </div>

            <footer className="price-desk__drawerfoot">
              <span>تغییرات در انتظار ذخیره</span>
              <button type="button" className="price-desk__btn" onClick={closeDrawer} disabled={savingDrawer}>
                انصراف
              </button>
              <button
                type="button"
                className="price-desk__btn price-desk__btn--gold"
                onClick={saveDrawer}
                disabled={savingDrawer}
              >
                {savingDrawer ? "…" : "ذخیره تغییرات"}
              </button>
            </footer>
          </section>
        </div>
      )}

      {toast && (
        <div className="price-desk__toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
