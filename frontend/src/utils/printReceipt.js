import { formatTehranDateTime, formatTehranMonthDayTime } from "./tehranTime";
import {
  buildCustomerLedgerDocs,
  formatBedBes,
  normalizeTahesabLedgerDocs,
  orderExplanationFull,
  orderLedgerGoldWeight,
  orderSideShort,
  orderTahesabDocType,
  paymentExplanationFull,
} from "./orderLabels";
import { orderTotalMoney } from "./orderCalc";

function fa(n, opts) {
  return Number(n).toLocaleString("fa-IR", opts);
}

function orderMoney(order) {
  return orderTotalMoney(order);
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
  const { docs } = buildCustomerLedgerDocs([order], { priceLabelMode });
  const trade = docs.find((d) => d.kind === "trade") || docs[0];
  const payment = docs.find((d) => d.kind === "payment");
  const weight = orderLedgerGoldWeight(order);
  const money = Math.round(orderMoney(order));
  const unit = unitPriceForPrint(order, priceLabelMode);
  const sideLabel = orderSideShort(order);

  const rows = [
    ["نوع سفارش", sideLabel],
    ["نوع سند ته‌حساب", orderTahesabDocType(order)],
    ["شرح سند ته‌حساب", orderExplanationFull(order)],
    ["وضعیت", STATUS_LABEL[order.status] || order.status],
    ["وزن (عیار ۷۵۰)", `${fa(weight, { maximumFractionDigits: 3 })} گرم`],
    ...(unit.value != null
      ? [[unit.label, `${fa(Math.round(unit.value))} تومان`]]
      : []),
    ["مبلغ سند", `${fa(money)} تومان`],
    [
      "ته حساب طلا بعد از سند",
      trade ? formatBedBes(trade.goldBalance, { digits: 3 }) : "—",
    ],
    [
      "ته حساب نقد بعد از سند",
      trade ? formatBedBes(trade.cashBalance, { digits: 0 }) : "—",
    ],
  ];

  if (payment) {
    rows.push(
      ["سند تسویه", "پرداخت پول به طرف حساب"],
      ["شرح پرداخت", paymentExplanationFull(order)],
      ["مبلغ پرداخت", `${fa(payment.money)} تومان`],
      ["ته حساب طلا بعد از پرداخت", formatBedBes(payment.goldBalance, { digits: 3 })],
      ["ته حساب نقد بعد از پرداخت", formatBedBes(payment.cashBalance, { digits: 0 })]
    );
  }

  rows.push(
    ...(order.customer_name ? [["مشتری", `${order.customer_name} #${order.customer_code}`]] : []),
    ["شماره سفارش", order.id],
    ["تاریخ و ساعت", formatDate(order.created_at)],
    ...(order.is_manual ? [["نوع ثبت", "دستی (حواله تلفنی)"]] : []),
    ...(order.description ? [["توضیحات کاربر", order.description]] : [])
  );

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
  h1 { font-size: clamp(16px, 4.2vw, 20px); text-align: center; margin: 0 0 4px; }
  .sub { text-align: center; color: #666; font-size: clamp(11px, 3vw, 12px); margin-bottom: clamp(16px, 4vw, 28px); }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  td {
    padding: clamp(8px, 2.2vw, 12px) clamp(4px, 1.5vw, 8px);
    border-bottom: 1px solid #ddd;
    font-size: clamp(11px, 3.1vw, 13px);
    word-break: break-word;
    overflow-wrap: anywhere;
    vertical-align: top;
  }
  td.label { color: #666; width: 40%; }
  td.value { font-weight: 600; width: 60%; }
  .footer { margin-top: clamp(18px, 4vw, 30px); text-align: center; font-size: clamp(10px, 2.8vw, 11px); color: #999; }
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

export function buildOrdersReceiptHtml(
  orders,
  {
    dateFrom,
    dateTo,
    priceLabelMode = "mesghal_and_gram18",
    ledgerDocs,
    preferLedger = false,
  } = {}
) {
  const unitLabel = priceLabelMode === "gram18_only" ? "مظنه" : "مظنه ۱۷";
  // Explicit ledgerDocs (even empty) means: use Tahesab only, never invent from app orders.
  const useLedger = preferLedger || ledgerDocs !== undefined;
  const { docs, goldBalance, cashBalance } = useLedger
    ? normalizeTahesabLedgerDocs(Array.isArray(ledgerDocs) ? ledgerDocs : [])
    : buildCustomerLedgerDocs(orders, { priceLabelMode });

  // Ledger PDF = full جزئیات اسناد from Tahesab (column set only). Never date-filter rows.

  const rowsHtml = docs
    .map((doc, idx) => {
      const isPay = doc.kind === "payment";
      const stamp = doc.created_at
        ? formatStamp(doc.created_at)
        : doc.zaman_sabt || "—";
      return `<tr class="${isPay ? "row-pay" : "row-trade"}">
        <td class="num">${fa(idx + 1)}</td>
        <td class="time" dir="ltr">${stamp}</td>
        <td>${doc.docType}</td>
        <td class="explain">${doc.explanation || "—"}</td>
        <td>${doc.weight ? fa(doc.weight, { maximumFractionDigits: 3 }) : "—"}</td>
        <td>${doc.mazaneh != null ? fa(Math.round(doc.mazaneh)) : "—"}</td>
        <td>${doc.money ? fa(doc.money) : "—"}</td>
        <td class="bal">${formatBedBes(doc.goldBalance, { digits: 3 })}</td>
        <td class="bal">${formatBedBes(doc.cashBalance, { digits: 0 })}</td>
      </tr>`;
    })
    .join("");

  const rangeLabel = "جزئیات اسناد ته‌حساب";

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
  table { width: 100%; min-width: 780px; border-collapse: collapse; }
  th, td {
    padding: clamp(5px, 1.4vw, 7px) clamp(2px, 0.9vw, 4px);
    border-bottom: 1px solid #ddd;
    font-size: clamp(8.5px, 2.2vw, 10.5px);
    text-align: center;
    word-break: break-word;
    vertical-align: top;
  }
  th { color: #666; font-weight: 600; background: #f7f2e4; }
  td.time, td.num { white-space: nowrap; font-variant-numeric: tabular-nums; }
  td.explain { text-align: right; font-size: clamp(8px, 2vw, 10px); font-weight: 500; color: #333; }
  td.bal { font-weight: 700; white-space: nowrap; }
  tr.row-pay { background: #f3f8ff; }
  tr.row-pay td.explain { color: #1a4a7a; }
  .summary {
    margin-top: clamp(14px, 3vw, 20px);
    text-align: right;
    font-size: clamp(11px, 3vw, 13px);
    font-weight: 700;
    line-height: 1.8;
  }
  .legend { font-size: 11px; font-weight: 500; color: #666; margin-top: 8px; }
  .footer { margin-top: clamp(18px, 4vw, 30px); text-align: center; font-size: clamp(10px, 2.8vw, 11px); color: #999; }
  ${watermarkCss()}
  @media print {
    body { padding: 5mm; }
    .table-wrap { overflow: visible; }
    table { min-width: 0; }
    th, td { font-size: 8.5px; }
    td.explain { font-size: 8px; }
    @page { margin: 7mm; size: auto; }
  }
</style>
</head>
<body>
  ${watermarkHtml()}
  <div class="report-body">
  <h1>آبشده قصر طلا</h1>
  <p class="sub">گزارش اسناد ته‌حساب (به‌ترتیب زمان) - ${rangeLabel}</p>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>زمان</th>
          <th>نوع سند</th>
          <th>شرح سند</th>
          <th>وزن</th>
          <th>${unitLabel}</th>
          <th>مبلغ سند</th>
          <th>ته حساب طلا</th>
          <th>ته حساب نقد</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  </div>
  <p class="summary">
    مانده نهایی طلا: ${formatBedBes(goldBalance, { digits: 3 })}<br />
    مانده نهایی نقد: ${formatBedBes(cashBalance, { digits: 0 })}<br />
    تعداد اسناد: ${fa(docs.length)}
  </p>
  <p class="legend">
    بد = بدهکار &nbsp;|&nbsp; بس = بستانکار &nbsp;|&nbsp;
    منبع گزارش: اسناد ثبت‌شده در ته‌حساب (ورود متفرقه، پرداخت/دریافت، طلب/بدهی، خرید/فروش).
  </p>
  <p class="footer">این گزارش در تاریخ ${formatDate(new Date().toISOString())} صادر شده است.</p>
  </div>
</body>
</html>`;
}

export function downloadOrderReceipt(order, { priceLabelMode = "mesghal_and_gram18" } = {}) {
  printHtml(buildOrderReceiptHtml(order, { priceLabelMode }));
}

export function downloadOrdersReceipt(
  orders,
  {
    dateFrom,
    dateTo,
    priceLabelMode = "mesghal_and_gram18",
    ledgerDocs,
    preferLedger = false,
  } = {}
) {
  printHtml(
    buildOrdersReceiptHtml(orders, {
      dateFrom,
      dateTo,
      priceLabelMode,
      ledgerDocs,
      preferLedger,
    })
  );
}
