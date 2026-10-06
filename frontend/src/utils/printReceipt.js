import { formatTehranDateTime, formatTehranMonthDayTime } from "./tehranTime";
import {
  orderExplanationFull,
  orderSideShort,
  orderTahesabCash,
  sortOrdersByTimeAsc,
} from "./orderLabels";

function fa(n, opts) {
  return Number(n).toLocaleString("fa-IR", opts);
}

function orderWeight(order) {
  return order.amount_type === "weight" ? order.value : order.value / order.price_at_submit;
}

function orderMoney(order) {
  return order.amount_type === "amount" ? order.value : order.value * order.price_at_submit;
}

function formatDate(iso) {
  return formatTehranDateTime(iso, { second: "2-digit", hour12: false });
}

function formatStamp(iso) {
  return formatTehranMonthDayTime(iso);
}

/** Absolute logo URL so print iframes / srcDoc previews resolve the asset. */
function brandLogoUrl() {
  try {
    if (typeof window !== "undefined" && window.location?.origin) {
      return `${window.location.origin}/logo.png`;
    }
  } catch {
    /* ignore */
  }
  return "/logo.png";
}

/** Shared print watermark: large centered brand mark scaled to the page. */
function watermarkCss() {
  return `
  .wm {
    position: fixed;
    inset: 0;
    z-index: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .wm img {
    width: min(82vw, 82vh);
    max-width: 190mm;
    max-height: 190mm;
    height: auto;
    opacity: 0.08;
    object-fit: contain;
  }
  .report-body {
    position: relative;
    z-index: 1;
  }
  @media print {
    .wm {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
    }
    .wm img {
      width: 78%;
      max-width: none;
      max-height: 78%;
      opacity: 0.07;
    }
  }`;
}

function watermarkHtml() {
  const src = brandLogoUrl();
  return `<div class="wm" aria-hidden="true"><img src="${src}" alt="" /></div>`;
}

export { watermarkCss, watermarkHtml, brandLogoUrl };

const STATUS_LABEL = { pending: "در انتظار", accepted: "تایید شده", rejected: "رد شده", cancelled: "لغو شده" };

function unitPriceForPrint(order, priceLabelMode = "mesghal_and_gram18") {
  const gram18Only = priceLabelMode === "gram18_only";
  if (gram18Only) {
    return {
      label: "مظنه (گرم ۱۸)",
      value: order.price_at_submit,
    };
  }
  return {
    label: "مظنه (مثقال ۱۷)",
    value: order.mesghal17_price_at_submit ?? order.price_at_submit,
  };
}

/**
 * Print via a hidden iframe so closing the print dialog does not
 * dismiss the PWA / leave the user without an app window.
 */
function printHtml(html) {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;";
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument || iframe.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();

  const cleanup = () => {
    try {
      iframe.remove();
    } catch {
      /* ignore */
    }
  };

  const win = iframe.contentWindow;
  const runPrint = () => {
    try {
      win.focus();
      win.print();
    } finally {
      win.addEventListener("afterprint", cleanup, { once: true });
      setTimeout(cleanup, 60_000);
    }
  };

  setTimeout(runPrint, 350);
}

