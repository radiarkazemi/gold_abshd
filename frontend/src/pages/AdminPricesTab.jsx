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
import {
  MOTAFEREGHE_ITEM_ID,
  NAGHD_KARTKHAN_ITEM_ID,
  NAGHD_KARTKHAN_MARKUP_TOMAN,
  motaferagheToGram18,
  personalizePrice,
} from "../utils/priceCommission";
import {
  MAIN_CASH_ITEM_ID,
  UNPINNED_SORT_ORDER,
  isMainCashCard,
  isPinnedCard,
  nextPinSortOrder,
  sortPriceCards,
} from "../utils/priceCardIds";
import "./AdminPricesTab.css";

const SPECIAL_MOTAFEREGHE_ID = MOTAFEREGHE_ITEM_ID;
const SPECIAL_NAGHD_KARTKHAN_ID = NAGHD_KARTKHAN_ITEM_ID;
/** Fallback only when a special card has no price_source_item_id set. */
const SOURCE_MIRROR_ITEM_ID = MAIN_CASH_ITEM_ID;

function fa(n, opts) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return Number(n).toLocaleString("fa-IR", opts);
}

function faMoney(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return Math.round(Number(n)).toLocaleString("fa-IR");
}

/** Visible quote origin for every admin card. */
function quoteStatus(card) {
  const isMirrored = !!card.price_source_item_id || card.price_source === "mirrored";
  const missing = card.price_source === "unavailable" || (card.buy == null && card.sell == null);
  const srcId = card.price_source_item_id || SOURCE_MIRROR_ITEM_ID;
  if (missing) {
    return { kind: "unavailable", label: "ناموجود" };
  }
  if (isMirrored) {
    if (card.mirrored_source_mode === "manual") {
      return { kind: "manual", label: `دستی (از id:${srcId})` };
    }
    return { kind: "source", label: "از منبع" };
  }
  if (card.use_manual_price || card.price_source === "manual") {
    return { kind: "manual", label: "دستی" };
  }
  return { kind: "source", label: "از منبع" };
}

/**
 * Keep متفرقه / نقد کارتخوان locked to their configured source card's BUY
 * (normally main daily نقدی = 900000), not hardcoded id:1.
 */
