import { useEffect, useState } from "react";
import { fetchOrderLimits } from "../api";

const SIDE_META = {
  buy: { title: "درخواست خرید", cta: "ثبت درخواست خرید", accent: "buy" },
  sell: { title: "درخواست فروش", cta: "ثبت درخواست فروش", accent: "sell" },
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
  const meta = SIDE_META[side];

  useEffect(() => {
    fetchOrderLimits().then(setLimits).catch(() => {});
  }, []);

  function weightEquivalent(numeric) {
    if (amountType === "weight") return numeric;
    const unitPrice = side === "buy" ? price?.buy_price : price?.sell_price;
    if (!unitPrice) return null;
    return numeric / unitPrice;
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
          setLocalError(`حداقل مقدار سفارش ${toFarsiNumber(limits.min_weight)} مثقال است`);
          return;
        }
        if (weight > limits.max_weight) {
          setLocalError(`حداکثر مقدار سفارش ${toFarsiNumber(limits.max_weight)} مثقال است`);
          return;
        }
      }
    }
    onSubmit({ side, amountType, value: numeric, description });
  }

  const shownError = localError || error;

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
            <p className="modal-result__sub">وضعیت: در انتظار تایید</p>
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
                {amountType === "weight" ? "وزن (مثقال)" : "مبلغ (تومان)"}
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
                  حداقل: {toFarsiNumber(limits.min_weight)} مثقال &nbsp;·&nbsp; حداکثر:{" "}
                  {toFarsiNumber(limits.max_weight)} مثقال
                </span>
              )}
            </label>

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