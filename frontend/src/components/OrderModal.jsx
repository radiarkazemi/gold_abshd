import { useEffect, useRef, useState } from "react";
import { fetchOrderLimits, fetchMyOrderDetail } from "../api";

const SIDE_META = {
  buy: { title: "درخواست خرید", cta: "ثبت درخواست خرید", accent: "buy" },
  sell: { title: "درخواست فروش", cta: "ثبت درخواست فروش", accent: "sell" },
};

const STATUS_META = {
  pending: { label: "در انتظار تایید", className: "modal-result__status--pending" },
  accepted: { label: "تایید شد ✓", className: "modal-result__status--accepted" },
  rejected: { label: "رد شد", className: "modal-result__status--rejected" },
};

function toFarsiNumber(n) {
  return Number(n).toLocaleString("fa-IR", { maximumFractionDigits: 2 });
}

export default function OrderModal({ side, price, onClose, onSubmit, submitting, result, error }) {
  const [amountType, setAmountType] = useState("weight");
  const [value, setValue] = useState("");
  const [description, setDescription] = useState("");
  const [limits, setLimits] = useState(null);
  const [localError, setLocalError] = useState("");
  const [liveOrder, setLiveOrder] = useState(null);
  const pollRef = useRef(null);
  const meta = SIDE_META[side];

  useEffect(() => {
    fetchOrderLimits().then(setLimits).catch(() => {});
  }, []);

  // Poll for live status while the order is pending, so it turns green
  // (or red) the moment the admin decides, without needing a refresh.
  useEffect(() => {
    if (!result) return;
    setLiveOrder(result);

    function poll() {
      fetchMyOrderDetail(result.id)
        .then((updated) => {
          setLiveOrder(updated);
          if (updated.status !== "pending") {
            clearInterval(pollRef.current);
          }
        })
        .catch(() => {});
    }

    pollRef.current = setInterval(poll, 3000);
    return () => clearInterval(pollRef.current);
  }, [result]);

  function unitPrice() {
    return side === "buy" ? price?.gram18_buy_price : price?.gram18_sell_price;
  }

  function weightEquivalent(numeric) {
    if (amountType === "weight") return numeric;
    const up = unitPrice();
    if (!up) return null;
    return numeric / up;
  }

  function computedTotal() {
    const numeric = parseFloat(value);
    if (!numeric || numeric <= 0) return null;
    const up = unitPrice();
    if (!up) return null;

    if (amountType === "weight") {
      // entered a weight -> show the total price
      return { label: "مبلغ کل", value: `${toFarsiNumber(Math.round(numeric * up))} تومان` };
    }
    // entered an amount -> show the total weight
    return { label: "وزن کل", value: `${toFarsiNumber(numeric / up)} گرم ۱۸` };
  }

  function handleSubmit(e) {
    e.preventDefault();
    setLocalError("");
    const numeric = parseFloat(value);
    if (!numeric || numeric <= 0) {
      setLocalError("مقدار وارد شده معتبر نیست");
      return;
    }
    if (limits) {
      const weight = weightEquivalent(numeric);
      if (weight != null) {
        if (weight < limits.min_weight) {
          setLocalError(`حداقل مقدار سفارش ${toFarsiNumber(limits.min_weight)} گرم ۱۸ است`);
          return;
        }
        if (weight > limits.max_weight) {
          setLocalError(`حداکثر مقدار سفارش ${toFarsiNumber(limits.max_weight)} گرم ۱۸ است`);
          return;
        }
      }
    }
    onSubmit({ side, amountType, value: numeric, description });
  }

  const shownError = localError || error;
  const total = computedTotal();
  const statusMeta = liveOrder ? STATUS_META[liveOrder.status] : STATUS_META.pending;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className={`modal-sheet modal-sheet--${meta.accent}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="modal-sheet__handle" />
        <h2 className="modal-sheet__title">{meta.title}</h2>

        {result ? (
          <div className="modal-result">
            <p className="modal-result__text">
              درخواست شما ثبت شد و برای بررسی ارسال گردید.
            </p>
            <p className={`modal-result__status ${statusMeta.className}`}>
              {statusMeta.label}
            </p>
            <p className="modal-result__hint">
              در صورت پرداخت با حواله بانکی، می‌توانید فیش واریز را از صفحه
              «سفارش‌های من» ضمیمه کنید.
            </p>
            <button type="button" className="modal-btn modal-btn--ghost" onClick={onClose}>
              بستن
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="segmented">
              <button
                type="button"
                className={amountType === "weight" ? "segmented__opt is-active" : "segmented__opt"}
                onClick={() => setAmountType("weight")}
              >
                وزن
              </button>
              <button
                type="button"
                className={amountType === "amount" ? "segmented__opt is-active" : "segmented__opt"}
                onClick={() => setAmountType("amount")}
              >
                مبلغ
              </button>
            </div>

            <label className="field">
              <span className="field__label">
                {amountType === "weight" ? "وزن (گرم ۱۸)" : "مبلغ (تومان)"}
              </span>
              <input
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                autoFocus
                required
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={amountType === "weight" ? "مثلاً ۲.۵" : "مثلاً ۵۰۰۰۰۰۰"}
                className="field__input"
              />
              {limits && amountType === "weight" && (
                <span className="field__hint">
                  حداقل: {toFarsiNumber(limits.min_weight)} گرم ۱۸ &nbsp;·&nbsp; حداکثر:{" "}
                  {toFarsiNumber(limits.max_weight)} گرم ۱۸
                </span>
              )}
            </label>

            {total && (
              <div className="field__computed">
                <span>{total.label}</span>
                <span>{total.value}</span>
              </div>
            )}

            <label className="field">
              <span className="field__label">توضیحات</span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="توضیح اختیاری برای این درخواست"
                className="field__textarea"
                rows={3}
              />
            </label>

            {shownError && <p className="field__error">{shownError}</p>}

            <div className="modal-actions">
              <button type="button" className="modal-btn modal-btn--ghost" onClick={onClose}>
                انصراف
              </button>
              <button
                type="submit"
                className={`modal-btn modal-btn--${meta.accent}`}
                disabled={submitting}
              >
                {submitting ? "در حال ارسال…" : meta.cta}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}