function syncMirroredCardQuotes(cards) {
  if (!Array.isArray(cards)) return cards;
  const byId = new Map(cards.map((c) => [Number(c.goldbridge_item_id), c]));
  return cards.map((c) => {
    const id = Number(c.goldbridge_item_id);
    if (id !== SPECIAL_MOTAFEREGHE_ID && id !== SPECIAL_NAGHD_KARTKHAN_ID) return c;
    const sourceId = Number(c.price_source_item_id) || SOURCE_MIRROR_ITEM_ID;
    const source = byId.get(sourceId);
    if (!source) return c;
    const buy = Number(source.buy);
    if (!(buy > 0)) return c;
    const mirroredMode =
      source.use_manual_price || source.price_source === "manual" ? "manual" : "live";
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

/** Prefer «خودمون» as the admin preview role; else first configured role. */
function previewRoleCommission(card) {
  const rows = card.role_commissions || [];
  if (!rows.length) return null;
  return rows.find((r) => r.role_name === "خودمون") || rows[0];
}

/**
 * Customer-facing quote the admin should see on the card face.
 * - Normal: source buy/sell with preview-role commission (+buy / −sell)
 * - متفرقه: (base + commission) / 4.39 as گرم۱۸ (sell-only)
 * - نقد کارتخوان: base + commission + 100٬۰۰۰ as مثقال۱۷ (buy-only)
 * Raw card.buy/card.sell stay the mirrored mesghal base for editors/API.
 */
function adminDisplayQuotes(card) {
  const id = Number(card.goldbridge_item_id);
  const baseBuy = card.buy;
  const baseSell = card.sell;
  const role = previewRoleCommission(card);
  const commissionType = role?.commission_type || "fixed";
  const commissionBuy = role?.commission_buy_value ?? role?.commission_value ?? 0;
  const commissionSell = role?.commission_sell_value ?? role?.commission_value ?? 0;
  const roleName = role?.role_name || null;

  if (id === SPECIAL_MOTAFEREGHE_ID) {
    const personalized = personalizePrice(
      {
        goldbridge_item_id: id,
        pricing_mode: "motaferaghe_sell",
        buy_price: baseBuy,
        sell_price: baseBuy,
        unit: "gram18",
      },
      commissionType,
      commissionBuy,
      commissionSell
    );
    const gram18 = personalized?.gram18_sell_price ?? (baseBuy != null ? motaferagheToGram18(Number(baseBuy)) : null);
    return {
      sourceBuy: baseBuy,
      sourceSell: baseBuy,
      buy: null,
      sell: gram18,
      buyLabel: null,
      sellLabel: "فروش مشتری · گرم ۱۸",
      unitNote: roleName ? `با کارمزد «${roleName}» · پایه ÷ ۴٫۳۹` : "پایه کارت روزانه ÷ ۴٫۳۹",
      single: true,
    };
  }

  if (id === SPECIAL_NAGHD_KARTKHAN_ID) {
    const personalized = personalizePrice(
      {
        goldbridge_item_id: id,
        pricing_mode: "naghd_kartkhan_buy",
        buy_price: baseBuy,
        sell_price: baseBuy,
        unit: "gram18",
      },
      commissionType,
      commissionBuy,
      commissionSell
    );
    const mesghal =
      personalized?.buy_price
      ?? (baseBuy != null ? Number(baseBuy) + NAGHD_KARTKHAN_MARKUP_TOMAN : null);
    return {
      sourceBuy: baseBuy,
      sourceSell: baseBuy,
      buy: mesghal,
      sell: null,
      buyLabel: "خرید مشتری · مثقال ۱۷",
      sellLabel: null,
      unitNote: roleName
        ? `با کارمزد «${roleName}» · پایه + ${faMoney(NAGHD_KARTKHAN_MARKUP_TOMAN)}`
        : `پایه کارت روزانه + ${faMoney(NAGHD_KARTKHAN_MARKUP_TOMAN)}`,
      single: true,
    };
  }

  const isCoin = Number(card.type) === 2 || card.unit === "count";
  const personalized = personalizePrice(
    {
      goldbridge_item_id: id,
      buy_price: baseBuy,
      sell_price: baseSell,
      unit: isCoin ? "count" : "gram18",
    },
    commissionType,
    commissionBuy,
    commissionSell
  );
  return {
    sourceBuy: baseBuy,
    sourceSell: baseSell,
    buy: personalized?.buy_price ?? baseBuy,
    sell: personalized?.sell_price ?? baseSell,
    buyLabel: "خرید مشتری",
    sellLabel: "فروش مشتری",
    unitNote: roleName ? `با کارمزد «${roleName}»` : null,
    single: false,
  };
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
    const srcId = card.price_source_item_id || SOURCE_MIRROR_ITEM_ID;
    return `آینه id:${srcId}${card.mirrored_source_mode === "manual" ? " (دستی)" : ""}`;
  }
  if (card.price_source === "live") return "goldbridge";
  return "ناموجود";
}

function statusBadge(card) {
  const status = quoteStatus(card);
  if (card.override_source_restriction) return { label: "مجوز مدیریتی", warn: false };
  if (isBlocked(card) && !card.override_source_restriction) return { label: "محدودیت منبع", warn: true };
  if (status.kind === "manual") return { label: status.label, warn: false };
  if (status.kind === "unavailable") return { label: status.label, warn: true };
  return { label: status.label, warn: false };
}

function cardSubtitle(card) {
  const id = Number(card.goldbridge_item_id);
  if (id === SPECIAL_MOTAFEREGHE_ID) {
    return "طلا · گرم ۱۸  /  (پایه روزانه + کارمزد) ÷ ۴٫۳۹";
  }
  if (id === SPECIAL_NAGHD_KARTKHAN_ID) {
    return "طلا · مثقال ۱۷  /  پایه روزانه + کارمزد + ۱۰۰٬۰۰۰";
  }
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

function ManualPriceEditor({ card, busy, onSave }) {
  const [useManual, setUseManual] = useState(!!card.use_manual_price);
  const [buy, setBuy] = useState(card.manual_buy != null ? String(card.manual_buy) : "");
  const [sell, setSell] = useState(card.manual_sell != null ? String(card.manual_sell) : "");
  const dirtyRef = useRef(false);
  const prevBusyRef = useRef(busy);

  useEffect(() => {
    dirtyRef.current = false;
    setUseManual(!!card.use_manual_price);
    setBuy(card.manual_buy != null ? String(card.manual_buy) : "");
    setSell(card.manual_sell != null ? String(card.manual_sell) : "");
  }, [card.goldbridge_item_id]);

  useEffect(() => {
    const wasBusy = prevBusyRef.current;
    prevBusyRef.current = busy;
    if (!(wasBusy && !busy)) return;
    if (dirtyRef.current) return;
    setUseManual(!!card.use_manual_price);
    setBuy(card.manual_buy != null ? String(card.manual_buy) : "");
    setSell(card.manual_sell != null ? String(card.manual_sell) : "");
  }, [busy, card.use_manual_price, card.manual_buy, card.manual_sell]);

  useEffect(() => {
    if (dirtyRef.current) return;
    setUseManual(!!card.use_manual_price);
  }, [card.use_manual_price]);

  return (
    <div className="price-desk__panel">
      <div className="price-desk__line" style={{ marginTop: 0 }}>
        <h3 style={{ margin: 0 }}>قیمت دستی</h3>
        <Switch
          on={!!useManual}
          disabled={busy}
          label="قیمت دستی"
          onClick={() => {
            const next = !useManual;
            setUseManual(next);
            if (!next) {
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
      </div>
      <p className="price-desk__editor-note">
        قیمت دستی — با برداشتن تیک، قیمت فوراً از منبع (goldbridge) می‌آید
      </p>
      <div className="price-desk__two">
        <div className="price-desk__field">
          <label>خرید (مثقال)</label>
          <FormattedNumberInput
            value={buy}
            disabled={busy || !useManual}
            onChange={(raw) => {
              dirtyRef.current = true;
              setBuy(raw);
            }}
            placeholder="مثلاً ۳۴۵۰۰۰۰۰"
          />
        </div>
        <div className="price-desk__field">
          <label>فروش (مثقال)</label>
          <FormattedNumberInput
            value={sell}
            disabled={busy || !useManual}
            onChange={(raw) => {
              dirtyRef.current = true;
              setSell(raw);
            }}
            placeholder="مثلاً ۳۴۴۰۰۰۰۰"
          />
        </div>
      </div>
      <button
        type="button"
        className="price-desk__btn price-desk__btn--gold"
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
      <p className="price-desk__editor-note">
        {card.use_manual_price || card.price_source === "manual"
          ? "در حال نمایش قیمت دستی به مشتری"
          : "در حال نمایش قیمت منبع (goldbridge)"}
      </p>
    </div>
  );
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

  useEffect(() => {
    dirtyRolesRef.current = new Set();
    setSavingRoleId(null);
    setDrafts(rowsToDrafts(rows));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.goldbridge_item_id]);

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
    return <p className="price-desk__sub">هنوز دسته‌بندی کاربری تعریف نشده.</p>;
  }

  return (
    <div className="price-desk__panel">
      <h3>کمیسیون و دسترسی هر دسته‌بندی برای این کارت</h3>
      {isSpecialMirror ? (
        <p className="price-desk__editor-note">
          {card.goldbridge_item_id === SPECIAL_MOTAFEREGHE_ID
            ? `متفرقه: کارمزد ثابت/درصدی به قیمت پایه id:${card.price_source_item_id || SOURCE_MIRROR_ITEM_ID} اضافه می‌شود، سپس گرم ۱۸ با ÷ ۴٫۳۹ محاسبه می‌گردد.`
            : `نقد کارتخوان: کارمزد دسته‌بندی به بخریدِ id:${card.price_source_item_id || SOURCE_MIRROR_ITEM_ID} اضافه می‌شود، سپس ثابت ۱۰۰٬۰۰۰ تومان روی قیمت نهایی اعمال می‌شود.`}
        </p>
      ) : splitCommission ? (
        <p className="price-desk__editor-note">
          کارمزد خرید و فروش این کارت جداگانه تنظیم می‌شود. خرید به قیمت خرید اضافه و فروش از قیمت فروش کم می‌شود.
        </p>
      ) : (
        <p className="price-desk__editor-note">
          کارمزد ثابت (تومان) همین‌جا روی قیمت مثقال این کارت اعمال می‌شود.
          افزودن خودکار ۱۰۰٬۰۰۰ تومان فقط مخصوص «نقد کارتخوان» است؛ فرمول ÷۴٫۳۹ فقط مخصوص «متفرقه».
        </p>
      )}
      {manualMode && (
        <p className="price-desk__editor-note">
          حالت قیمت دستی فعال است — با سوییچ «مجاز به سفارش» مشخص کنید کدام دسته‌بندی می‌تواند با این قیمت سفارش بدهد.
        </p>
      )}
      {rows.map((r) => {
        const draft = drafts[r.role_id] || draftFromRow(r);
        const rowBusy = busy || savingRoleId === r.role_id;
        return (
          <div key={r.role_id} className="price-desk__group">
            <div className="price-desk__grouphead">
              <b>
                {r.role_name}{" "}
                <small>{r.is_override ? "سفارشی" : "پیش‌فرض نقش"}</small>
              </b>
              <span className="price-desk__swlabel">
                مجاز به سفارش{manualMode ? " با قیمت دستی" : ""}
                <Switch
                  on={draft.can_order !== false}
                  disabled={rowBusy}
                  label={`مجاز به سفارش ${r.role_name}`}
                  onClick={() => {
                    dirtyRolesRef.current.add(r.role_id);
                    setDrafts((prev) => ({
                      ...prev,
                      [r.role_id]: { ...draft, can_order: !(draft.can_order !== false) },
                    }));
                  }}
                />
              </span>
            </div>
            <div className={`price-desk__commission ${splitCommission ? "is-split" : "is-single"}`}>
              <div>
                <label>نوع کارمزد</label>
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
              </div>
              {splitCommission ? (
                <>
                  <div>
                    <label>کمیسیون خرید</label>
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
                  </div>
                  <div>
                    <label>کمیسیون فروش</label>
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
                  </div>
                </>
              ) : (
                <div>
                  <label>کارمزد</label>
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
                </div>
              )}
              <div className="price-desk__commission-save">
                <button
                  type="button"
                  className="price-desk__btn price-desk__btn--gold"
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
  const [filter, setFilter] = useState("all");
  const [view, setView] = useState("cards");
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState("");
  const [drawerCardId, setDrawerCardId] = useState(null);
  const [drawerTab, setDrawerTab] = useState("price");
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
    const matched = list.filter((c) => {
      const blocked = isBlocked(c) && !c.override_source_restriction;
      if (filter === "gold" && cardTypeKey(c) !== "gold") return false;
      if (filter === "coin" && cardTypeKey(c) !== "coin") return false;
      if (filter === "review" && !blocked) return false;
      if (filter === "visible" && !c.is_enabled) return false;
      if (!q) return true;
      const hay = `${c.display_name || ""} ${sourceLabel(c)} ${c.goldbridge_item_id}`;
      return hay.includes(q);
    });
    return sortPriceCards(matched);
  }, [cards, filter, search]);

  const mainCashCard = useMemo(
    () => (cards || []).find((c) => isMainCashCard(c)) || null,
    [cards]
  );

  const stats = useMemo(() => {
    const list = cards || [];
    return {
      total: list.length,
      visible: list.filter((c) => c.is_enabled).length,
      review: list.filter((c) => isBlocked(c) && !c.override_source_restriction).length,
      pinned: list.filter((c) => isPinnedCard(c)).length,
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

  async function togglePin(card) {
    if (isMainCashCard(card)) {
      showToast("کارت اصلی روز همیشه اول فهرست است");
      return;
    }
    busyIdRef.current = card.goldbridge_item_id;
    setBusyId(card.goldbridge_item_id);
    const pinned = isPinnedCard(card);
    const sortOrder = pinned ? UNPINNED_SORT_ORDER : nextPinSortOrder(cards || []);
    try {
      const updated = await setPriceCardEnabled(card.goldbridge_item_id, !!card.is_enabled, { sortOrder });
      setCards(syncMirroredCardQuotes(updated));
      fetchGenRef.current += 1;
      showToast(pinned ? "پین کارت برداشته شد" : "کارت پین شد");
    } catch (e) {
      alert(e.message || "خطا در پین کردن کارت");
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

  async function toggleOverride(card) {
    busyIdRef.current = card.goldbridge_item_id;
    setBusyId(card.goldbridge_item_id);
    try {
      const updated = await setPriceCardOverride(card.goldbridge_item_id, !card.override_source_restriction);
      setCards(syncMirroredCardQuotes(updated));
      fetchGenRef.current += 1;
      showToast("تنظیمات کارت ذخیره شد");
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
      showToast("قیمت دستی ذخیره شد");
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
      setCards(syncMirroredCardQuotes(updated));
      fetchGenRef.current += 1;
      const savedCard = (updated || []).find((c) => c.goldbridge_item_id === card.goldbridge_item_id);
      showToast("کمیسیون ذخیره شد");
      return savedCard?.role_commissions || [];
    } catch (e) {
      throw e instanceof Error ? e : new Error(e?.message || "خطا در ذخیره کمیسیون");
    } finally {
      busyIdRef.current = null;
      setBusyId(null);
    }
  }

  function openDrawer(card, tab) {
    setDrawerCardId(card.goldbridge_item_id);
    // Specials: jump to commission groups — their main admin job is fee tuning.
    if (tab) {
      setDrawerTab(tab);
    } else if (
      Number(card.goldbridge_item_id) === SPECIAL_MOTAFEREGHE_ID
      || Number(card.goldbridge_item_id) === SPECIAL_NAGHD_KARTKHAN_ID
    ) {
      setDrawerTab("groups");
    } else {
      setDrawerTab("price");
    }
  }

  function closeDrawer() {
    setDrawerCardId(null);
  }

  if (error && !cards) {
    return <p className="price-desk__error">{error}</p>;
  }
  if (!cards) {
    return <p className="price-desk__loading">در حال بارگذاری…</p>;
  }

  const reviewCount = stats.review;
  const anyOrderable = cards.some((c) => c.orderable_buy || c.orderable_sell);

  return (
    <div className="price-desk">
      <div className="price-desk__title">
        <div>
          <h1>مرکز قیمت</h1>
          <p>کارت اصلی روز اول فهرست است؛ پین و کمیسیون هر کارت از تنظیمات.</p>
        </div>
        <button
          type="button"
          className="price-desk__btn"
          onClick={() => {
            reload({ force: true });
            showToast("قیمت‌ها بازخوانی شدند");
          }}
        >
          ↻ بازخوانی
        </button>
      </div>

      {mainCashCard && (
        <div className="price-desk__mainstrip">
          <div className="price-desk__mainstrip-meta">
            <strong>{mainCashCard.display_name || "کارت اصلی روز"}</strong>
            <span>قیمت منبع آبشده · کارت اصلی (id:{MAIN_CASH_ITEM_ID})</span>
          </div>
          <div className="price-desk__mainstrip-prices">
            <div className="is-buy">
              <span>خرید منبع</span>
              <b>{faMoney(mainCashCard.buy)}</b>
            </div>
            <div className="is-sell">
              <span>فروش منبع</span>
              <b>{faMoney(mainCashCard.sell)}</b>
            </div>
          </div>
          <button
            type="button"
            className="price-desk__btn"
            onClick={() => openDrawer(mainCashCard, "price")}
          >
            تنظیم کارت اصلی
          </button>
        </div>
      )}

      <div className="price-desk__overview">
        <button type="button" className="price-desk__stat" onClick={() => setFilter("all")} aria-label="همه کارت‌های قیمت">
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
        <button type="button" className="price-desk__stat" onClick={() => setFilter("review")} aria-label="کارت‌های نیازمند بررسی">
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
            <button type="button" className={view === "cards" ? "is-active" : ""} onClick={() => setView("cards")}>
              ▦ کارت‌ها
            </button>
            <button type="button" className={view === "compact" ? "is-active" : ""} onClick={() => setView("compact")}>
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

      {!anyOrderable && (
        <div className="price-desk__notice">
          <div>
            <b>هیچ کارت سفارش‌پذیری فعال نیست</b>
            مشتریان نمی‌توانند سفارش ثبت کنند.
          </div>
        </div>
      )}

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
          const quotes = adminDisplayQuotes(c);
          const pinned = isPinnedCard(c);
          const isMain = isMainCashCard(c);
          const isSpecial =
            Number(c.goldbridge_item_id) === SPECIAL_MOTAFEREGHE_ID
            || Number(c.goldbridge_item_id) === SPECIAL_NAGHD_KARTKHAN_ID;
          return (
            <article
              key={c.goldbridge_item_id}
              className={`price-desk__card ${isMain ? "is-main" : ""} ${pinned ? "is-pinned" : ""}`}
            >
              <div className="price-desk__cardhead">
                <div>
                  <h2>
                    {c.display_name}
                    {isMain && <em className="price-desk__tag">اصلی روز</em>}
                    {pinned && <em className="price-desk__tag">پین</em>}
                  </h2>
                  <span className="price-desk__sub">{cardSubtitle(c)}</span>
                </div>
                <div className="price-desk__head-actions">
                  {!isMain && (
                    <button
                      type="button"
                      className={`price-desk__pin ${pinned ? "is-on" : ""}`}
                      disabled={busy}
                      aria-pressed={pinned}
                      aria-label={pinned ? `برداشتن پین ${c.display_name}` : `پین ${c.display_name}`}
                      onClick={() => togglePin(c)}
                    >
                      {pinned ? "برداشتن پین" : "پین"}
                    </button>
                  )}
                  <div className="price-desk__symbol">{cardTypeKey(c) === "gold" ? "◇" : "◉"}</div>
                </div>
              </div>

              <div className="price-desk__source">
                <span>
                  <span className="price-desk__dot" />
                  {sourceLabel(c)}
                </span>
                <span className={`price-desk__badge ${badge.warn ? "is-warn" : ""}`}>{badge.label}</span>
              </div>

              <div className="price-desk__pricelabel">قیمت منبع</div>
              <div className="price-desk__prices price-desk__prices--source">
                <div className="price-desk__price">
                  <span>خرید</span>
                  <b>{faMoney(quotes.sourceBuy)}</b>
                  <small>تومان</small>
                </div>
                <div className="price-desk__price price-desk__price--sell">
                  <span>فروش</span>
                  <b>{faMoney(quotes.sourceSell)}</b>
                  <small>تومان</small>
                </div>
              </div>

              {(quotes.buy != null || quotes.sell != null) && (
                <>
                  <div className="price-desk__pricelabel">قیمت مشتری</div>
                  <div className={`price-desk__customer ${quotes.single ? "is-single" : ""}`}>
                    {quotes.buy != null && (
                      <div>
                        <span>{quotes.buyLabel || "خرید مشتری"}</span>
                        <b>{faMoney(quotes.buy)}</b>
                      </div>
                    )}
                    {quotes.sell != null && (
                      <div>
                        <span>{quotes.sellLabel || "فروش مشتری"}</span>
                        <b>{faMoney(quotes.sell)}</b>
                      </div>
                    )}
                  </div>
                </>
              )}
              {quotes.unitNote && (
                <div className="price-desk__quote-note">{quotes.unitNote}</div>
              )}

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
                <div className="price-desk__cardbottom-actions">
                  {isSpecial && (
                    <button
                      type="button"
                      className="price-desk__edit"
                      onClick={() => openDrawer(c, "groups")}
                    >
                      کمیسیون
                    </button>
                  )}
                  <button type="button" className="price-desk__edit" onClick={() => openDrawer(c)}>
                    تنظیمات <span>←</span>
                  </button>
                </div>
              </div>

              {blocked && (c.orderable_buy || c.orderable_sell) && (
                <div className="price-desk__hint price-desk__hint--inline">
                  منبع خرید/فروش را محدود کرده؛ در تنظیمات «نادیده گرفتن محدودیت منبع» را روشن کنید.
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

      {drawerCard && (
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
              {(() => {
                const dq = adminDisplayQuotes(drawerCard);
                const srcId = drawerCard.price_source_item_id || SOURCE_MIRROR_ITEM_ID;
                return (
              <div className="price-desk__panel">
                <div className="price-desk__source price-desk__source--flush">
                  <span>منبع قیمت: {sourceLabel(drawerCard)}</span>
                  <span className={`price-desk__badge ${isBlocked(drawerCard) ? "is-warn" : ""}`}>
                    {isBlocked(drawerCard) ? "محدودیت منبع" : "منبع فعال"}
                  </span>
                </div>
                <div className="price-desk__pricelabel">قیمت منبع</div>
                <div className="price-desk__two">
                  <div>
                    <span className="price-desk__sub">خرید منبع</span>
                    <h3 className="price-desk__quote price-desk__quote--buy">{faMoney(dq.sourceBuy)}</h3>
                  </div>
                  <div>
                    <span className="price-desk__sub">فروش منبع</span>
                    <h3 className="price-desk__quote price-desk__quote--sell">{faMoney(dq.sourceSell)}</h3>
                  </div>
                </div>
                {(dq.buy != null || dq.sell != null) && (
                  <>
                    <div className="price-desk__pricelabel">قیمت مشتری</div>
                    <div className={`price-desk__two ${dq.single ? "is-single" : ""}`}>
                      {dq.buy != null && (
                        <div>
                          <span className="price-desk__sub">{dq.buyLabel || "خرید"}</span>
                          <h3 className="price-desk__quote price-desk__quote--buy">{faMoney(dq.buy)}</h3>
                        </div>
                      )}
                      {dq.sell != null && (
                        <div>
                          <span className="price-desk__sub">{dq.sellLabel || "فروش"}</span>
                          <h3 className="price-desk__quote price-desk__quote--sell">{faMoney(dq.sell)}</h3>
                        </div>
                      )}
                    </div>
                  </>
                )}
                {isMirroredCard(drawerCard) && (
                  <p className="price-desk__editor-note">
                    پایه از کارت اصلی id:{srcId}: {faMoney(drawerCard.buy)} تومان
                    {dq.unitNote ? ` · ${dq.unitNote}` : ""}
                  </p>
                )}
                {!isMirroredCard(drawerCard) && dq.unitNote && (
                  <p className="price-desk__editor-note">{dq.unitNote}</p>
                )}
              </div>
                );
              })()}

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
                    <div className="price-desk__line">
                      <span>نمایش به مشتری</span>
                      <Switch
                        on={!!drawerCard.is_enabled}
                        disabled={busyId === drawerCard.goldbridge_item_id}
                        label="نمایش به مشتری"
                        onClick={() => toggleEnabled(drawerCard)}
                      />
                    </div>
                    <div className="price-desk__line">
                      <span>فعال بودن خرید</span>
                      <Switch
                        on={!!drawerCard.orderable_buy}
                        disabled={busyId === drawerCard.goldbridge_item_id}
                        label="فعال بودن خرید"
                        onClick={() => toggleOrderable(drawerCard, "buy")}
                      />
                    </div>
                    <div className="price-desk__line">
                      <span>فعال بودن فروش</span>
                      <Switch
                        on={!!drawerCard.orderable_sell}
                        disabled={busyId === drawerCard.goldbridge_item_id}
                        label="فعال بودن فروش"
                        onClick={() => toggleOrderable(drawerCard, "sell")}
                      />
                    </div>
                    {!isMirroredCard(drawerCard) && (
                      <>
                        <div className="price-desk__line">
                          <span>نادیده گرفتن محدودیت منبع</span>
                          <Switch
                            on={!!drawerCard.override_source_restriction}
                            disabled={busyId === drawerCard.goldbridge_item_id}
                            label="نادیده گرفتن محدودیت منبع"
                            onClick={() => toggleOverride(drawerCard)}
                          />
                        </div>
                        {isBlocked(drawerCard) && (
                          <div className="price-desk__hint">
                            منبع، خرید و فروش این قیمت را غیرمجاز اعلام کرده است. با فعال‌سازی گزینه بالا، تصمیم نهایی با تنظیمات شما خواهد بود.
                          </div>
                        )}
                        {drawerCard.override_source_restriction && (
                          <div className="price-desk__hint">
                            فعال است: حتی اگر منبع این آیتم را غیرمجاز اعلام کند، تنظیمات بالای شما ملاک است.
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {!isMirroredCard(drawerCard) ? (
                    <ManualPriceEditor
                      card={drawerCard}
                      busy={busyId === drawerCard.goldbridge_item_id}
                      onSave={(payload) => saveManual(drawerCard, payload)}
                    />
                  ) : (
                    <div className="price-desk__hint">
                      {drawerCard.goldbridge_item_id === SPECIAL_MOTAFEREGHE_ID
                        ? `متفرقه: قیمت پایه = بخریدِ کارت روزانه id:${drawerCard.price_source_item_id || SOURCE_MIRROR_ITEM_ID} (زنده یا دستی) — گرم ۱۸ = (پایه + کارمزد) ÷ ۴٫۳۹ برای بفروشید.`
                        : drawerCard.goldbridge_item_id === SPECIAL_NAGHD_KARTKHAN_ID
                          ? `نقد کارتخوان: قیمت نهایی = (بخریدِ کارت روزانه id:${drawerCard.price_source_item_id || SOURCE_MIRROR_ITEM_ID} زنده یا دستی + کارمزد دسته‌بندی) + ۱۰۰٬۰۰۰ تومان.`
                          : `قیمت این کارت همیشه از آیتم id:${drawerCard.price_source_item_id || SOURCE_MIRROR_ITEM_ID} (زنده یا دستی) گرفته می‌شود.`}
                      {" "}
                      کارمزد/اختلاف هر دسته‌بندی را در تب کمیسیون تنظیم کنید.
                    </div>
                  )}
                </>
              ) : (
                <RoleCommissionEditor
                  card={drawerCard}
                  busy={busyId === drawerCard.goldbridge_item_id}
                  onSave={(payload) => saveCommission(drawerCard, payload)}
                />
              )}

              <p className="price-desk__card-id">Card ID: {drawerCard.goldbridge_item_id}</p>
            </div>

            <footer className="price-desk__drawerfoot">
              <span>هر تغییر بلافاصله ذخیره می‌شود</span>
              <button type="button" className="price-desk__btn price-desk__btn--gold" onClick={closeDrawer}>
                بستن
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
