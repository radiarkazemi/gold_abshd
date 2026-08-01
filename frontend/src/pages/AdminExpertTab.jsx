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

function formatDateTime(iso) {
  return new Date(iso).toLocaleString("fa-IR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function DealerAssignInline({ order, dealers, busy, onAssign }) {
  const [dealerId, setDealerId] = useState("");
  const [weight, setWeight] = useState("");
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
        <div className="expert-assign__row">
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
          <button
            type="button"
            className="expert-btn expert-btn--ok"
            disabled={busy}
            onClick={async () => {
              if (!dealerId) {
                alert("آبشده‌فروش را انتخاب کنید");
                return;
              }
              await onAssign({
                orderId: order.id,
                dealerId,
                weightGram18: weight === "" ? null : Number(weight),
              });
              setOpen(false);
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

function AcceptedOrdersTable({ orders, dealers, busyId, onAssign, filterSide, query }) {
  const rows = useMemo(() => {
    let list = orders || [];
    if (filterSide === "buy" || filterSide === "sell") {
      list = list.filter((o) => o.side === filterSide);
    }
    const q = (query || "").trim();
    if (q) {
      list = list.filter((o) => {
        const hay = `${o.customer_name || ""} ${o.customer_code || ""} ${o.id || ""}`;
        return hay.includes(q);
      });
    }
    return list;
  }, [orders, filterSide, query]);

  if (!rows.length) {
    return <p className="expert-col__empty">سفارش تاییدشده‌ای در میز نیست</p>;
  }

  return (
    <div className="expert-accepted__wrap">
      <table className="expert-accepted__table">
        <thead>
          <tr>
            <th>زمان</th>
            <th>نوع</th>
            <th>مشتری</th>
            <th>وزن</th>
            <th>مانده پوشش</th>
            <th>مبلغ</th>
            <th>آبشده تهران</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.id} className={o.is_fully_hedged ? "is-hedged" : ""}>
              <td>{formatDateTime(o.updated_at || o.created_at)}</td>
              <td>
                <span className={`expert-card__badge expert-card__badge--${o.side}`}>
                  {SIDE_LABEL[o.side]}
                </span>
              </td>
              <td>
                {o.customer_name || "بدون نام"} #{o.customer_code}
              </td>
              <td>{fa(orderGoldWeight(o), { maximumFractionDigits: 3 })}</td>
              <td>{fa(o.open_hedge_weight ?? 0, { maximumFractionDigits: 3 })}</td>
              <td>{fa(Math.round(orderTotalMoney(o)))}</td>
              <td>
                <DealerAssignInline
                  order={o}
                  dealers={dealers}
                  busy={busyId === o.id}
                  onAssign={onAssign}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AdminExpertTab({ refreshSignal }) {
  const [desk, setDesk] = useState(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [dealerForm, setDealerForm] = useState({ name: "", phone: "", notes: "" });
  const [dealerBusy, setDealerBusy] = useState(false);
  const [acceptedFilter, setAcceptedFilter] = useState("all");
  const [acceptedQuery, setAcceptedQuery] = useState("");
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
    const id = setInterval(reload, 4000);
    return () => clearInterval(id);
  }, [reload]);

  useEffect(() => {
    if (refreshSignal !== undefined) reload();
  }, [refreshSignal, reload]);

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
    const left = fa(Math.abs(totals.net_weight), { maximumFractionDigits: 3 });
    if (totals.net_direction === "sell_to_tehran") {
      return `${left} گرم مانده — فروش به آبشده تهران`;
    }
    if (totals.net_direction === "buy_from_tehran") {
      return `${left} گرم کسری — خرید از آبشده تهران`;
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
  const acceptedAll = [...(desk.accepted_buy_orders || []), ...(desk.accepted_sell_orders || [])].sort(
    (a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at)
  );
  const dealers = desk.dealers || [];
  const activeDealers = dealers.filter((d) => d.is_active);

  return (
    <div className="expert">
      <div className="expert__intro">
        <h3 className="dashboard__section-title">میز کارشناس</h3>
        <p className="expert__hint">
          جمع بالا از سفارش‌های <b>در انتظار + تاییدشده</b> ساخته می‌شود و با تایید صفر نمی‌شود.
          مثال: ۴۰ گرم فروش مشتری و ۳۰ گرم خرید مشتری ← بعد از تایید ۳۰ گرم خرید، ۱۰ گرم مانده برای فروش به تهران.
          نشست فعلی حدود {fa(desk.session_hours || 36)} ساعت است.
        </p>
      </div>

      <section className="expert-totals expert-totals--sticky" aria-label="جمع میز">
        <div className="expert-totals__cell expert-totals__cell--buy">
          <span className="expert-totals__label">خرید مشتری از ما</span>
          <strong className="expert-totals__value">
            {fa(totals.buy.weight, { maximumFractionDigits: 3 })} گرم۱۸
          </strong>
          <span className="expert-totals__sub">
            {fa(totals.buy.count)} سفارش · باز {fa(totals.buy.pending_count || 0)} · تایید{" "}
            {fa(totals.buy.accepted_count || 0)}
          </span>
        </div>
        <div className="expert-totals__cell expert-totals__cell--sell">
          <span className="expert-totals__label">فروش مشتری به ما</span>
          <strong className="expert-totals__value">
            {fa(totals.sell.weight, { maximumFractionDigits: 3 })} گرم۱۸
          </strong>
          <span className="expert-totals__sub">
            {fa(totals.sell.count)} سفارش · باز {fa(totals.sell.pending_count || 0)} · تایید{" "}
            {fa(totals.sell.accepted_count || 0)}
          </span>
        </div>
        <div className={`expert-totals__balance expert-totals__balance--${totals.net_direction}`}>
          <span className="expert-totals__label">مانده برای تهران</span>
          <strong className="expert-totals__value">
            {fa(totals.net_weight, { maximumFractionDigits: 3 })} گرم۱۸
          </strong>
          <span className="expert-totals__sub">
            {netDirLabel}
            {totals.matched_weight > 0 && (
              <> · تهاتر داخلی {fa(totals.matched_weight, { maximumFractionDigits: 3 })} g</>
            )}
          </span>
        </div>
      </section>

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

      <section className="expert-accepted">
        <div className="expert-accepted__toolbar">
          <h3 className="dashboard__section-title">سفارش‌های تاییدشده (میز)</h3>
          <div className="expert-accepted__filters">
            <input
              value={acceptedQuery}
              onChange={(e) => setAcceptedQuery(e.target.value)}
              placeholder="جستجوی مشتری / کد…"
            />
            <select value={acceptedFilter} onChange={(e) => setAcceptedFilter(e.target.value)}>
              <option value="all">همه</option>
              <option value="buy">فقط خرید مشتری</option>
              <option value="sell">فقط فروش مشتری</option>
            </select>
            <span className="expert-accepted__count">{fa(acceptedAll.length)} ردیف</span>
          </div>
        </div>
        <AcceptedOrdersTable
          orders={acceptedAll}
          dealers={dealers}
          busyId={busyId}
          onAssign={handleAssign}
          filterSide={acceptedFilter}
          query={acceptedQuery}
        />
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
          <h4>پوشش مانده با آبشده تهران (بدون سفارش خاص)</h4>
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
              ثبت پوشش
            </button>
          </div>
        </form>
      </section>

      <section className="expert-hedges">
        <h3 className="dashboard__section-title">تاریخچه تخصیص به تهران</h3>
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
                    <td>{formatDateTime(h.created_at)}</td>
                    <td>{h.dealer_name}</td>
                    <td>{HEDGE_LABEL[h.side] || h.side}</td>
                    <td>{fa(h.weight_gram18, { maximumFractionDigits: 3 })}</td>
                    <td>{h.related_order_id ? `#${String(h.related_order_id).slice(0, 8)}` : "آزاد"}</td>
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
