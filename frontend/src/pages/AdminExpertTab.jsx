import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchExpertDesk,
  fetchExpertTehranReport,
  fetchPrice,
  decideOrder,
  createTehranDealer,
  updateTehranDealer,
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

function DealerAssignInline({ order, dealers, busy, onAssign }) {
  const [dealerId, setDealerId] = useState("");
  const [weight, setWeight] = useState("");
  const [price, setPrice] = useState("");
  const [open, setOpen] = useState(false);
  const activeDealers = (dealers || []).filter((d) => d.is_active);
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
  const [dealerForm, setDealerForm] = useState({ name: "", phone: "", notes: "" });
  const [dealerBusy, setDealerBusy] = useState(false);
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

  async function handleAddDealer(e) {
    e.preventDefault();
    if (!dealerForm.name.trim()) return;
    setDealerBusy(true);
    try {
      await createTehranDealer(dealerForm);
      setDealerForm({ name: "", phone: "", notes: "" });
      reload();
    } catch (err) {
      alert(err.message || "ثبت آبشده‌فروش ناموفق بود");
    } finally {
      setDealerBusy(false);
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
    if (!confirm("این تخصیص حذف شود؟")) return;
    try {
      await deleteExpertHedge(id);
      reload();
      setReportTick((n) => n + 1);
    } catch {
      alert("حذف ناموفق بود");
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
  const activeDealers = dealers.filter((d) => d.is_active);
  const coverSideLabel =
    suggestedCover?.side === "buy_from_dealer" ? "خرید از آبشده تهران" : "فروش به آبشده تهران";

  return (
    <div className="expert">
      <div className="expert__intro">
        <h3 className="dashboard__section-title">میز کارشناس</h3>
        <p className="expert__hint">
          کارت خرید/فروش فقط <b>در انتظار</b> را نشان می‌دهد. <b>مانده تهران</b> خرید و فروش
          تاییدشده را هم تهاتر می‌کند (مثلاً ۲۰ تایید + ۳۰ در انتظار ← ۱۰ مانده). بعد از پوشش تهران همه صفر می‌شود.
        </p>
      </div>

      <section className="expert-spot" aria-label="فی لحظه‌ای">
        <div className="expert-spot__title">
          <strong>فی لحظه‌ای</strong>
          <span>{liveCard?.name || "آبشده"} · مثقال ۱۷</span>
        </div>
        <div className="expert-spot__prices">
          <div className="expert-spot__cell expert-spot__cell--buy">
            <span>خرید</span>
            <strong>
              {liveCard?.buy_price != null ? fa(Math.round(liveCard.buy_price)) : "—"}
            </strong>
          </div>
          <div className="expert-spot__cell expert-spot__cell--sell">
            <span>فروش</span>
            <strong>
              {liveCard?.sell_price != null ? fa(Math.round(liveCard.sell_price)) : "—"}
            </strong>
          </div>
        </div>
      </section>

      <section className="expert-totals expert-totals--sticky" aria-label="جمع میز">
        <div className="expert-totals__cell expert-totals__cell--buy">
          <span className="expert-totals__label">خرید مشتری از ما</span>
          <strong className="expert-totals__value">
            {fa(totals.buy.weight, { maximumFractionDigits: 3 })} گرم۱۸
          </strong>
          <span className="expert-totals__sub">
            {fa(totals.buy.count)} سفارش در انتظار
          </span>
        </div>
        <div className="expert-totals__cell expert-totals__cell--sell">
          <span className="expert-totals__label">فروش مشتری به ما</span>
          <strong className="expert-totals__value">
            {fa(totals.sell.weight, { maximumFractionDigits: 3 })} گرم۱۸
          </strong>
          <span className="expert-totals__sub">
            {fa(totals.sell.count)} سفارش در انتظار
          </span>
        </div>
        <div className={`expert-totals__balance expert-totals__balance--${totals.net_direction}`}>
          <span className="expert-totals__label">مانده برای تهران</span>
          <strong className="expert-totals__value">
            {fa(Math.abs(totals.net_weight), { maximumFractionDigits: 3 })} گرم۱۸
          </strong>
          <span className="expert-totals__sub">
            {netDirLabel}
            {totals.matched_weight > 0 && (
              <> · تهاتر داخلی {fa(totals.matched_weight, { maximumFractionDigits: 3 })} g</>
            )}
          </span>
          {suggestedCover && (
            <button type="button" className="expert-btn expert-btn--cover" onClick={applySuggestedCover}>
              پوشش مانده · {fa(suggestedCover.weight_gram18, { maximumFractionDigits: 3 })} g
            </button>
          )}
        </div>
      </section>

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
                    خرید {fa(uncovered.buy_count)} سفارش ({fa(uncovered.buy_weight, { maximumFractionDigits: 3 })} g)
                  </>
                )}
                {uncovered.buy_count > 0 && uncovered.sell_count > 0 && " · "}
                {uncovered.sell_count > 0 && (
                  <>
                    فروش {fa(uncovered.sell_count)} سفارش ({fa(uncovered.sell_weight, { maximumFractionDigits: 3 })} g)
                  </>
                )}
                .{" "}
              </>
            )}
            {suggestedCover ? (
              <>
                مانده خالص برای تهران: {fa(suggestedCover.weight_gram18, { maximumFractionDigits: 3 })} گرم۱۸ —{" "}
                {coverSideLabel}.
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

      <section className="expert-board" aria-label="سفارش‌های در انتظار">
        <div className="expert-col expert-col--buy">
          <header className="expert-col__head">
            <h4>در انتظار — خرید مشتری از ما</h4>
            <span>{fa(buy.length)}</span>
          </header>
          <div className="expert-col__list">
            {buy.length === 0 ? (
              <p className="expert-col__empty">سفارش بازی نیست</p>
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
        </div>

        <div className="expert-col expert-col--sell">
          <header className="expert-col__head">
            <h4>در انتظار — فروش مشتری به ما</h4>
            <span>{fa(sell.length)}</span>
          </header>
          <div className="expert-col__list">
            {sell.length === 0 ? (
              <p className="expert-col__empty">سفارش بازی نیست</p>
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
        </div>
      </section>

      <section className="expert-dealers">
        <h3 className="dashboard__section-title">آبشده‌فروش‌های تهران</h3>
        <form className="expert-dealers__form" onSubmit={handleAddDealer}>
          <input
            placeholder="نام (مثلاً فرشاد گلد)"
            value={dealerForm.name}
            onChange={(e) => setDealerForm((f) => ({ ...f, name: e.target.value }))}
            required
          />
          <input
            placeholder="تلفن"
            value={dealerForm.phone}
            onChange={(e) => setDealerForm((f) => ({ ...f, phone: e.target.value }))}
          />
          <input
            placeholder="یادداشت"
            value={dealerForm.notes}
            onChange={(e) => setDealerForm((f) => ({ ...f, notes: e.target.value }))}
          />
          <button type="submit" className="expert-btn expert-btn--ok" disabled={dealerBusy}>
            افزودن
          </button>
        </form>

        <div className="expert-dealers__list">
          {dealers.length === 0 ? (
            <p className="expert-col__empty">هنوز آبشده‌فروشی ثبت نشده</p>
          ) : (
            dealers.map((d) => (
              <div key={d.id} className={`expert-dealer ${d.is_active ? "" : "is-off"}`}>
                <div>
                  <strong>{d.name}</strong>
                  {d.phone && <span className="expert-dealer__phone">{d.phone}</span>}
                  {d.notes && <span className="expert-dealer__notes">{d.notes}</span>}
                </div>
                <button type="button" className="expert-btn" onClick={() => toggleDealer(d)}>
                  {d.is_active ? "غیرفعال" : "فعال"}
                </button>
              </div>
            ))
          )}
        </div>

        <form ref={freeHedgeRef} className="expert-free-hedge" onSubmit={submitFreeHedge}>
          <div className="expert-free-hedge__head">
            <h4>پوشش مانده با آبشده تهران (بدون سفارش خاص)</h4>
            {suggestedCover && (
              <button type="button" className="expert-btn expert-btn--cover" onClick={applySuggestedCover}>
                پیشنهاد: {coverSideLabel} · {fa(suggestedCover.weight_gram18, { maximumFractionDigits: 3 })} g
              </button>
            )}
          </div>
          <div className="expert-free-hedge__row">
            <select
              value={freeHedge.dealerId}
              onChange={(e) => setFreeHedge((f) => ({ ...f, dealerId: e.target.value }))}
            >
              <option value="">آبشده‌فروش…</option>
              {activeDealers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <select
              value={freeHedge.side}
              onChange={(e) => setFreeHedge((f) => ({ ...f, side: e.target.value }))}
            >
              <option value="sell_to_dealer">فروش به آبشده تهران</option>
              <option value="buy_from_dealer">خرید از آبشده تهران</option>
            </select>
            <input
              type="number"
              step="0.001"
              placeholder="وزن گرم۱۸"
              value={freeHedge.weight}
              onChange={(e) => setFreeHedge((f) => ({ ...f, weight: e.target.value }))}
            />
            <input
              type="number"
              step="1"
              placeholder="فی مثقال تهران"
              value={freeHedge.price}
              onChange={(e) => setFreeHedge((f) => ({ ...f, price: e.target.value }))}
              required
            />
            <input
              placeholder="یادداشت"
              value={freeHedge.note}
              onChange={(e) => setFreeHedge((f) => ({ ...f, note: e.target.value }))}
            />
            <button type="submit" className="expert-btn expert-btn--dealer">
              ثبت پوشش
            </button>
          </div>
        </form>
      </section>
      <section className="expert-hedges">
        <h3 className="dashboard__section-title">تخصیص امروز به تهران</h3>
        <p className="expert__hint">
          فقط رویدادهای <b>امروز (تهران)</b> — جدیدترین بالا. روزهای قبل را از گزارش پایین ببینید.
        </p>
        <ExpertTehranLedger
          hedges={desk.hedges || []}
          acceptedOrders={todayAccepted}
          dayKey={todayKey}
          emptyText="امروز هنوز تخصیص یا تایید مرتبطی ثبت نشده"
          onRemoveHedge={removeHedge}
        />
      </section>

      <section className="expert-report">
        <h3 className="dashboard__section-title">گزارش روزهای قبل</h3>
        <p className="expert__hint">
          برای آرشیو و بررسی، یک روز را انتخاب کنید. این بخش میز زنده امروز را شلوغ نمی‌کند.
        </p>
        <div className="expert-report__toolbar">
          <JalaliDateInput label="تاریخ گزارش" value={reportDate} onChange={setReportDate} />
          {reportBusy && <span className="expert-report__status">در حال بارگذاری…</span>}
          {reportError && reportError !== "ADMIN_SESSION_EXPIRED" && (
            <span className="expert-report__status expert-report__status--err">{reportError}</span>
          )}
        </div>
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
      </section>
    </div>
  );
}
