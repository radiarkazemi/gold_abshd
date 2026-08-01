import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchExpertDesk,
  decideOrder,
  createTehranDealer,
  updateTehranDealer,
  createExpertHedge,
  deleteExpertHedge,
} from "../api";
import { orderGoldWeight, orderTotalMoney } from "../utils/orderCalc";
import PendingCountdown from "../components/PendingCountdown";
import "./AdminExpertTab.css";

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
  return new Date(iso).toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" });
}

function CompactOrderCard({
  order,
  dealers,
  busyId,
  onDecide,
  onExpire,
  onAssign,
}) {
  const [dealerId, setDealerId] = useState("");
  const [weight, setWeight] = useState("");
  const [openAssign, setOpenAssign] = useState(false);
  const activeDealers = (dealers || []).filter((d) => d.is_active);
  const remaining = Math.max(0, Number(order.open_hedge_weight ?? orderGoldWeight(order)));
  const hedgeAction =
    order.side === "buy" ? "خرید از آبشده تهران" : "فروش به آبشده تهران";

  useEffect(() => {
    setWeight(remaining ? String(Number(remaining.toFixed(3))) : "");
  }, [order.id, remaining]);

  async function submitAssign() {
    if (!dealerId) {
      alert("آبشده‌فروش را انتخاب کنید");
      return;
    }
    await onAssign({
      orderId: order.id,
      dealerId,
      weightGram18: weight === "" ? null : Number(weight),
    });
    setOpenAssign(false);
  }

  return (
    <article className={`expert-card expert-card--${order.side}`}>
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

      {(order.hedged_weight || 0) > 0 && (
        <p className="expert-card__hedged">
          تخصیص‌شده: {fa(order.hedged_weight, { maximumFractionDigits: 3 })} g
          {remaining > 0 && <> · مانده: {fa(remaining, { maximumFractionDigits: 3 })} g</>}
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
        <button
          type="button"
          className="expert-btn expert-btn--dealer"
          disabled={busyId === order.id || remaining <= 0 || !activeDealers.length}
          onClick={() => setOpenAssign((v) => !v)}
        >
          {hedgeAction}
        </button>
      </div>

      {openAssign && (
        <div className="expert-card__assign">
          <select value={dealerId} onChange={(e) => setDealerId(e.target.value)}>
            <option value="">انتخاب آبشده‌فروش…</option>
            {activeDealers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <input
            type="number"
            inputMode="decimal"
            step="0.001"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            placeholder="وزن گرم۱۸"
          />
          <button type="button" className="expert-btn expert-btn--ok" onClick={submitAssign}>
            ثبت تخصیص
          </button>
        </div>
      )}
    </article>
  );
}

export default function AdminExpertTab({ refreshSignal }) {
  const [desk, setDesk] = useState(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [dealerForm, setDealerForm] = useState({ name: "", phone: "", notes: "" });
  const [dealerBusy, setDealerBusy] = useState(false);
  const [freeHedge, setFreeHedge] = useState({
    dealerId: "",
    side: "sell_to_dealer",
    weight: "",
    note: "",
  });

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
    const id = setInterval(reload, 5000);
    return () => clearInterval(id);
  }, [reload]);

  useEffect(() => {
    if (refreshSignal !== undefined) reload();
  }, [refreshSignal, reload]);

  const handleExpire = useCallback((orderId) => {
    setDesk((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        buy_orders: prev.buy_orders.filter((o) => o.id !== orderId),
        sell_orders: prev.sell_orders.filter((o) => o.id !== orderId),
      };
    });
    // Refresh totals from server shortly after
    setTimeout(reload, 300);
  }, [reload]);

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

  async function handleAssign({ orderId, dealerId, weightGram18 }) {
    setBusyId(orderId);
    try {
      await createExpertHedge({
        dealerId,
        relatedOrderId: orderId,
        weightGram18,
      });
      reload();
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
    try {
      await createExpertHedge({
        dealerId: freeHedge.dealerId,
        side: freeHedge.side,
        weightGram18: Number(freeHedge.weight),
        note: freeHedge.note,
      });
      setFreeHedge((f) => ({ ...f, weight: "", note: "" }));
      reload();
    } catch (err) {
      alert(err.message || "ثبت معامله ناموفق بود");
    }
  }

  async function removeHedge(id) {
    if (!confirm("این تخصیص حذف شود؟")) return;
    try {
      await deleteExpertHedge(id);
      reload();
    } catch {
      alert("حذف ناموفق بود");
    }
  }

  const totals = desk?.totals;
  const netDirLabel = useMemo(() => {
    if (!totals) return "";
    if (totals.net_direction === "sell_to_tehran") {
      return `مانده ${fa(Math.abs(totals.net_weight), { maximumFractionDigits: 3 })} گرم — باید به آبشده تهران بفروشید`;
    }
    if (totals.net_direction === "buy_from_tehran") {
      return `کسری ${fa(Math.abs(totals.net_weight), { maximumFractionDigits: 3 })} گرم — باید از آبشده تهران بخرید`;
    }
    return "بالانس برقرار است";
  }, [totals]);

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

  return (
    <div className="expert">
      <div className="expert__intro">
        <h3 className="dashboard__section-title">میز کارشناس</h3>
        <p className="expert__hint">
          سفارش‌های باز در دو ستون. مجموع وزن خرید/فروش مشتری و مانده بالانس برای پوشش با آبشده‌فروش‌های تهران.
        </p>
      </div>

      <section className="expert-totals" aria-label="جمع سفارش‌های باز">
        <div className="expert-totals__cell expert-totals__cell--buy">
          <span className="expert-totals__label">خرید مشتری از ما</span>
          <strong className="expert-totals__value">
            {fa(totals.buy.count)} سفارش · {fa(totals.buy.weight, { maximumFractionDigits: 3 })} گرم۱۸
          </strong>
          <span className="expert-totals__sub">{fa(Math.round(totals.buy.money))} تومان</span>
        </div>
        <div className="expert-totals__cell expert-totals__cell--sell">
          <span className="expert-totals__label">فروش مشتری به ما</span>
          <strong className="expert-totals__value">
            {fa(totals.sell.count)} سفارش · {fa(totals.sell.weight, { maximumFractionDigits: 3 })} گرم۱۸
          </strong>
          <span className="expert-totals__sub">{fa(Math.round(totals.sell.money))} تومان</span>
        </div>
        <div className={`expert-totals__balance expert-totals__balance--${totals.net_direction}`}>
          <span className="expert-totals__label">بالانس لحظه‌ای</span>
          <strong className="expert-totals__value">
            {fa(totals.net_weight, { maximumFractionDigits: 3 })} گرم۱۸
          </strong>
          <span className="expert-totals__sub">{netDirLabel}</span>
        </div>
      </section>

      <section className="expert-board" aria-label="جدول سفارش‌های باز">
        <div className="expert-col expert-col--buy">
          <header className="expert-col__head">
            <h4>خرید مشتری از ما</h4>
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
            <h4>فروش مشتری به ما</h4>
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

        <form className="expert-free-hedge" onSubmit={submitFreeHedge}>
          <h4>معامله آزاد با آبشده تهران (بدون سفارش)</h4>
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
              placeholder="یادداشت"
              value={freeHedge.note}
              onChange={(e) => setFreeHedge((f) => ({ ...f, note: e.target.value }))}
            />
            <button type="submit" className="expert-btn expert-btn--dealer">
              ثبت
            </button>
          </div>
        </form>
      </section>

      <section className="expert-hedges">
        <h3 className="dashboard__section-title">تخصیص‌های ۲۴ ساعت اخیر</h3>
        {(desk.hedges || []).length === 0 ? (
          <p className="expert-col__empty">تخصیصی ثبت نشده</p>
        ) : (
          <div className="expert-hedges__table-wrap">
            <table className="expert-hedges__table">
              <thead>
                <tr>
                  <th>زمان</th>
                  <th>آبشده‌فروش</th>
                  <th>نوع</th>
                  <th>وزن</th>
                  <th>سفارش</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {desk.hedges.map((h) => (
                  <tr key={h.id}>
                    <td>{formatTime(h.created_at)}</td>
                    <td>{h.dealer_name}</td>
                    <td>{HEDGE_LABEL[h.side] || h.side}</td>
                    <td>{fa(h.weight_gram18, { maximumFractionDigits: 3 })}</td>
                    <td>{h.related_order_id ? `#${String(h.related_order_id).slice(0, 8)}` : "—"}</td>
                    <td>
                      <button type="button" className="expert-btn expert-btn--no" onClick={() => removeHedge(h.id)}>
                        حذف
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
