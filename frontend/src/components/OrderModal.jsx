import { useEffect, useRef, useState } from "react";
import { fetchOrderLimits, fetchMyOrderDetail, cancelMyOrder } from "../api";
import FormattedNumberInput from "./FormattedNumberInput";

const SIDE_META = {
  buy: { title: "درخواست خرید", cta: "ثبت درخواست خرید", accent: "buy" },
  sell: { title: "درخواست فروش", cta: "ثبت درخواست فروش", accent: "sell" },
};

const STATUS_META = {
  pending: { label: "در انتظار تایید", className: "modal-result__status--pending" },
  accepted: { label: "تایید شد ✓", className: "modal-result__status--accepted" },
  rejected: { label: "رد شد", className: "modal-result__status--rejected" },
  cancelled: { label: "لغو شد", className: "modal-result__status--rejected" },
};

const COUNTDOWN_SECONDS = 60;
const MAX_RETRIES = 5;

function toFarsiNumber(n) {
  return Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatWeight(n) {
  return Number(n).toLocaleString("en-US", { maximumFractionDigits: 3 });
}

function formatMMSS(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function OrderModal({ side, price, onClose, onSubmit, submitting, result, error }) {
  const [amountType, setAmountType] = useState("weight");
  const [value, setValue] = useState("");
  const [description, setDescription] = useState("");
  const [limits, setLimits] = useState(null);
  const [localError, setLocalError] = useState("");
  const [liveOrder, setLiveOrder] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_SECONDS);
  const [retryCount, setRetryCount] = useState(0);
  const pollRef = useRef(null);
  const tickRef = useRef(null);
  const meta = SIDE_META[side];

  useEffect(() => {
    fetchOrderLimits().then(setLimits).catch(() => {});
  }, []);

  // Poll for live status while the order is pending, so it turns green
  // (or red) the moment the admin decides, without needing a refresh.
  useEffect(() => {
    if (!result) return;
    setLiveOrder(result);
    setSecondsLeft(COUNTDOWN_SECONDS);
    setRetryCount(0);

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

  // Countdown timer, only while still pending.
  useEffect(() => {
    if (!result || liveOrder?.status !== "pending") {
      clearInterval(tickRef.current);
      return;
    }
    tickRef.current = setInterval(() => {
      setSecondsLeft((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(tickRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, liveOrder?.status]);

  function handleRetry() {
    setRetryCount((c) => c + 1);
    setSecondsLeft(COUNTDOWN_SECONDS);
    // immediate re-check, don't wait for the next 3s poll tick
    fetchMyOrderDetail(result.id).then(setLiveOrder).catch(() => {});
  }

  async function handleCancel() {
    if (!confirm("این درخواست لغو شود؟")) return;
    try {
      const updated = await cancelMyOrder(result.id);
      setLiveOrder(updated);
    } catch (e) {
      alert(e.message || "لغو درخواست با خطا مواجه شد");
    }
  }

  function unitPrice() {
    return side === "buy" ? price?.gram18_buy_price : price?.gram18_sell_price;
  }

  function mesghal17Price() {
    return side === "buy" ? price?.buy_price : price?.sell_price;
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
      return { label: "مبلغ کل", value: `${toFarsiNumber(Math.round(numeric * up))} تومان` };
    }
    return { label: "وزن کل", value: `${formatWeight(numeric / up)} گرم ۱۸` };
  }

  function validate() {
    setLocalError("");
    const numeric = parseFloat(value);
    if (!numeric || numeric <= 0) {
      setLocalError("مقدار وارد شده معتبر نیست");
      return null;
    }
    if (limits) {
      const weight = weightEquivalent(numeric);
      if (weight != null) {
        if (weight < limits.min_weight) {
          setLocalError(`حداقل مقدار سفارش ${toFarsiNumber(limits.min_weight)} گرم ۱۸ است`);
          return null;
        }
        if (weight > limits.max_weight) {
          setLocalError(`حداکثر مقدار سفارش ${toFarsiNumber(limits.max_weight)} گرم ۱۸ است`);
          return null;
        }
      }
    }
    return numeric;
  }

  function handleFormSubmit(e) {
    e.preventDefault();
    const numeric = validate();
    if (numeric == null) return;
    setConfirming(true);
  }

  function handleConfirm() {
    onSubmit({ side, amountType, value: parseFloat(value), description });
  }

  const shownError = localError || error;
  const total = computedTotal();
  const statusMeta = liveOrder ? STATUS_META[liveOrder.status] : STATUS_META.pending;

  const priceChanged =
    liveOrder?.status === "pending" &&
    liveOrder?.mesghal17_price_at_submit != null &&
    mesghal17Price() != null &&
    Math.round(mesghal17Price()) !== Math.round(liveOrder.mesghal17_price_at_submit);

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

            {liveOrder?.status === "pending" && (
              <div className="modal-result__timer">
                {secondsLeft > 0 ? (
                  <span className="modal-result__countdown">{formatMMSS(secondsLeft)}</span>
                ) : retryCount < MAX_RETRIES ? (
                  <button type="button" className="modal-btn modal-btn--ghost" onClick={handleRetry}>
                    تلاش دوباره ({retryCount}/{MAX_RETRIES})
                  </button>
                ) : (
                  <p className="modal-result__hint">
                    بررسی این درخواست بیش از حد معمول طول کشیده. لطفا با پشتیبانی تماس بگیرید.
                  </p>
                )}
                <button type="button" className="modal-result__cancel-btn" onClick={handleCancel}>
                  لغو درخواست
                </button>
              </div>
            )}

            {priceChanged && (
              <p className="modal-result__price-change">
                مظنه از {toFarsiNumber(Math.round(liveOrder.mesghal17_price_at_submit))} به{" "}
                {toFarsiNumber(Math.round(mesghal17Price()))} تومان تغییر کرده
              </p>
            )}

            <p className="modal-result__hint">
              در صورت پرداخت با حواله بانکی، می‌توانید فیش واریز را از صفحه
              «سفارش‌های من» ضمیمه کنید.
            </p>
            <button type="button" className="modal-btn modal-btn--ghost" onClick={onClose}>
              بستن
            </button>
          </div>
        ) : confirming ? (
          <div className="modal-confirm">
            <p className="modal-confirm__text">لطفا اطلاعات سفارش را بررسی و تایید کنید:</p>
            <div className="modal-confirm__row">
              <span>قیمت (مثقال ۱۷)</span>
              <span>{mesghal17Price() ? toFarsiNumber(Math.round(mesghal17Price())) : "—"} تومان</span>
            </div>
            <div className="modal-confirm__row">
              <span>{amountType === "weight" ? "وزن" : "مبلغ"}</span>
              <span>
                {amountType === "weight" ? formatWeight(value) : toFarsiNumber(value)} {amountType === "weight" ? "گرم ۱۸" : "تومان"}
              </span>
            </div>
            {total && (
              <div className="modal-confirm__row modal-confirm__row--total">
                <span>{total.label}</span>
                <span>{total.value}</span>
              </div>
            )}
            {shownError && <p className="field__error">{shownError}</p>}
            <div className="modal-actions">
              <button type="button" className="modal-btn modal-btn--ghost" onClick={() => setConfirming(false)} disabled={submitting}>
                ویرایش
              </button>
              <button
                type="button"
                className={`modal-btn modal-btn--${meta.accent}`}
                onClick={handleConfirm}
                disabled={submitting}
              >
                {submitting ? "در حال ارسال…" : "تایید و ارسال"}
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleFormSubmit}>
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
                <span className="field__icon">{amountType === "weight" ? "⚖️" : "💰"}</span>
                {amountType === "weight" ? "وزن (گرم ۱۸)" : "مبلغ (تومان)"}
              </span>
              {amountType === "amount" ? (
                <FormattedNumberInput
                  value={value}
                  onChange={setValue}
                  className="field__input"
                  placeholder="مثلاً ۵,۰۰۰,۰۰۰"
                  autoFocus
                  required
                />
              ) : (
                <input
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  autoFocus
                  required
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="مثلاً ۲.۵"
                  className="field__input"
                />
              )}
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
              <span className="field__label"><span className="field__icon">📝</span>توضیحات</span>
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
              >
                {meta.cta}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}