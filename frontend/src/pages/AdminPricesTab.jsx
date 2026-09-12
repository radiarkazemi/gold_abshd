import { useEffect, useRef, useState } from "react";
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

function fa(n, opts) {
  if (n == null) return "—";
  return Number(n).toLocaleString("fa-IR", opts);
}

const TYPE_LABEL = { 1: "طلا (گرم/عیار)", 2: "سکه" };
const SPECIAL_MOTAFEREGHE_ID = 900001;
const SPECIAL_NAGHD_KARTKHAN_ID = 900002;
const SOURCE_MIRROR_ITEM_ID = 1;
const FARSHAD_TRADE_CASH_ITEM_ID = 1013;

/** Visible quote origin for every admin card. */
function quoteStatus(card) {
  const isMirrored = !!card.price_source_item_id || card.price_source === "mirrored";
  const missing = card.price_source === "unavailable" || (card.buy == null && card.sell == null);
  if (missing) {
    return { kind: "unavailable", label: "ناموجود" };
  }
  if (isMirrored) {
    if (card.mirrored_source_mode === "manual") {
      return { kind: "manual", label: "دستی (از id:1)" };
    }
    return { kind: "source", label: "از منبع" };
  }
  if (card.use_manual_price || card.price_source === "manual") {
    return { kind: "manual", label: "دستی" };
  }
  return { kind: "source", label: "از منبع" };
}
function syncMirroredCardQuotes(cards) {
  if (!Array.isArray(cards)) return cards;
  const source = cards.find((c) => Number(c.goldbridge_item_id) === SOURCE_MIRROR_ITEM_ID);
  if (!source) return cards;
  const mirroredMode =
    source.use_manual_price || source.price_source === "manual" ? "manual" : "live";
  // Mirrored formulas use raw id:1 buy (or typed manual), not the shop-padded customer quote.
  const buy = Number(
    mirroredMode === "manual"
      ? source.buy
      : source.live_buy ?? source.farshad_buy ?? source.buy
  );
  if (!(buy > 0)) return cards;
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

/** Parse toman/percent fee from typed input (commas / Persian digits OK). */
function parseFeeNumber(raw) {
  const s = String(raw ?? "")
    .replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
    .replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
    .replace(/,/g, "")
    .replace(/٫/g, ".")
    .trim();
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function ManualPriceEditor({ card, busy, onSave }) {
  const [useManual, setUseManual] = useState(!!card.use_manual_price);
  const [buy, setBuy] = useState(card.manual_buy != null ? String(card.manual_buy) : "");
  const [sell, setSell] = useState(card.manual_sell != null ? String(card.manual_sell) : "");
  const dirtyRef = useRef(false);
  const prevBusyRef = useRef(busy);

  // Hydrate when switching cards
  useEffect(() => {
    dirtyRef.current = false;
    setUseManual(!!card.use_manual_price);
    setBuy(card.manual_buy != null ? String(card.manual_buy) : "");
    setSell(card.manual_sell != null ? String(card.manual_sell) : "");
  }, [card.goldbridge_item_id]);

  // After save completes, sync from server — never on live poll while dirty.
  useEffect(() => {
    const wasBusy = prevBusyRef.current;
    prevBusyRef.current = busy;
    if (!(wasBusy && !busy)) return;
    if (dirtyRef.current) return;
    setUseManual(!!card.use_manual_price);
    setBuy(card.manual_buy != null ? String(card.manual_buy) : "");
    setSell(card.manual_sell != null ? String(card.manual_sell) : "");
  }, [busy, card.use_manual_price, card.manual_buy, card.manual_sell]);

  // Poll/refresh: keep the checkbox aligned with the server while the admin
  // is not mid-edit.
  useEffect(() => {
    if (dirtyRef.current) return;
    setUseManual(!!card.use_manual_price);
  }, [card.use_manual_price]);

  return (
    <div className="price-cards-admin__manual">
      <label className="price-cards-admin__toggle">
        <input
          type="checkbox"
          checked={useManual}
          disabled={busy}
          onChange={(e) => {
            const next = e.target.checked;
            setUseManual(next);
            if (!next) {
              // Untick must persist immediately — don't wait for «ذخیره».
              dirtyRef.current = false;
              onSave({
                useManualPrice: false,
                manualBuy: buy === "" ? null : Number(buy),
                manualSell: sell === "" ? null : Number(sell),
              });
              return;
            }
            dirtyRef.current = true;
          }}
        />
        قیمت دستی — با برداشتن تیک، قیمت فوراً از منبع (goldbridge) می‌آید
      </label>
      <div className="price-cards-admin__manual-inputs">
        <label>
          خرید (مثقال)
          <input
            type="number"
            inputMode="decimal"
            value={buy}
            disabled={busy || !useManual}
            onChange={(e) => {
              dirtyRef.current = true;
              setBuy(e.target.value);
            }}
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
            onChange={(e) => {
              dirtyRef.current = true;
              setSell(e.target.value);
            }}
            placeholder="مثلاً ۳۴۴۰۰۰۰۰"
          />
        </label>
      </div>
      <button
        type="button"
        className="price-cards-admin__save-btn"
        disabled={busy}
        onClick={() => {
          dirtyRef.current = false;
          onSave({
            useManualPrice: useManual,
            manualBuy: buy === "" ? null : Number(buy),
            manualSell: sell === "" ? null : Number(sell),
          });
        }}
      >
        ذخیره قیمت دستی
      </button>
      {card.use_manual_price || card.price_source === "manual" ? (
        <p className="price-cards-admin__manual-note">در حال نمایش قیمت دستی به مشتری</p>
      ) : (
        <p className="price-cards-admin__manual-note">در حال نمایش قیمت منبع (goldbridge)</p>
      )}
    </div>
  );
}

function draftFromRow(r) {
  const buy = r.commission_buy_value ?? r.commission_value ?? 0;
  const sell = r.commission_sell_value ?? r.commission_value ?? 0;
  return {
    commission_type: r.commission_type || "fixed",
    commission_value: String(r.commission_value ?? buy ?? 0),
    commission_buy_value: String(buy),
    commission_sell_value: String(sell),
    can_order: r.can_order !== false,
  };
}

function cardUsesSplitCommission(card) {
  if (card.goldbridge_item_id === SPECIAL_MOTAFEREGHE_ID) return false;
  if (card.goldbridge_item_id === SPECIAL_NAGHD_KARTKHAN_ID) return false;
  return card.buy != null && card.sell != null;
}

function RoleCommissionEditor({ card, busy, onSave }) {
  const rows = card.role_commissions || [];
  const [drafts, setDrafts] = useState({});
  const [savingRoleId, setSavingRoleId] = useState(null);
  const dirtyRolesRef = useRef(new Set());
  const manualMode = !!card.use_manual_price || card.price_source === "manual";
  const isSpecialMirror =
    card.goldbridge_item_id === SPECIAL_MOTAFEREGHE_ID
    || card.goldbridge_item_id === SPECIAL_NAGHD_KARTKHAN_ID;
  const splitCommission = cardUsesSplitCommission(card);

  function rowsToDrafts(sourceRows) {
    const next = {};
    for (const r of sourceRows) next[r.role_id] = draftFromRow(r);
    return next;
  }

  // Initial / card-switch hydrate only — never on live polls.
  useEffect(() => {
    dirtyRolesRef.current = new Set();
    setSavingRoleId(null);
    setDrafts(rowsToDrafts(rows));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.goldbridge_item_id]);

  // When parent refreshes card data after a successful save (or idle poll),
  // merge server values for roles the admin is NOT currently editing.
  useEffect(() => {
    setDrafts((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const r of rows) {
        if (dirtyRolesRef.current.has(r.role_id)) continue;
        if (savingRoleId === r.role_id) continue;
        const server = draftFromRow(r);
        const cur = next[r.role_id];
        if (
          !cur
          || cur.commission_type !== server.commission_type
          || cur.commission_value !== server.commission_value
          || cur.commission_buy_value !== server.commission_buy_value
          || cur.commission_sell_value !== server.commission_sell_value
          || cur.can_order !== server.can_order
        ) {
          next[r.role_id] = server;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [rows, savingRoleId]);

  if (!rows.length) {
    return <p className="price-cards-admin__hint">هنوز دسته‌بندی کاربری تعریف نشده.</p>;
  }

  return (
    <div className="price-cards-admin__commissions">
      <div className="price-cards-admin__commissions-title">کمیسیون و دسترسی هر دسته‌بندی برای این کارت</div>
      {isSpecialMirror ? (
        <p className="price-cards-admin__manual-note">
          {card.goldbridge_item_id === SPECIAL_MOTAFEREGHE_ID
            ? "متفرقه: کارمزد ثابت/درصدی به قیمت پایه id:1 اضافه می‌شود، سپس گرم ۱۸ با ÷ ۴٫۳۹ محاسبه می‌گردد."
            : "نقد کارتخوان: کارمزد دسته‌بندی به بخریدِ id:1 اضافه می‌شود، سپس ثابت ۱۰۰٬۰۰۰ تومان روی قیمت نهایی اعمال می‌شود."}
        </p>
      ) : splitCommission ? (
        <p className="price-cards-admin__hint">
          کارمزد خرید و فروش این کارت جداگانه تنظیم می‌شود. خرید به قیمت خرید اضافه و فروش از قیمت فروش کم می‌شود.
        </p>
      ) : (
        <p className="price-cards-admin__hint">
          کارمزد ثابت (تومان) همین‌جا روی قیمت مثقال این کارت اعمال می‌شود.
          افزودن خودکار ۱۰۰٬۰۰۰ تومان فقط مخصوص «نقد کارتخوان» است؛ فرمول ÷۴٫۳۹ فقط مخصوص «متفرقه».
        </p>
      )}
      {manualMode && (
        <p className="price-cards-admin__manual-note">
          حالت قیمت دستی فعال است — با سوییچ «مجاز به سفارش» مشخص کنید کدام دسته‌بندی می‌تواند با این قیمت سفارش بدهد.
        </p>
      )}
      {rows.map((r) => {
        const draft = drafts[r.role_id] || draftFromRow(r);
        const rowBusy = busy || savingRoleId === r.role_id;
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
                disabled={rowBusy}
                onChange={(e) => {
                  dirtyRolesRef.current.add(r.role_id);
                  setDrafts((prev) => ({
                    ...prev,
                    [r.role_id]: { ...draft, can_order: e.target.checked },
                  }));
                }}
              />
              مجاز به سفارش{manualMode ? " با قیمت دستی" : ""}
            </label>
            <div className={`price-cards-admin__commission-fields ${splitCommission ? "is-split" : ""}`}>
              <select
                value={draft.commission_type}
                disabled={rowBusy}
                onChange={(e) => {
                  dirtyRolesRef.current.add(r.role_id);
                  setDrafts((prev) => ({
                    ...prev,
                    [r.role_id]: { ...draft, commission_type: e.target.value },
                  }));
                }}
              >
                <option value="fixed">ثابت (تومان)</option>
                <option value="percentage">درصدی</option>
              </select>
              {splitCommission ? (
                <>
                  <label>
                    کمیسیون خرید
                    <FormattedNumberInput
                      value={draft.commission_buy_value}
                      disabled={rowBusy}
                      placeholder={draft.commission_type === "percentage" ? "مثلاً ۰٫۵" : "مثلاً ۱۰۰٬۰۰۰"}
                      onChange={(raw) => {
                        dirtyRolesRef.current.add(r.role_id);
                        setDrafts((prev) => ({
                          ...prev,
                          [r.role_id]: { ...draft, commission_buy_value: raw },
                        }));
                      }}
                    />
                  </label>
                  <label>
                    کمیسیون فروش
                    <FormattedNumberInput
                      value={draft.commission_sell_value}
                      disabled={rowBusy}
                      placeholder={draft.commission_type === "percentage" ? "مثلاً ۰٫۵" : "مثلاً ۱۰۰٬۰۰۰"}
                      onChange={(raw) => {
                        dirtyRolesRef.current.add(r.role_id);
                        setDrafts((prev) => ({
                          ...prev,
                          [r.role_id]: { ...draft, commission_sell_value: raw },
                        }));
                      }}
                    />
                  </label>
                </>
              ) : (
                <FormattedNumberInput
                  value={draft.commission_value}
                  disabled={rowBusy}
                  placeholder={draft.commission_type === "percentage" ? "مثلاً ۰٫۵" : "مثلاً ۱۰۰٬۰۰۰"}
                  onChange={(raw) => {
                    dirtyRolesRef.current.add(r.role_id);
                    setDrafts((prev) => ({
                      ...prev,
                      [r.role_id]: { ...draft, commission_value: raw },
                    }));
                  }}
                />
              )}
              <button
                type="button"
                className="price-cards-admin__save-btn"
                disabled={rowBusy}
                onClick={async () => {
                  const buyFee = parseFeeNumber(splitCommission ? draft.commission_buy_value : draft.commission_value);
                  const sellFee = parseFeeNumber(splitCommission ? draft.commission_sell_value : draft.commission_value);
                  if (!Number.isFinite(buyFee) || !Number.isFinite(sellFee)) {
                    alert("مقدار کارمزد نامعتبر است");
                    return;
                  }
                  dirtyRolesRef.current.add(r.role_id);
                  setSavingRoleId(r.role_id);
                  setDrafts((prev) => ({
                    ...prev,
                    [r.role_id]: {
                      ...draft,
                      commission_value: String(buyFee),
                      commission_buy_value: String(buyFee),
                      commission_sell_value: String(sellFee),
                    },
                  }));
                  try {
                    const updatedRows = await onSave({
                      roleId: r.role_id,
                      commissionType: draft.commission_type,
                      commissionValue: buyFee,
                      commissionBuyValue: buyFee,
                      commissionSellValue: sellFee,
                      canOrder: draft.can_order !== false,
                    });
                    const saved = (updatedRows || []).find((x) => x.role_id === r.role_id);
                    if (saved) {
                      setDrafts((prev) => ({
                        ...prev,
                        [r.role_id]: draftFromRow(saved),
                      }));
                    }
                    dirtyRolesRef.current.delete(r.role_id);
                  } catch (e) {
                    alert(e.message || "خطا در ذخیره کمیسیون");
                  } finally {
                    setSavingRoleId(null);
                  }
                }}
              >
                {savingRoleId === r.role_id ? "…" : "ذخیره"}
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
  const busyIdRef = useRef(null);
  const fetchGenRef = useRef(0);

  useEffect(() => {
    busyIdRef.current = busyId;
  }, [busyId]);

  function reload({ force = false } = {}) {
    // Skip background polls while a toggle/save is in flight so a stale GET
    // cannot re-check boxes the admin just saved.
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
        if (gen === fetchGenRef.current) {
          setError("دریافت قیمت‌ها با خطا مواجه شد.");
        }
      });
  }

  useEffect(() => {
    reload({ force: true });
    const interval = setInterval(() => reload(), 3000);
    return () => clearInterval(interval);
  }, []);

  async function toggleEnabled(card) {
    busyIdRef.current = card.goldbridge_item_id;
    setBusyId(card.goldbridge_item_id);
    try {
      const updated = await setPriceCardEnabled(card.goldbridge_item_id, !card.is_enabled);
      setCards(updated);
      fetchGenRef.current += 1; // invalidate in-flight polls
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
      setCards(updated);
      fetchGenRef.current += 1;
    } catch (e) {
      alert(e.message || "خطا در تغییر وضعیت سفارش‌پذیری");
    } finally {
      busyIdRef.current = null;
      setBusyId(null);
    }
  }

  async function toggleOverride(card) {
    busyIdRef.current = card.goldbridge_item_id;
    setBusyId(card.goldbridge_item_id);
    try {
      const updated = await setPriceCardOverride(card.goldbridge_item_id, !card.override_source_restriction);
      setCards(updated);
      fetchGenRef.current += 1;
    } catch (e) {
      alert(e.message || "خطا در تغییر وضعیت override");
    } finally {
      busyIdRef.current = null;
      setBusyId(null);
    }
  }

  async function saveManual(card, payload) {
    busyIdRef.current = card.goldbridge_item_id;
    setBusyId(card.goldbridge_item_id);
    const usingManual = !!payload.useManualPrice;
    const nextBuy = usingManual
      ? Number(payload.manualBuy)
      : Number(card.live_buy);
    const nextSell = usingManual
      ? Number(payload.manualSell)
      : Number(card.live_sell);
    setCards((prev) => {
      const patched = (prev || []).map((c) => {
        if (Number(c.goldbridge_item_id) !== Number(card.goldbridge_item_id)) return c;
        return {
          ...c,
          use_manual_price: usingManual,
          manual_buy: payload.manualBuy,
          manual_sell: payload.manualSell,
          buy: Number.isFinite(nextBuy) ? nextBuy : c.buy,
          sell: Number.isFinite(nextSell) ? nextSell : c.sell,
          price_source: usingManual ? "manual" : (card.live_buy != null ? "live" : "unavailable"),
        };
      });
      return syncMirroredCardQuotes(patched);
    });
    try {
      const updated = await setPriceCardManualPrice(card.goldbridge_item_id, payload);
      setCards(syncMirroredCardQuotes(updated));
      fetchGenRef.current += 1;
    } catch (e) {
      alert(e.message || "خطا در ذخیره قیمت دستی");
      reload({ force: true });
    } finally {
      busyIdRef.current = null;
      setBusyId(null);
    }
  }

  async function saveCommission(card, payload) {
    busyIdRef.current = card.goldbridge_item_id;
    setBusyId(card.goldbridge_item_id);
    try {
      const updated = await setPriceCardRoleCommission(card.goldbridge_item_id, payload);
      setCards(updated);
      fetchGenRef.current += 1;
      const savedCard = (updated || []).find((c) => c.goldbridge_item_id === card.goldbridge_item_id);
      return savedCard?.role_commissions || [];
    } catch (e) {
      // Re-throw so RoleCommissionEditor keeps the typed fee (does not
      // snap back to the role default, often ۱۰٬۰۰۰).
      throw e instanceof Error ? e : new Error(e?.message || "خطا در ذخیره کمیسیون");
    } finally {
      busyIdRef.current = null;
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
  const tradeTile = cards.find((c) => Number(c.goldbridge_item_id) === FARSHAD_TRADE_CASH_ITEM_ID) || cards.find((c) => c.is_farshad_trade_tile);
  const hedgeMargin = Number(tradeTile?.shop_margin_toman || cards.find((c) => c.shop_margin_toman > 0)?.shop_margin_toman || 0);

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

      {tradeTile && (
        <div className={`admin-prices__hedge ${tradeTile.stale ? "is-stale" : ""}`}>
          <strong>{tradeTile.display_name || tradeTile.name || "نقدی یکشنبه"}</strong>
          <span>id:{tradeTile.goldbridge_item_id}</span>
          <span>میان فرشاد: {fa(tradeTile.base_price)}</span>
          <span>کمیسیون فرشاد: {fa(tradeTile.farshad_commission)}</span>
          <span>حاشیه ما: {fa(hedgeMargin)}</span>
          <span>بخرید مشتری (خام): {fa(tradeTile.buy)}</span>
          <span>بفروشید مشتری (خام): {fa(tradeTile.sell)}</span>
          {tradeTile.stale && <span className="admin-prices__stale-badge">نقل‌قول کهنه</span>}
        </div>
      )}

      {!anyOrderable && (
        <p className="price-cards-admin__warning">
          در حال حاضر هیچ کارتی برای خرید یا فروش فعال نیست - مشتریان نمی‌توانند سفارش ثبت کنند.
        </p>
      )}

      <p className="price-cards-admin__hint">
        کاشی معامله فرشاد «نقدی یکشنبه» = id:1013 (نه id:1 «نقد یکشنبه» که مستر غیرفعال است).
        goldbridge دیگر ۱۰٬۰۰۰ تومان حاشیه فروشگاه را اضافه نمی‌کند؛ آن حاشیه روی قیمت زنده همین‌جا اعمال می‌شود، بعد کارمزد دسته‌بندی.
        «متفرقه» و «نقد کارتخوان» همچنان از بخریدِ خام id:1 (زنده یا دستی) می‌آیند — فرمول‌ها عوض نشده.
        کارمزد/اختلاف هر دسته‌بندی را روی همان کارت تنظیم کنید.
      </p>

      <div className="admin-prices__grid">
        {cards.map((c) => {
          const isMirrored = !!c.price_source_item_id || c.price_source === "mirrored";
          const status = quoteStatus(c);
          const sourceLabel =
            c.price_source === "manual"
              ? "دستی"
              : c.price_source === "mirrored" || isMirrored
                ? `آینه id:${c.price_source_item_id || 1}${c.mirrored_source_mode === "manual" ? " (دستی)" : ""}`
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
              <span className="admin-price-card__name">
                {c.display_name}
                {c.is_farshad_trade_tile || Number(c.goldbridge_item_id) === FARSHAD_TRADE_CASH_ITEM_ID
                  ? " · کاشی معامله فرشاد"
                  : Number(c.goldbridge_item_id) === SOURCE_MIRROR_ITEM_ID
                    ? " · مستر مخفی"
                    : ""}
              </span>
              <span className={`admin-price-card__quote-status is-${status.kind}`}>
                {status.label}
              </span>
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
            <div className="admin-price-card__type-row">
              <span className="admin-price-card__type">{TYPE_LABEL[c.type] || (isMirrored ? "طلا (گرم/عیار)" : "—")}</span>
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
                  {c.goldbridge_item_id === SPECIAL_MOTAFEREGHE_ID
                    ? "متفرقه: قیمت پایه = بخریدِ id:1 (زنده یا دستی) — گرم ۱۸ = (قیمت + کارمزد) ÷ ۴٫۳۹ برای بفروشید."
                    : c.goldbridge_item_id === SPECIAL_NAGHD_KARTKHAN_ID
                      ? "نقد کارتخوان: قیمت نهایی = (بخریدِ id:1 زنده یا دستی + کارمزد دسته‌بندی) + ۱۰۰٬۰۰۰ تومان."
                      : `قیمت این کارت همیشه از آیتم id:${c.price_source_item_id || 1} (زنده یا دستی) گرفته می‌شود.`}
                  {" "}
                  کارمزد/اختلاف هر دسته‌بندی را پایین تنظیم کنید.
                </p>
              )}

              <RoleCommissionEditor
                card={c}
                busy={busyId === c.goldbridge_item_id}
                onSave={(payload) => saveCommission(c, payload)}
              />
            </div>

            {!isMirrored && (c.base_price != null || c.farshad_commission != null || c.stale) && (
              <div className="admin-price-card__farshad">
                {c.stale && <span className="admin-prices__stale-badge">کهنه</span>}
                {c.base_price != null && <span>میان: {fa(c.base_price)}</span>}
                {c.farshad_commission != null && <span>سود فرشاد: {fa(c.farshad_commission)}</span>}
                {c.shop_margin_toman > 0 && c.price_source === "live" && (
                  <span>حاشیه ما: {fa(c.shop_margin_toman)}</span>
                )}
                {c.farshad_buy != null && c.price_source === "live" && (
                  <span>فرشاد بخرید/بفروشید: {fa(c.farshad_buy)} / {fa(c.farshad_sell)}</span>
                )}
              </div>
            )}

            <div className="admin-price-card__footer">
              <span>id: {c.goldbridge_item_id}{c.related_id != null ? ` → related ${c.related_id}` : ""}</span>
            </div>
          </div>
          );
        })}
      </div>
    </div>
  );
}
