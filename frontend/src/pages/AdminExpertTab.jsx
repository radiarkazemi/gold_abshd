import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchExpertDesk,
  fetchExpertTehranReport,
  fetchPrice,
  decideOrder,
  updateTehranDealer,
  syncTehranDealersFromTahesab,
  createExpertHedge,
  deleteExpertHedge,
} from "../api";
import { orderGoldWeight, orderTotalMoney } from "../utils/orderCalc";
import PendingCountdown from "../components/PendingCountdown";
import ExpertTehranLedger from "../components/ExpertTehranLedger";
import JalaliDateInput from "../components/JalaliDateInput";
import { formatTehranTime, tehranTodayKey, tehranYesterdayKey } from "../utils/tehranTime";
import "./AdminExpertTab.css";

function pickPrimaryGoldCard(cards) {
  const list = cards || [];
  return list.find((c) => c.type === 1 && c.is_primary) || list.find((c) => c.type === 1) || null;
}

const SIDE_LABEL = { buy: "خرید مشتری از ما", sell: "فروش مشتری به ما" };
const HEDGE_LABEL = {
  buy_from_dealer: "خرید از آبشده تهران",
  sell_to_dealer: "فروش به آبشده تهران",
};


function fa(n, opts) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return Number(n).toLocaleString("fa-IR", opts);
}

function formatTime(iso) {
  return formatTehranTime(iso);
}

/** Thin-line icons matching the reference desk mock. */
function Icon({ name, className = "" }) {
  const paths = {
    diamond: "M3 8l4-5h10l4 5-9 13L3 8zM3 8h18M7 3l5 18 5-18",
    arrow: "M12 4v16M6 14l6 6 6-6",
    shield: "M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3zM8 12l3 3 5-6",
    alert: "M12 3L2 21h20L12 3zM12 9v5M12 17v1",
    inbox: "M4 4h16l2 12v4H2v-4L4 4zM2 16h6l2 2h4l2-2h6",
    refresh: "M20 10a8 8 0 1 0-2 8M20 3v7h-7",
    transfer: "M3 7h18M17 3l4 4-4 4M21 17H3M7 13l-4 4 4 4",
    calendar: "M3 5h18v16H3V5zM3 10h18M7 3v4M17 3v4",
  };
  return (
    <svg className={`expert-icon ${className}`} viewBox="0 0 24 24" aria-hidden="true">
      <path d={paths[name] || paths.diamond} />
    </svg>
  );
}

function dealerInitial(name) {
  const t = String(name || "").trim();
  return t ? t[0] : "؟";
}

function DealerAssignInline({ order, dealers, busy, onAssign }) {
  const [dealerId, setDealerId] = useState("");
  const [weight, setWeight] = useState("");
  const [price, setPrice] = useState("");
  const [open, setOpen] = useState(false);
  const activeDealers = (dealers || []).filter(
    (d) => d.is_active && d.tahesab_moshtari_id != null
  );
  const remaining = Math.max(0, Number(order.open_hedge_weight ?? orderGoldWeight(order)));
  const label = order.side === "buy" ? "خرید از تهران" : "فروش به تهران";

  useEffect(() => {
    setWeight(remaining ? String(Number(remaining.toFixed(3))) : "");
  }, [order.id, remaining]);

  if (remaining <= 0) {
    return <span className="expert-pill expert-pill--done">پوشش کامل</span>;
  }

  return (
    <div className="expert-assign">
      {!open ? (
        <button
          type="button"
          className="expert-btn expert-btn--dealer"
          disabled={busy || !activeDealers.length}
          onClick={() => setOpen(true)}
        >
          {label}
        </button>
      ) : (
        <div className="expert-assign__row expert-assign__row--price">
          <select value={dealerId} onChange={(e) => setDealerId(e.target.value)}>
            <option value="">آبشده‌فروش…</option>
            {activeDealers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {d.tahesab_moshtari_id != null ? ` (#${d.tahesab_moshtari_id})` : ""}
              </option>
            ))}
          </select>
          <input
            type="number"
            step="0.001"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            placeholder="گرم"
          />
          <input
            type="number"
            step="1"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="فی مثقال تهران"
          />
          <button
            type="button"
            className="expert-btn expert-btn--ok"
            disabled={busy}
            onClick={async () => {
              if (!dealerId) {
                alert("آبشده‌فروش را انتخاب کنید");
                return;
              }
              if (!price || Number(price) <= 0) {
                alert("فی مثقال معامله با تهران را وارد کنید");
                return;
              }
              await onAssign({
                orderId: order.id,
                dealerId,
                weightGram18: weight === "" ? null : Number(weight),
                priceMesghal17: Number(price),
              });
              setOpen(false);
              setPrice("");
            }}
          >
            ثبت
          </button>
          <button type="button" className="expert-btn" onClick={() => setOpen(false)}>
            بستن
          </button>
        </div>
      )}
    </div>
  );
}

