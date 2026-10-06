import { MOTAFEREGHE_ITEM_ID, NAGHD_KARTKHAN_ITEM_ID } from "./priceCommission";
import { orderGoldWeight, orderTotalMoney } from "./orderCalc";

const SIDE_LABEL = { buy: "خرید", sell: "فروش" };
const MOTAFEREGHE_AYAR = 740;
const ABSHODE_AYAR = 750;

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
 * Weight that hits ته حساب طلا (عیار ۷۵۰).
 * متفرقه physical 740g is scaled by 740/750 like the shop books.
 */
export function orderLedgerGoldWeight(order) {
  const w = Number(orderGoldWeight(order)) || 0;
  if (orderKindKey(order) === "motaferaghe") {
    return (w * MOTAFEREGHE_AYAR) / ABSHODE_AYAR;
  }
  return w;
}

/**
 * Short app شرح سند — no customer/order/ayar dump.
 * Tahesab form fields already carry عیار / بدون تسویه.
 */
export function orderExplanationFull(_order) {
  return "اپ";
}

/** Tahesab doc type label (shop-centric, like the Windows books). */
export function orderTahesabDocType(order) {
  const kind = orderKindKey(order);
  if (kind === "motaferaghe") return "خرید متفرقه";
  if (kind === "kartkhan") return "فروش طلا (کارتخوان)";
  if (kind === "coin") return order?.side === "buy" ? "فروش سکه" : "خرید سکه";
  // App buy → shop sold gold; app sell → shop bought gold
  return order?.side === "buy" ? "فروش طلا" : "خرید طلا";
}

export function paymentExplanationFull(_order) {
  return "اپ";
}

/**
 * Format a running balance with بد / بس (customer card convention):
 * positive = بس (creditor), negative = بد (debtor).
 */
export function formatBedBes(value, { digits = 0 } = {}) {
  const n = Number(value) || 0;
  if (Math.abs(n) < 1e-9) return "۰ — تسویه";
  const abs = Math.abs(n);
  const amount =
    digits > 0
      ? abs.toLocaleString("fa-IR", { maximumFractionDigits: digits, minimumFractionDigits: 0 })
      : Math.round(abs).toLocaleString("fa-IR");
  return `${amount} ${n > 0 ? "بس" : "بد"}`;
}

/**
 * Build Tahesab-style ledger docs for the PDF.
 *
 * Customer card signs (matching shop books):
 *   app buy  (فروش طلا):     gold +, cash −
 *   app sell (خرید متفرقه):  gold −, cash +  (بدون تسویه — no auto payment)
 *
 * پرداخت پول به طرف حساب is NOT invented here for متفرقه: that cash
 * settlement only appears after it is entered in Tahesab.
 */
export function buildCustomerLedgerDocs(orders, { priceLabelMode = "mesghal_and_gram18" } = {}) {
  const sorted = sortOrdersByTimeAsc(orders || []);
  const docs = [];
  let gold = 0;
  let cash = 0;

  for (const order of sorted) {
    const weight = orderLedgerGoldWeight(order);
    const money = Math.round(orderTotalMoney(order) || 0);
    const mazaneh =
      priceLabelMode === "gram18_only"
        ? order.price_at_submit
        : order.mesghal17_price_at_submit ?? order.price_at_submit;
    const kind = orderKindKey(order);

    if (order.side === "buy") {
      // Shop sold to customer
      gold += weight;
      cash -= money;
      docs.push({
        id: `${order.id}:trade`,
        orderId: order.id,
        created_at: order.created_at,
        docType: orderTahesabDocType(order),
        sideShort: orderSideShort(order),
        explanation: orderExplanationFull(order),
        weight,
        mazaneh,
        money,
        goldDebit: 0,
        goldCredit: weight,
        cashDebit: money,
        cashCredit: 0,
        goldBalance: gold,
        cashBalance: cash,
        kind: "trade",
        status: order.status,
      });
    } else if (order.side === "sell") {
      // Shop bought from customer — cash credit stays until real تسویه
      gold -= weight;
      cash += money;
      docs.push({
        id: `${order.id}:trade`,
        orderId: order.id,
        created_at: order.created_at,
        docType: orderTahesabDocType(order),
        sideShort: orderSideShort(order),
        explanation: orderExplanationFull(order),
        weight,
        mazaneh,
        money,
        goldDebit: weight,
        goldCredit: 0,
        cashDebit: 0,
        cashCredit: money,
        goldBalance: gold,
        cashBalance: cash,
        kind: "trade",
        status: order.status,
      });

      // متفرقه is بدون تسویه: do not invent پرداخت until Tahesab has it.
      // Other app sells historically settled in the PDF; keep that only
      // when it is not متفرقه.
      if (kind !== "motaferaghe") {
        cash -= money;
        const payAt = order.updated_at || order.created_at;
        docs.push({
          id: `${order.id}:pay`,
          orderId: order.id,
          created_at: payAt,
          docType: "پرداخت پول به طرف حساب",
          sideShort: `پرداخت (${orderKindTag(order)})`,
          explanation: paymentExplanationFull(order),
          weight: 0,
          mazaneh: null,
          money,
          goldDebit: 0,
          goldCredit: 0,
          cashDebit: money,
          cashCredit: 0,
          goldBalance: gold,
          cashBalance: cash,
          kind: "payment",
          status: order.status,
        });
      }
    }
  }

  return { docs, goldBalance: gold, cashBalance: cash };
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