export function buildOrderReceiptHtml(order, { priceLabelMode = "mesghal_and_gram18" } = {}) {
  const weight = orderWeight(order);
  const money = orderMoney(order);
  const unit = unitPriceForPrint(order, priceLabelMode);
  const cash = orderTahesabCash(order);
  const sideLabel = orderSideShort(order);
  const explanation = orderExplanationFull(order);

  const rows = [
    ["نوع سفارش", sideLabel],
    ["شرح سند ته‌حساب", explanation],
    ["وضعیت", STATUS_LABEL[order.status] || order.status],
    ["وزن طلا", `${fa(weight, { maximumFractionDigits: 3 })} گرم`],
    ...(unit.value != null
      ? [[unit.label, `${fa(Math.round(unit.value))} تومان`]]
      : []),
    ["مبلغ کل سفارش", `${fa(Math.round(money))} تومان`],
    [cash.label, `${fa(cash.amount)} تومان`],
    ...(order.customer_name ? [["مشتری", `${order.customer_name} #${order.customer_code}`]] : []),
    ["شماره سفارش", order.id],
    ["تاریخ و ساعت", formatDate(order.created_at)],
    ...(order.is_manual ? [["نوع ثبت", "دستی (حواله تلفنی)"]] : []),
    ...(order.description ? [["توضیحات کاربر", order.description]] : []),
  ];

  const rowsHtml = rows
    .map(([label, value]) => `<tr><td class="label">${label}</td><td class="value">${value}</td></tr>`)
    .join("");

  return `
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>رسید سفارش</title>
<link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;600;700&display=swap" rel="stylesheet" />
<style>
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    font-family: 'Vazirmatn', sans-serif;
    direction: rtl;
    margin: 0;
    padding: clamp(12px, 4vw, 40px);
    color: #1a1508;
    background: #fff;
    max-width: 100%;
    overflow-x: hidden;
  }
  h1 {
    font-size: clamp(16px, 4.2vw, 20px);
    text-align: center;
    margin: 0 0 4px;
  }
  .sub {
    text-align: center;
    color: #666;
    font-size: clamp(11px, 3vw, 12px);
    margin-bottom: clamp(16px, 4vw, 28px);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
  }
  td {
    padding: clamp(8px, 2.2vw, 12px) clamp(4px, 1.5vw, 8px);
    border-bottom: 1px solid #ddd;
    font-size: clamp(11px, 3.1vw, 13px);
    word-break: break-word;
    overflow-wrap: anywhere;
    vertical-align: top;
  }
  td.label { color: #666; width: 38%; }
  td.value { font-weight: 600; width: 62%; }
  .footer {
    margin-top: clamp(18px, 4vw, 30px);
    text-align: center;
    font-size: clamp(10px, 2.8vw, 11px);
    color: #999;
  }
  ${watermarkCss()}
  @media print {
    body { padding: 8mm; }
    @page { margin: 10mm; size: auto; }
  }
</style>
</head>
<body>
  ${watermarkHtml()}
  <div class="report-body">
  <h1>آبشده قصر طلا</h1>
  <p class="sub">رسید سفارش — ${sideLabel}</p>
  <table>${rowsHtml}</table>
  <p class="footer">این رسید در تاریخ ${formatDate(new Date().toISOString())} صادر شده است.</p>
  </div>
</body>
</html>`;
}