function CompactOrderCard({ order, dealers, busyId, onDecide, onExpire, onAssign }) {
  const openHedge = Math.max(0, Number(order.open_hedge_weight ?? orderGoldWeight(order)));
  const uncovered = openHedge > 1e-6;
  return (
    <article
      className={`expert-card expert-card--${order.side}${uncovered ? " expert-card--uncovered" : ""}`}
    >
      <header className="expert-card__head">
        <span className={`expert-card__badge expert-card__badge--${order.side}`}>
          {SIDE_LABEL[order.side]}
        </span>
        <div className="expert-card__meta">
          <PendingCountdown order={order} onExpire={onExpire} />
          <time>{formatTime(order.created_at)}</time>
        </div>
      </header>

      <div className="expert-card__grid">
        <div>
          <span className="expert-card__label">مشتری</span>
          <strong>
            {order.customer_name || "بدون نام"} #{order.customer_code}
          </strong>
        </div>
        <div>
          <span className="expert-card__label">وزن</span>
          <strong>{fa(orderGoldWeight(order), { maximumFractionDigits: 3 })} g</strong>
        </div>
        <div>
          <span className="expert-card__label">مبلغ</span>
          <strong>{fa(Math.round(orderTotalMoney(order)))}</strong>
        </div>
        <div>
          <span className="expert-card__label">فی مثقال</span>
          <strong>
            {order.mesghal17_price_at_submit
              ? fa(Math.round(order.mesghal17_price_at_submit))
              : "—"}
          </strong>
        </div>
      </div>

      {uncovered && (
        <p className="expert-card__hedged">
          بدون پوشش: {fa(openHedge, { maximumFractionDigits: 3 })} g
        </p>
      )}

      <div className="expert-card__actions">
        <button
          type="button"
          className="expert-btn expert-btn--ok"
          disabled={busyId === order.id}
          onClick={() => onDecide(order.id, "accepted")}
        >
          تایید
        </button>
        <button
          type="button"
          className="expert-btn expert-btn--no"
          disabled={busyId === order.id}
          onClick={() => onDecide(order.id, "rejected")}
        >
          رد
        </button>
        <button
          type="button"
          className="expert-btn expert-btn--price"
          disabled={busyId === order.id}
          onClick={() => onDecide(order.id, "rejected_price_change")}
        >
          رد مظنه
        </button>
        <DealerAssignInline
          order={order}
          dealers={dealers}
          busy={busyId === order.id}
          onAssign={onAssign}
        />
      </div>
    </article>
  );
}

