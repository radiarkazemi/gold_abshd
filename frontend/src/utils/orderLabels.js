import { MOTAFEREGHE_ITEM_ID, NAGHD_KARTKHAN_ITEM_ID } from "./priceCommission";
import { orderTotalMoney } from "./orderCalc";

const SIDE_LABEL = { buy: "خرید", sell: "فروش" };

/** Card kind for special / default gold orders. */
export function orderKindKey(order) {
  const id = Number(order?.goldbridge_item_id);
  if (id === MOTAFEREGHE_ITEM_ID) return "motaferaghe";
  if (id === NAGHD_KARTKHAN_ITEM_ID) return "kartkhan";
  if (order?.amount_type === "count") return "coin";
  return "abshode";
}

/** Short tag inside (): متفرقه | کارتخوان | آبشده | سکه */
export function orderKindTag(order) {
  switch (orderKindKey(order)) {
    case "motaferaghe":
      return "متفرقه";
    case "kartkhan":
      return "کارتخوان";
    case "coin":
      return "سکه";
    default:
      return "آبشده";
  }
}

/** Main-page short label: فروش (متفرقه) */
export function orderSideShort(order) {
  const side = SIDE_LABEL[order?.side] || order?.side || "—";
  const tag = orderKindTag(order);
  return tag ? `${side} (${tag})` : side;
}

/**
 * Complete PDF / Tahesab-style explanation.
 * Matches the shop-centric sanad wording where relevant.
 */
export function orderExplanationFull(order) {
  const kind = orderKindKey(order);
  const code = order?.customer_code || order?.user_code || "";
  const shortId = String(order?.id || "").slice(0, 8);
  const codePart = code ? ` کد مشتری ${code}` : "";
  const orderPart = shortId ? ` سفارش ${shortId}` : "";

  if (kind === "motaferaghe") {
    // App sell → shop خرید متفرقه(بدون تسویه)
    return `اپ خرید متفرقه(بدون تسویه) عیار 740${codePart}${orderPart}`;
  }
  if (kind === "kartkhan") {
    return `اپ خرید نقد کارتخوان${codePart}${orderPart}`;
  }
  if (kind === "coin") {
    const sideFa = order?.side === "buy" ? "خرید" : "فروش";
    return `اپ ${sideFa} سکه${codePart}${orderPart}`;
  }
  const sideFa = order?.side === "buy" ? "خرید" : "فروش";
  return `اپ ${sideFa} طلا آبشده عیار 750${codePart}${orderPart}`;
}

/**
 * Cash that entered Tahesab for this order (مبلغ کل سند).
 * buy  → shop receives from customer (دریافتی)
 * sell → shop pays customer (پرداختی) e.g. متفرقه
 */
export function orderTahesabCash(order) {
  const money = Math.round(orderTotalMoney(order) || 0);
  if (order?.side === "buy") {
    return {
      label: "مبلغ دریافتی از مشتری (سند ته‌حساب)",
      shortLabel: "دریافتی از مشتری",
      amount: money,
      direction: "in",
    };
  }
  if (order?.side === "sell") {
    return {
      label: "مبلغ پرداختی به مشتری (سند ته‌حساب)",
      shortLabel: "پرداختی به مشتری",
      amount: money,
      direction: "out",
    };
  }
  return {
    label: "مبلغ سند ته‌حساب",
    shortLabel: "مبلغ سند",
    amount: money,
    direction: "none",
  };
}

export function sortOrdersByTimeAsc(orders) {
  return [...(orders || [])].sort((a, b) => {
    const ta = new Date(a?.created_at || 0).getTime();
    const tb = new Date(b?.created_at || 0).getTime();
    return ta - tb;
  });
}

export function sortOrdersByTimeDesc(orders) {
  return [...(orders || [])].sort((a, b) => {
    const ta = new Date(a?.created_at || 0).getTime();
    const tb = new Date(b?.created_at || 0).getTime();
    return tb - ta;
  });
}