export function buildOrdersReceiptHtml(orders, { dateFrom, dateTo, priceLabelMode = "mesghal_and_gram18" } = {}) {
  const unitLabel = priceLabelMode === "gram18_only" ? "مظنه (گرم۱۸)" : "مظنه (مثقال۱۷)";
  const sorted = sortOrdersByTimeAsc(orders);

  const rowsHtml = sorted
    .map((order) => {
      const weight = orderWeight(order);
      const money = orderMoney(order);
      const unit = unitPriceForPrint(order, priceLabelMode);
      const cash = orderTahesabCash(order);
      const sideLabel = orderSideShort(order);
      const explanation = orderExplanationFull(order);
      return `<tr>
        <td class="time" dir="ltr">${formatStamp(order.created_at)}</td>
        <td>${sideLabel}</td>
        <td class="explain">${explanation}</td>
        <td>${STATUS_LABEL[order.status] || order.status}</td>
        <td>${fa(weight, { maximumFractionDigits: 3 })}</td>
        <td>${unit.value != null ? fa(Math.round(unit.value)) : "—"}</td>
        <td>${fa(Math.round(money))}</td>
        <td>${fa(cash.amount)}<div class="cash-dir">${cash.shortLabel}</div></td>
      </tr>`;
    })
    .join("");

  const rangeLabel =
    dateFrom || dateTo
      ? `از ${dateFrom ? formatDate(dateFrom) : "ابتدا"} تا ${dateTo ? formatDate(dateTo) : "امروز"}`
      : "همه سفارش‌ها";

  const totals = sorted.reduce((acc, order) => {
    const weight = orderWeight(order);
    const money = orderMoney(order);
    if (order.side === "buy") {
      acc.gold += weight;
      acc.cashIn += money;
      acc.cash -= money;
    } else if (order.side === "sell") {
      acc.gold -= weight;
      acc.cashOut += money;
      acc.cash += money;
    }
    return acc;
  }, { gold: 0, cash: 0, cashIn: 0, cashOut: 0 });

  const goldSummary =
    totals.gold > 0 ? `${fa(totals.gold, { maximumFractionDigits: 3 })} گرم بستانکار`
    : totals.gold < 0 ? `${fa(Math.abs(totals.gold), { maximumFractionDigits: 3 })} گرم بدهکار`
    : "۰ گرم — تسویه";
  const cashSummary =
    totals.cash > 0 ? `${fa(Math.round(totals.cash))} تومان بستانکار`
    : totals.cash < 0 ? `${fa(Math.abs(Math.round(totals.cash)))} تومان بدهکار`
    : "۰ تومان — تسویه";

  return `
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>گزارش سفارش‌ها</title>
<link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;600;700&display=swap" rel="stylesheet" />
<style>
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    font-family: 'Vazirmatn', sans-serif;
    direction: rtl;
    margin: 0;
    padding: clamp(12px, 4vw, 40px);
    color: #1a1508;
    background: #fff;
    max-width: 100%;
    overflow-x: hidden;
  }
  h1 { font-size: clamp(16px, 4.2vw, 20px); text-align: center; margin: 0 0 4px; }
  .sub { text-align: center; color: #666; font-size: clamp(11px, 3vw, 12px); margin-bottom: clamp(16px, 4vw, 28px); }
  .table-wrap { width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; }
  table { width: 100%; min-width: 720px; border-collapse: collapse; }
  th, td {
    padding: clamp(6px, 1.6vw, 8px) clamp(3px, 1vw, 5px);
    border-bottom: 1px solid #ddd;
    font-size: clamp(9px, 2.3vw, 11px);
    text-align: center;
    word-break: break-word;
    vertical-align: top;
  }
  th { color: #666; font-weight: 600; background: #f7f2e4; }
  td.time { white-space: nowrap; font-variant-numeric: tabular-nums; }
  td.explain { text-align: right; font-size: clamp(8.5px, 2.1vw, 10.5px); font-weight: 500; color: #333; }
  .cash-dir { font-size: 9px; font-weight: 500; color: #777; margin-top: 2px; }
  .summary {
    margin-top: clamp(14px, 3vw, 20px);
    text-align: right;
    font-size: clamp(11px, 3vw, 13px);
    font-weight: 700;
    line-height: 1.7;
  }
  .footer { margin-top: clamp(18px, 4vw, 30px); text-align: center; font-size: clamp(10px, 2.8vw, 11px); color: #999; }
  ${watermarkCss()}
  @media print {
    body { padding: 6mm; }
    .table-wrap { overflow: visible; }
    table { min-width: 0; font-size: 9px; }
    th, td { font-size: 9px; }
    td.explain { font-size: 8.5px; }
    @page { margin: 8mm; size: auto; }
  }
</style>
</head>
<body>
  ${watermarkHtml()}
  <div class="report-body">
  <h1>آبشده قصر طلا</h1>
  <p class="sub">گزارش سفارش‌ها (به‌ترتیب زمان) - ${rangeLabel}</p>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>زمان</th>
          <th>نوع</th>
          <th>شرح سند ته‌حساب</th>
          <th>وضعیت</th>
          <th>وزن</th>
          <th>${unitLabel}</th>
          <th>مبلغ کل</th>
          <th>مبلغ سند ته‌حساب</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  </div>
  <p class="summary">
    مجموع طلا: ${goldSummary}<br />
    مجموع نقدی خالص: ${cashSummary}<br />
    دریافتی از مشتری: ${fa(Math.round(totals.cashIn))} تومان — پرداختی به مشتری: ${fa(Math.round(totals.cashOut))} تومان<br />
    تعداد سفارش‌ها: ${fa(sorted.length)}
  </p>
  <p class="footer">این گزارش در تاریخ ${formatDate(new Date().toISOString())} صادر شده است.</p>
  </div>
</body>
</html>`;
}

export function downloadOrderReceipt(order, { priceLabelMode = "mesghal_and_gram18" } = {}) {
  printHtml(buildOrderReceiptHtml(order, { priceLabelMode }));
}

export function downloadOrdersReceipt(orders, { dateFrom, dateTo, priceLabelMode = "mesghal_and_gram18" } = {}) {
  printHtml(buildOrdersReceiptHtml(orders, { dateFrom, dateTo, priceLabelMode }));
}
