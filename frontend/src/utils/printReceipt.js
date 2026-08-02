import { formatTehranDateTime } from "./tehranTime";
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
  return formatTehranDateTime(iso);
}

const SIDE_LABEL = { buy: "خرید", sell: "فروش" };
const STATUS_LABEL = { pending: "در انتظار", accepted: "تایید شده", rejected: "رد شده", cancelled: "لغو شده" };

function unitPriceForPrint(order, priceLabelMode = "mesghal_and_gram18") {
  const gram18Only = priceLabelMode === "gram18_only";
  if (gram18Only) {
    return {
      label: "فی (گرم ۱۸)",
      value: order.price_at_submit,
    };
  }
  return {
    label: "فی (مثقال ۱۷)",
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
      // afterprint fires on most browsers; fallback timeout otherwise
      win.addEventListener("afterprint", cleanup, { once: true });
      setTimeout(cleanup, 60_000);
    }
  };

  // Give fonts a moment to load before printing
  setTimeout(runPrint, 350);
}

export function buildOrderReceiptHtml(order, { priceLabelMode = "mesghal_and_gram18" } = {}) {
  const weight = orderWeight(order);
  const money = orderMoney(order);
  const unit = unitPriceForPrint(order, priceLabelMode);

  const rows = [
    ["نوع سفارش", SIDE_LABEL[order.side] || order.side],
    ["وضعیت", STATUS_LABEL[order.status] || order.status],
    ["وزن طلا", `${fa(weight, { maximumFractionDigits: 3 })} گرم ۱۸`],
    ["مبلغ کل", `${fa(Math.round(money))} تومان`],
    ...(unit.value != null
      ? [[unit.label, `${fa(Math.round(unit.value))} تومان`]]
      : []),
    ...(order.customer_name ? [["مشتری", `${order.customer_name} #${order.customer_code}`]] : []),
    ["شماره سفارش", order.id],
    ["تاریخ ثبت", formatDate(order.created_at)],
    ...(order.is_manual ? [["نوع ثبت", "دستی (حواله تلفنی)"]] : []),
    ...(order.description ? [["توضیحات", order.description]] : []),
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
  @media print {
    body { padding: 8mm; }
    @page { margin: 10mm; size: auto; }
  }
</style>
</head>
<body>
  <h1>آبشده قصر طلا</h1>
  <p class="sub">رسید سفارش</p>
  <table>${rowsHtml}</table>
  <p class="footer">این رسید در تاریخ ${formatDate(new Date().toISOString())} صادر شده است.</p>
</body>
</html>`;
}

export function buildOrdersReceiptHtml(orders, { dateFrom, dateTo, priceLabelMode = "mesghal_and_gram18" } = {}) {
  const unitLabel = priceLabelMode === "gram18_only" ? "فی (گرم۱۸)" : "فی (مثقال۱۷)";
  const rowsHtml = orders
    .map((order) => {
      const weight = orderWeight(order);
      const money = orderMoney(order);
      const unit = unitPriceForPrint(order, priceLabelMode);
      return `<tr>
        <td>${formatDate(order.created_at)}</td>
        <td>${SIDE_LABEL[order.side] || order.side}</td>
        <td>${STATUS_LABEL[order.status] || order.status}</td>
        <td>${fa(weight, { maximumFractionDigits: 3 })}</td>
        <td>${unit.value != null ? fa(Math.round(unit.value)) : "—"}</td>
        <td>${fa(Math.round(money))}</td>
      </tr>`;
    })
    .join("");

  const rangeLabel =
    dateFrom || dateTo
      ? `از ${dateFrom ? formatDate(dateFrom) : "ابتدا"} تا ${dateTo ? formatDate(dateTo) : "امروز"}`
      : "همه سفارش‌ها";

  const totals = orders.reduce((acc, order) => {
    const weight = orderWeight(order);
    const money = orderMoney(order);
    if (order.side === "buy") {
      acc.gold += weight;
      acc.cash -= money;
    } else if (order.side === "sell") {
      acc.gold -= weight;
      acc.cash += money;
    }
    return acc;
  }, { gold: 0, cash: 0 });

  const goldSummary =
    totals.gold > 0 ? `${fa(totals.gold, { maximumFractionDigits: 3 })} گرم ۱۸ بستانکار`
    : totals.gold < 0 ? `${fa(Math.abs(totals.gold), { maximumFractionDigits: 3 })} گرم ۱۸ بدهکار`
    : "۰ گرم ۱۸ — تسویه";
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
  table { width: 100%; min-width: 520px; border-collapse: collapse; }
  th, td {
    padding: clamp(6px, 1.6vw, 8px) clamp(4px, 1.2vw, 6px);
    border-bottom: 1px solid #ddd;
    font-size: clamp(10px, 2.6vw, 12px);
    text-align: center;
    word-break: break-word;
  }
  th { color: #666; font-weight: 600; background: #f7f2e4; }
  .summary {
    margin-top: clamp(14px, 3vw, 20px);
    text-align: right;
    font-size: clamp(11px, 3vw, 13px);
    font-weight: 700;
    line-height: 1.7;
  }
  .footer { margin-top: clamp(18px, 4vw, 30px); text-align: center; font-size: clamp(10px, 2.8vw, 11px); color: #999; }
  @media print {
    body { padding: 8mm; }
    .table-wrap { overflow: visible; }
    table { min-width: 0; }
    @page { margin: 10mm; size: auto; }
  }
</style>
</head>
<body>
  <h1>آبشده قصر طلا</h1>
  <p class="sub">گزارش سفارش‌ها - ${rangeLabel}</p>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>تاریخ</th><th>نوع</th><th>وضعیت</th><th>وزن (گرم۱۸)</th><th>${unitLabel}</th><th>مبلغ کل</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  </div>
  <p class="summary">مجموع طلا: ${goldSummary} — مجموع نقدی: ${cashSummary} — تعداد سفارش‌ها: ${fa(orders.length)}</p>
  <p class="footer">این گزارش در تاریخ ${formatDate(new Date().toISOString())} صادر شده است.</p>
</body>
</html>`;
}

// Opens a print-ready receipt for one order via a hidden iframe.
export function downloadOrderReceipt(order, { priceLabelMode = "mesghal_and_gram18" } = {}) {
  printHtml(buildOrderReceiptHtml(order, { priceLabelMode }));
}

export function downloadOrdersReceipt(orders, { dateFrom, dateTo, priceLabelMode = "mesghal_and_gram18" } = {}) {
  printHtml(buildOrdersReceiptHtml(orders, { dateFrom, dateTo, priceLabelMode }));
}