export default function AdminExpertTab({ refreshSignal }) {
  const [desk, setDesk] = useState(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [liveCard, setLiveCard] = useState(null);
  const [dealerSyncBusy, setDealerSyncBusy] = useState(false);
  const [freeHedge, setFreeHedge] = useState({
    dealerId: "",
    side: "sell_to_dealer",
    weight: "",
    price: "",
    note: "",
  });
  const [reportDate, setReportDate] = useState(() => tehranYesterdayKey());
  const [report, setReport] = useState(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState("");
  const [reportTick, setReportTick] = useState(0);
  const freeHedgeRef = useRef(null);

  const reload = useCallback(() => {
    fetchExpertDesk()
      .then((data) => {
        setDesk(data);
        setError("");
      })
      .catch((e) => {
        console.error(e);
        setError(e.message === "ADMIN_SESSION_EXPIRED" ? e.message : "بارگذاری میز کارشناس ناموفق بود");
      });
  }, []);

  useEffect(() => {
    reload();
    const id = setInterval(reload, 4000);
    return () => clearInterval(id);
  }, [reload]);

  useEffect(() => {
    if (refreshSignal !== undefined) reload();
  }, [refreshSignal, reload]);

  useEffect(() => {
    function loadPrices() {
      fetchPrice()
        .then((payload) => setLiveCard(pickPrimaryGoldCard(payload.cards)))
        .catch(() => {});
    }
    loadPrices();
    const id = setInterval(loadPrices, 2000);
    return () => clearInterval(id);
  }, []);

  const handleExpire = useCallback(
    (orderId) => {
      setDesk((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          buy_orders: prev.buy_orders.filter((o) => o.id !== orderId),
          sell_orders: prev.sell_orders.filter((o) => o.id !== orderId),
        };
      });
      setTimeout(reload, 250);
    },
    [reload]
  );

  async function handleDecide(orderId, status) {
    setBusyId(orderId);
    try {
      await decideOrder(orderId, status);
      reload();
    } catch {
      alert("عملیات با خطا مواجه شد");
    } finally {
      setBusyId(null);
    }
  }

  async function handleAssign({ orderId, dealerId, weightGram18, priceMesghal17 }) {
    setBusyId(orderId);
    try {
      await createExpertHedge({
        dealerId,
        relatedOrderId: orderId,
        weightGram18,
        priceMesghal17,
      });
      reload();
      setReportTick((n) => n + 1);
    } catch (e) {
      alert(e.message || "تخصیص ناموفق بود");
    } finally {
      setBusyId(null);
    }
  }

  async function handleSyncDealersFromTahesab() {
    setDealerSyncBusy(true);
    try {
      const result = await syncTehranDealersFromTahesab();
      reload();
      const n = result?.total ?? (result?.dealers || []).length;
      const group = result?.group || desk?.abshode_sellers_group || "آبشده فروشان";
      if (!result?.ok && result?.reason === "tahesab_disabled") {
        alert("ته‌حساب فعال نیست — لیست از کش محلی خوانده می‌شود");
      } else if (result?.pending_refresh || result?.reason === "queued" || result?.reason === "already_queued") {
        alert(
          `درخواست لیست «${group}» به ته‌حساب صف شد. چند ثانیه صبر کنید و دوباره «بروزرسانی از ته‌حساب» را بزنید (ایجنت ویندوز باید آنلاین باشد).`
        );
        // Soft-poll desk so linked codes appear when the agent acks.
        setTimeout(reload, 4000);
        setTimeout(reload, 10000);
      } else if (result?.ok) {
        alert(
          `لیست «${group}» از ته‌حساب به‌روز شد` +
            (n != null ? ` (${fa(n)} نفر)` : "") +
            (result?.created ? ` · جدید: ${fa(result.created)}` : "")
        );
      } else {
        alert(
          `بروزرسانی «${group}» کامل نشد` +
            (result?.reason ? ` (${result.reason})` : "") +
            " — دوباره تلاش کنید"
        );
      }
    } catch (err) {
      alert(err.message || "بروزرسانی از ته‌حساب ناموفق بود");
    } finally {
      setDealerSyncBusy(false);
    }
  }

  async function toggleDealer(dealer) {
    try {
      await updateTehranDealer(dealer.id, { isActive: !dealer.is_active });
      reload();
    } catch (err) {
      alert(err.message || "خطا");
    }
  }

  async function submitFreeHedge(e) {
    e.preventDefault();
    if (!freeHedge.dealerId || !freeHedge.weight) {
      alert("آبشده‌فروش و وزن لازم است");
      return;
    }
    if (!freeHedge.price || Number(freeHedge.price) <= 0) {
      alert("فی مثقال معامله با تهران را وارد کنید");
      return;
    }
    try {
      await createExpertHedge({
        dealerId: freeHedge.dealerId,
        side: freeHedge.side,
        weightGram18: Number(freeHedge.weight),
        priceMesghal17: Number(freeHedge.price),
        note: freeHedge.note,
      });
      setFreeHedge((f) => ({ ...f, weight: "", price: "", note: "" }));
      reload();
      setReportTick((n) => n + 1);
    } catch (err) {
      alert(err.message || "ثبت معامله ناموفق بود");
    }
  }

  async function removeHedge(id) {
    if (!confirm("این تخصیص از گزارش و از سند ته‌حساب آبشده‌فروش حذف شود؟")) return;
    try {
      await deleteExpertHedge(id);
      reload();
      setReportTick((n) => n + 1);
    } catch (err) {
      alert(err?.message || "حذف ناموفق بود — سند ممکن است هنوز در ته‌حساب باشد");
    }
  }

  const totals = desk?.totals;
  const netDirLabel = useMemo(() => {
    if (!totals) return "";
    const left = fa(Math.abs(totals.net_weight), { maximumFractionDigits: 3 });
    if (totals.net_direction === "sell_to_tehran") {
      return `${left} گرم مانده — فروش به آبشده تهران`;
    }
    if (totals.net_direction === "buy_from_tehran") {
      return `${left} گرم کسری — خرید از آبشده تهران`;
    }
    return "بالانس برقرار است";
  }, [totals]);

  const suggestedCover = useMemo(() => {
    if (!totals) return null;
    const fromApi = totals.suggested_cover;
    if (fromApi && Number(fromApi.weight_gram18) > 1e-6) return fromApi;
    if (totals.net_direction === "balanced") return null;
    const abs = Math.abs(Number(totals.net_weight) || 0);
    if (abs <= 1e-6) return null;
    if (totals.net_direction === "sell_to_tehran") {
      return { side: "sell_to_dealer", weight_gram18: abs, net_direction: "sell_to_tehran" };
    }
    if (totals.net_direction === "buy_from_tehran") {
      return { side: "buy_from_dealer", weight_gram18: abs, net_direction: "buy_from_tehran" };
    }
    return null;
  }, [totals]);

  const todayKey = tehranTodayKey();
  const todayAccepted = useMemo(() => {
    if (!desk) return [];
    return [...(desk.accepted_buy_orders || []), ...(desk.accepted_sell_orders || [])];
  }, [desk]);

  useEffect(() => {
    let cancelled = false;
    if (!reportDate) return undefined;
    setReportBusy(true);
    setReportError("");
    fetchExpertTehranReport(reportDate)
      .then((data) => {
        if (!cancelled) setReport(data);
      })
      .catch((e) => {
        if (cancelled) return;
        console.error(e);
        setReport(null);
        setReportError(e.message === "ADMIN_SESSION_EXPIRED" ? e.message : "بارگذاری گزارش ناموفق بود");
      })
      .finally(() => {
        if (!cancelled) setReportBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reportDate, reportTick, refreshSignal]);

  const uncovered = useMemo(() => {
    if (!desk) return null;
    const fromApi = totals?.uncovered_pending;
    if (fromApi) return fromApi;
    const buyOrders = desk.buy_orders || [];
    const sellOrders = desk.sell_orders || [];
    const ub = buyOrders.filter((o) => Number(o.open_hedge_weight ?? 0) > 1e-6);
    const us = sellOrders.filter((o) => Number(o.open_hedge_weight ?? 0) > 1e-6);
    return {
      buy_weight: ub.reduce((s, o) => s + Number(o.open_hedge_weight || 0), 0),
      sell_weight: us.reduce((s, o) => s + Number(o.open_hedge_weight || 0), 0),
      buy_count: ub.length,
      sell_count: us.length,
    };
  }, [desk, totals]);

  const showUncoveredAlert = Boolean(
    uncovered &&
      (uncovered.buy_count > 0 ||
        uncovered.sell_count > 0 ||
        (suggestedCover && suggestedCover.weight_gram18 > 1e-6))
  );

  function applySuggestedCover() {
    if (!suggestedCover) return;
    const dealers = (desk?.dealers || []).filter((d) => d.is_active);
    setFreeHedge((f) => ({
      ...f,
      side: suggestedCover.side,
      weight: String(Number(suggestedCover.weight_gram18.toFixed(3))),
      dealerId: f.dealerId || dealers[0]?.id || "",
      note: f.note || "پوشش مانده میز",
    }));
    requestAnimationFrame(() => {
      freeHedgeRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  if (error && !desk) {
    return <p className="myorders__empty">{error}</p>;
  }
  if (!desk) {
    return <p className="myorders__empty">در حال بارگذاری میز کارشناس…</p>;
  }

  const buy = desk.buy_orders || [];
  const sell = desk.sell_orders || [];
  const dealers = desk.dealers || [];
  const activeDealers = dealers.filter((d) => d.is_active && d.tahesab_moshtari_id != null);
  const coverSideLabel =
    suggestedCover?.side === "buy_from_dealer" ? "خرید از آبشده تهران" : "فروش به آبشده تهران";

  const groupName = desk.abshode_sellers_group || "آبشده فروشان";
  const balanceOk = totals.net_direction === "balanced" || Math.abs(Number(totals.net_weight) || 0) < 1e-6;

  return (
    <div className="expert">
      <header className="expert-page-intro">
        <div>
          <span className="expert-overline">میز کارشناس</span>
          <h1 className="expert-page-title">مدیریت معاملات امروز</h1>
          <p className="expert-page-sub">سفارش‌های در انتظار، پوشش تهران و گزارش‌ها</p>
        </div>
      </header>

      <section className="expert-market" aria-label="فی لحظه‌ای">
        <div className="expert-market__info">
          <div className="expert-market__icon">
            <Icon name="diamond" />
          </div>
          <div>
            <h2>فی لحظه‌ای</h2>
            <p>{liveCard?.name || "آبشده"} · مثقال ۱۷</p>
          </div>
        </div>
        <div className="expert-quotes">
          <div className="expert-quote expert-quote--buy">
            <span>خرید</span>
            <strong>
              {liveCard?.buy_price != null ? fa(Math.round(liveCard.buy_price)) : "—"}{" "}
              <small>تومان</small>
            </strong>
          </div>
          <div className="expert-quote expert-quote--sell">
            <span>فروش</span>
            <strong>
              {liveCard?.sell_price != null ? fa(Math.round(liveCard.sell_price)) : "—"}{" "}
              <small>تومان</small>
            </strong>
          </div>
        </div>
      </section>

      <section className="expert-stats" aria-label="جمع میز">
        <article className="expert-stat expert-stat--buy">
          <div className="expert-stat__label">
            خرید مشتری از ما <Icon name="arrow" />
          </div>
          <div className="expert-stat__value">
            {fa(totals.buy.weight, { maximumFractionDigits: 3 })} <span>گرم ۱۸</span>
          </div>
          <small>
            <b>{fa(totals.buy.count)}</b> سفارش در انتظار
          </small>
        </article>
        <article className="expert-stat expert-stat--sell">
          <div className="expert-stat__label">
            فروش مشتری به ما <Icon name="arrow" className="expert-icon--flip" />
          </div>
          <div className="expert-stat__value">
            {fa(totals.sell.weight, { maximumFractionDigits: 3 })} <span>گرم ۱۸</span>
          </div>
          <small>
            <b>{fa(totals.sell.count)}</b> سفارش در انتظار
          </small>
        </article>
        <article className={`expert-stat expert-stat--balance expert-stat--${totals.net_direction}`}>
          <div className="expert-stat__label">
            مانده برای تهران <Icon name="shield" />
          </div>
          <div className="expert-stat__value">
            {fa(Math.abs(totals.net_weight), { maximumFractionDigits: 3 })} <span>گرم ۱۸</span>
          </div>
          <small>
            {balanceOk ? (
              <>
                <i className="expert-status-dot" />
                بالانس برقرار است
              </>
            ) : (
              netDirLabel
            )}
            {totals.matched_weight > 0 && (
              <> · تهاتر داخلی {fa(totals.matched_weight, { maximumFractionDigits: 3 })} g</>
            )}
          </small>
          {suggestedCover && (
            <button type="button" className="expert-btn expert-btn--cover" onClick={applySuggestedCover}>
              پوشش مانده · {fa(suggestedCover.weight_gram18, { maximumFractionDigits: 3 })} g
            </button>
          )}
        </article>
      </section>

      <div className="expert-explanation">
        <Icon name="alert" />
        <p>
          کارت خرید/فروش فقط <b>در انتظار</b> را نشان می‌دهد. مانده، تمام خرید و فروش تأییدشده امروز را
          هم تهاتر می‌کند. پس از پوشش تهران، مانده صفر می‌شود.
        </p>
        <details>
          <summary>توضیح بیشتر</summary>
          <p>مانده روزهای قبل در «گزارش روزهای قبل» است و به امروز منتقل نمی‌شود.</p>
        </details>
      </div>

      {showUncoveredAlert && (
        <div className="expert-alert" role="status">
          <strong>هشدار پوشش</strong>
          <p>
            {(uncovered.buy_count > 0 || uncovered.sell_count > 0) && (
              <>
                سفارش‌های در انتظار بدون پوشش کامل:
                {uncovered.buy_count > 0 && (
                  <>
                    {" "}
                    خرید {fa(uncovered.buy_count)} سفارش (
                    {fa(uncovered.buy_weight, { maximumFractionDigits: 3 })} g)
                  </>
                )}
                {uncovered.buy_count > 0 && uncovered.sell_count > 0 && " · "}
                {uncovered.sell_count > 0 && (
                  <>
                    فروش {fa(uncovered.sell_count)} سفارش (
                    {fa(uncovered.sell_weight, { maximumFractionDigits: 3 })} g)
                  </>
                )}
                .{" "}
              </>
            )}
            {suggestedCover ? (
              <>
                مانده خالص برای تهران: {fa(suggestedCover.weight_gram18, { maximumFractionDigits: 3 })}{" "}
                گرم ۱۸ — {coverSideLabel}.
              </>
            ) : (
              <>مانده خالص بالانس است؛ پوشش سفارش‌های باز را کامل کنید.</>
            )}
          </p>
          {suggestedCover && (
            <button type="button" className="expert-btn expert-btn--cover" onClick={applySuggestedCover}>
              پر کردن فرم پوشش مانده
            </button>
          )}
        </div>
      )}

      <section className="expert-queues" aria-label="سفارش‌های در انتظار">
        <section className="expert-panel expert-queue expert-queue--buy">
          <div className="expert-panel__heading">
            <h2>
              <span className="expert-color-dot" />
              در انتظار — خرید مشتری از ما
            </h2>
            <span className="expert-counter">{fa(buy.length)}</span>
          </div>
          <div className="expert-queue__body">
            {buy.length === 0 ? (
              <div className="expert-empty">
                <div className="expert-empty__icon">
                  <Icon name="inbox" />
                </div>
                <strong>سفارش بازی نیست</strong>
              </div>
            ) : (
              buy.map((o) => (
                <CompactOrderCard
                  key={o.id}
                  order={o}
                  dealers={dealers}
                  busyId={busyId}
                  onDecide={handleDecide}
                  onExpire={handleExpire}
                  onAssign={handleAssign}
                />
              ))
            )}
          </div>
        </section>

        <section className="expert-panel expert-queue expert-queue--sell">
          <div className="expert-panel__heading">
            <h2>
              <span className="expert-color-dot" />
              در انتظار — فروش مشتری به ما
            </h2>
            <span className="expert-counter">{fa(sell.length)}</span>
          </div>
          <div className="expert-queue__body">
            {sell.length === 0 ? (
              <div className="expert-empty">
                <div className="expert-empty__icon">
                  <Icon name="inbox" />
                </div>
                <strong>سفارش بازی نیست</strong>
              </div>
            ) : (
              sell.map((o) => (
                <CompactOrderCard
                  key={o.id}
                  order={o}
                  dealers={dealers}
                  busyId={busyId}
                  onDecide={handleDecide}
                  onExpire={handleExpire}
                  onAssign={handleAssign}
                />
              ))
            )}
          </div>
        </section>
      </section>

      <section className="expert-tehran" id="tehran">
        <div className="expert-section-heading">
          <div>
            <h2>آبشده‌فروش‌های تهران</h2>
            <p>فقط از گروه ته‌حساب «{groupName}»؛ افزودن دستی حذف شده.</p>
          </div>
          <button
            type="button"
            className="expert-btn expert-btn--subdued"
            disabled={dealerSyncBusy}
            onClick={handleSyncDealersFromTahesab}
          >
            <Icon name="refresh" />
            {dealerSyncBusy ? "در حال دریافت…" : "به‌روزرسانی از ته‌حساب"}
          </button>
        </div>

        <div className="expert-suppliers">
          {dealers.length === 0 ? (
            <div className="expert-empty expert-empty--inline">
              <strong>
                هنوز آبشده‌فروشی نیست — گروه «{groupName}» را در ته‌حساب بسازید و بروزرسانی کنید
              </strong>
            </div>
          ) : (
            dealers.map((d) => (
              <div key={d.id} className={`expert-supplier ${d.is_active ? "" : "is-off"}`}>
                <div className="expert-avatar">{dealerInitial(d.name)}</div>
                <div className="expert-supplier__info">
                  <strong>{d.name}</strong>
                  {d.tahesab_moshtari_id != null && (
                    <span>کد ته‌حساب: {fa(d.tahesab_moshtari_id)}</span>
                  )}
                  <small>{d.notes || `گروه ${groupName}`}</small>
                </div>
                <button
                  type="button"
                  className={`expert-status-pill ${d.is_active ? "is-on" : "is-off"}`}
                  onClick={() => toggleDealer(d)}
                >
                  <i />
                  {d.is_active ? "فعال" : "غیرفعال"}
                </button>
              </div>
            ))
          )}
        </div>

        <section className="expert-panel expert-coverage" id="coverage" ref={freeHedgeRef}>
          <div className="expert-panel__heading">
            <div>
              <h2>
                <Icon name="shield" />
                پوشش مانده با آبشده تهران <small>(بدون سفارش خاص)</small>
              </h2>
              <p>با ثبت پوشش، همان وزن روی کارت آبشده‌فروش در ته‌حساب هم سند می‌شود.</p>
            </div>
            {suggestedCover && (
              <button type="button" className="expert-btn expert-btn--cover" onClick={applySuggestedCover}>
                پیشنهاد: {coverSideLabel} · {fa(suggestedCover.weight_gram18, { maximumFractionDigits: 3 })} g
              </button>
            )}
          </div>
          <form className="expert-coverage-form" onSubmit={submitFreeHedge}>
            <label>
              آبشده‌فروش
              <select
                value={freeHedge.dealerId}
                onChange={(e) => setFreeHedge((f) => ({ ...f, dealerId: e.target.value }))}
                aria-label="آبشده‌فروش"
              >
                <option value="">آبشده‌فروش…</option>
                {activeDealers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                    {d.tahesab_moshtari_id != null ? ` (#${d.tahesab_moshtari_id})` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              نوع پوشش
              <select
                value={freeHedge.side}
                onChange={(e) => setFreeHedge((f) => ({ ...f, side: e.target.value }))}
                aria-label="نوع پوشش"
              >
                <option value="sell_to_dealer">فروش به آبشده تهران</option>
                <option value="buy_from_dealer">خرید از آبشده تهران</option>
              </select>
            </label>
            <label>
              وزن گرم ۱۸
              <div className="expert-input-unit">
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  placeholder="۰٫۰۰"
                  value={freeHedge.weight}
                  onChange={(e) => setFreeHedge((f) => ({ ...f, weight: e.target.value }))}
                  aria-label="وزن گرم ۱۸"
                />
                <span>گرم</span>
              </div>
            </label>
            <label>
              فی مثقال تهران
              <div className="expert-input-unit">
                <input
                  type="number"
                  step="1"
                  placeholder="فی مثقال تهران"
                  value={freeHedge.price}
                  onChange={(e) => setFreeHedge((f) => ({ ...f, price: e.target.value }))}
                  required
                  aria-label="فی مثقال تهران"
                />
                <span>تومان</span>
              </div>
            </label>
            <label className="expert-coverage-form__note">
              یادداشت
              <input
                type="text"
                placeholder="یادداشت"
                value={freeHedge.note}
                onChange={(e) => setFreeHedge((f) => ({ ...f, note: e.target.value }))}
                aria-label="یادداشت"
              />
            </label>
            <button type="submit" className="expert-btn expert-btn--coverage">
              ثبت پوشش <Icon name="transfer" />
            </button>
          </form>
        </section>
      </section>

      <section className="expert-panel expert-allocations">
        <div className="expert-panel__heading">
          <div>
            <h2>
              <Icon name="transfer" />
              تخصیص امروز به تهران
            </h2>
            <p>فقط رویدادهای امروز (تهران) — جدیدترین بالا. روزهای قبل را از گزارش پایین ببینید.</p>
          </div>
        </div>
        <div className="expert-allocations__body">
          <ExpertTehranLedger
            hedges={desk.hedges || []}
            acceptedOrders={todayAccepted}
            dayKey={todayKey}
            emptyText="امروز هنوز تخصیص یا تأیید مرتبطی ثبت نشده"
            onRemoveHedge={removeHedge}
          />
        </div>
      </section>

      <section className="expert-panel expert-history">
        <div className="expert-panel__heading">
          <div>
            <h2>
              <Icon name="calendar" />
              گزارش روزهای قبل
            </h2>
            <p>برای آرشیو و بررسی، یک روز را انتخاب کنید. این بخش میز زنده امروز را شلوغ نمی‌کند.</p>
          </div>
          <div className="expert-report-date">
            <JalaliDateInput label="تاریخ گزارش" value={reportDate} onChange={setReportDate} />
            {reportBusy && <span className="expert-report__status">در حال بارگذاری…</span>}
            {reportError && reportError !== "ADMIN_SESSION_EXPIRED" && (
              <span className="expert-report__status expert-report__status--err">{reportError}</span>
            )}
          </div>
        </div>
        <div className="expert-history__body">
          {!reportBusy && report && (
            <ExpertTehranLedger
              hedges={report.hedges || []}
              acceptedOrders={report.accepted_orders || []}
              dayKey={report.date}
              emptyText="برای این تاریخ ردیفی نیست"
              onRemoveHedge={async (id) => {
                await removeHedge(id);
              }}
            />
          )}
        </div>
      </section>
    </div>
  );
}
