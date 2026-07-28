import { useEffect, useRef, useState } from "react";
import { fetchOrderLimits, fetchMyOrderDetail, retryMyOrder } from "../api";
import { formatMMSS, localDeadlineMsFromOrder } from "../utils/orderCountdown";
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

const FALLBACK_MAX_RETRIES = 5;

function toFarsiNumber(n) {
  return Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatWeight(n) {
  return Number(n).toLocaleString("en-US", { maximumFractionDigits: 3 });
}

export default function OrderModal({ card, side, onClose, onSubmit, submitting, result, error }) {
  const isCoin = card?.unit === "count";
  const modalRef = useRef(null);
  const [amountType, setAmountType] = useState(isCoin ? "count" : "weight");
  const [value, setValue] = useState("");
  const [description, setDescription] = useState("");
  const [limits, setLimits] = useState(null);
  const [localError, setLocalError] = useState("");
  const [liveOrder, setLiveOrder] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const pollRef = useRef(null);
  const tickRef = useRef(null);
  const localDeadlineRef = useRef(0);
  const meta = SIDE_META[side];

  function syncCountdownFromOrder(order) {
    if (!order || order.status !== "pending") {
      localDeadlineRef.current = 0;
      setSecondsLeft(0);
      return;
    }
    localDeadlineRef.current = localDeadlineMsFromOrder(order);
    setSecondsLeft(Math.max(0, Math.ceil((localDeadlineRef.current - Date.now()) / 1000)));
  }

  useEffect(() => {
    fetchOrderLimits().then(setLimits).catch(() => {});
  }, []);

  useEffect(() => {
    const root = modalRef.current;
    if (!root) return;

    function updateViewportHeight() {
      const viewportHeight = window.visualViewport?.height || window.innerHeight;
      root.style.setProperty("--modal-viewport-height", `${viewportHeight}px`);
    }

    function keepFocusedFieldVisible(event) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      requestAnimationFrame(() => {
        target.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
      });
    }

    updateViewportHeight();
    window.visualViewport?.addEventListener("resize", updateViewportHeight);
    root.addEventListener("focusin", keepFocusedFieldVisible);
    return () => {
      window.visualViewport?.removeEventListener("resize", updateViewportHeight);
      root.removeEventListener("focusin", keepFocusedFieldVisible);
    };
  }, []);

  useEffect(() => {
    if (!result) return;
    setLiveOrder(result);
    syncCountdownFromOrder(result);

    function poll() {
      fetchMyOrderDetail(result.id)
        .then((updated) => {
          setLiveOrder(updated);
          if (updated.status === "pending") {
            syncCountdownFromOrder(updated);
          } else {
            clearInterval(pollRef.current);
            setSecondsLeft(0);
          }
        })
        .catch(() => {});
    }

    pollRef.current = setInterval(poll, 3000);
    return () => clearInterval(pollRef.current);
  }, [result]);

  useEffect(() => {
    if (!result || liveOrder?.status !== "pending") {
      clearInterval(tickRef.current);
      return;
    }
    tickRef.current = setInterval(() => {
      const left = Math.max(0, Math.ceil((localDeadlineRef.current - Date.now()) / 1000));
      setSecondsLeft(left);
    }, 250);
    return () => clearInterval(tickRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, liveOrder?.status, liveOrder?.pending_deadline_at, liveOrder?.retry_count]);

  async function handleRetry() {
    if (!result || retrying) return;
    setRetrying(true);
    setLocalError("");
    try {
      const updated = await retryMyOrder(result.id);
      setLiveOrder(updated);
      syncCountdownFromOrder(updated);
    } catch (e) {
      setLocalError(e.message || "تلاش دوباره با خطا مواجه شد");
      fetchMyOrderDetail(result.id).then((updated) => {
        setLiveOrder(updated);
        syncCountdownFromOrder(updated);
      }).catch(() => {});
    } finally {
      setRetrying(false);
    }
  }

  function unitPrice() {
    return side === "buy" ? card?.gram18_buy_price : card?.gram18_sell_price;
  }

  // Card prices already include this user's commission (see usePriceFeed).
  function finalSidePrice() {
    return side === "buy" ? card?.buy_price : card?.sell_price;
  }

  function submitFinalPrice() {
    if (!liveOrder) return null;
    if (!isCoin && gram18OnlyDisplay) return liveOrder.price_at_submit;
    return liveOrder.mesghal17_price_at_submit;
  }

  function currentFinalPrice() {
    if (!isCoin && gram18OnlyDisplay) return unitPrice();
    return finalSidePrice();
  }

  function computedTotal() {
    const numeric = parseFloat(value);
    if (!numeric || numeric <= 0) return null;

    if (isCoin) {
      const p = finalSidePrice();
      if (!p) return null;
      return { label: "مبلغ کل", value: `${toFarsiNumber(Math.round(numeric * p))} تومان` };
    }

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

    if (isCoin) {
      if (!Number.isInteger(numeric)) {
        setLocalError("تعداد باید عددی صحیح باشد");
        return null;
      }
      if (numeric > 50) {
        setLocalError("حداکثر تعداد سفارش سکه ۵۰ عدد است");
        return null;
      }
      return numeric;
    }

    if (limits) {
      if (amountType === "weight") {
        if (numeric < limits.min_weight) {
          setLocalError(`حداقل مقدار سفارش ${toFarsiNumber(limits.min_weight)} گرم ۱۸ است`);
          return null;
        }
        if (numeric > limits.max_weight) {
          setLocalError(`حداکثر مقدار سفارش ${toFarsiNumber(limits.max_weight)} گرم ۱۸ است`);
          return null;
        }
      } else {
        if (limits.min_amount && numeric < limits.min_amount) {
          setLocalError(`حداقل مبلغ سفارش ${toFarsiNumber(limits.min_amount)} تومان است`);
          return null;
        }
        if (limits.max_amount && numeric > limits.max_amount) {
          setLocalError(`حداکثر مبلغ سفارش ${toFarsiNumber(limits.max_amount)} تومان است`);
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
  const gram18OnlyDisplay = !isCoin && limits?.price_label_mode === "gram18_only";
  const retryCount = liveOrder?.retry_count ?? 0;
  const maxRetries = liveOrder?.max_retries ?? FALLBACK_MAX_RETRIES;

  const priceChanged =
    liveOrder?.status === "pending" &&
    submitFinalPrice() != null &&
    currentFinalPrice() != null &&
    Math.round(currentFinalPrice()) !== Math.round(submitFinalPrice());

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={modalRef}
        className={`modal-sheet modal-sheet--${meta.accent}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="modal-sheet__handle" />
        <h2 className="modal-sheet__title">{meta.title}{card?.name ? ` — ${card.name}` : ""}</h2>

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
                ) : retryCount < maxRetries ? (
                  <button
                    type="button"
                    className="modal-btn modal-btn--ghost"
                    onClick={handleRetry}
                    disabled={retrying}
                  >
                    {retrying ? "در حال ارسال…" : `تلاش دوباره (${retryCount}/${maxRetries})`}
                  </button>
                ) : (
                  <p className="modal-result__hint">
                    بررسی این درخواست بیش از حد معمول طول کشیده. لطفا با پشتیبانی تماس بگیرید.
                  </p>
                )}
              </div>
            )}

            {priceChanged && (
              <p className="modal-result__price-change">
                {gram18OnlyDisplay && !isCoin ? (
                  <>
                    مظنه از {toFarsiNumber(Math.round(submitFinalPrice()))} به{" "}
                    {toFarsiNumber(Math.round(currentFinalPrice()))} تومان (گرم ۱۸) تغییر کرده
                  </>
                ) : (
                  <>
                    مظنه از {toFarsiNumber(Math.round(submitFinalPrice()))} به{" "}
                    {toFarsiNumber(Math.round(currentFinalPrice()))} تومان تغییر کرده
                  </>
                )}
              </p>
            )}

            <p className="modal-result__hint">
              در صورت پرداخت با حواله بانکی، می‌توانید فیش واریز را از صفحه
              «سفارش‌های من» ضمیمه کنید.
            </p>
            {shownError && <p className="field__error">{shownError}</p>}
            <button type="button" className="modal-btn modal-btn--ghost" onClick={onClose}>
              بستن
            </button>
          </div>
        ) : confirming ? (
          <div className="modal-confirm">
            <p className="modal-confirm__text">لطفا اطلاعات سفارش را بررسی و تایید کنید:</p>
            <div className="modal-confirm__row">
              <span>{isCoin ? "قیمت (هر عدد)" : gram18OnlyDisplay ? "قیمت (گرم ۱۸)" : "قیمت (مثقال ۱۷)"}</span>
              <span>
                {finalSidePrice()
                  ? toFarsiNumber(
                      Math.round(
                        !isCoin && gram18OnlyDisplay ? unitPrice() : finalSidePrice()
                      )
                    )
                  : "—"}{" "}
                تومان
              </span>
            </div>
            <div className="modal-confirm__row">
              <span>{isCoin ? "تعداد" : amountType === "weight" ? "وزن" : "مبلغ"}</span>
              <span>
                {isCoin
                  ? `${toFarsiNumber(value)} عدد`
                  : `${amountType === "weight" ? formatWeight(value) : toFarsiNumber(value)} ${amountType === "weight" ? "گرم ۱۸" : "تومان"}`}
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
            {!isCoin && (
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
            )}

            <label className="field">
              <span className="field__label">
                <span className="field__icon">{isCoin ? "🔢" : amountType === "weight" ? "⚖️" : "💰"}</span>
                {isCoin ? "تعداد" : amountType === "weight" ? "وزن (گرم ۱۸)" : "مبلغ (تومان)"}
              </span>
              {isCoin ? (
                <input
                  type="number"
                  inputMode="numeric"
                  step="1"
                  min="1"
                  autoFocus
                  required
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="مثلاً ۱"
                  className="field__input"
                />
              ) : amountType === "amount" ? (
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
              {!isCoin && limits && amountType === "weight" && (
                <span className="field__hint">
                  حداقل: {toFarsiNumber(limits.min_weight)} گرم ۱۸ &nbsp;·&nbsp; حداکثر:{" "}
                  {toFarsiNumber(limits.max_weight)} گرم ۱۸
                </span>
              )}
              {!isCoin && limits && amountType === "amount" && (limits.min_amount > 0 || limits.max_amount > 0) && (
                <span className="field__hint">
                  {limits.min_amount > 0 && <>حداقل: {toFarsiNumber(limits.min_amount)} تومان</>}
                  {limits.min_amount > 0 && limits.max_amount > 0 && <>&nbsp;·&nbsp;</>}
                  {limits.max_amount > 0 && <>حداکثر: {toFarsiNumber(limits.max_amount)} تومان</>}
                </span>
              )}
              {isCoin && <span className="field__hint">حداکثر ۵۰ عدد در هر سفارش</span>}
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
