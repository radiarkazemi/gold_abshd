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
  return new Date(iso).toLocaleString("fa-IR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
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

// Opens a print-ready receipt for one order via a hidden iframe.
export function downloadOrderReceipt(order, { priceLabelMode = "mesghal_and_gram18" } = {}) {
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

  const html = `
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8" />
<title>رسید سفارش</title>
<link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;600;700&display=swap" rel="stylesheet" />
<style>
  * { box-sizing: border-box; }
  body {
    font-family: 'Vazirmatn', sans-serif;
    direction: rtl;
    padding: 40px;
    color: #1a1508;
    background: #fff;
  }
  h1 {
    font-size: 20px;
    text-align: center;
    margin-bottom: 4px;
  }
  .sub {
    text-align: center;
    color: #666;
    font-size: 12px;
    margin-bottom: 28px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  td {
    padding: 12px 8px;
    border-bottom: 1px solid #ddd;
    font-size: 13px;
  }
  td.label { color: #666; width: 40%; }
  td.value { font-weight: 600; }
  .footer {
    margin-top: 30px;
    text-align: center;
    font-size: 11px;
    color: #999;
  }
  @media print {
    body { padding: 0; }
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

  printHtml(html);
}

export function downloadOrdersReceipt(orders, { dateFrom, dateTo, priceLabelMode = "mesghal_and_gram18" } = {}) {
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

  const html = `
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8" />
<title>گزارش سفارش‌ها</title>
<link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;600;700&display=swap" rel="stylesheet" />
<style>
  * { box-sizing: border-box; }
  body {
    font-family: 'Vazirmatn', sans-serif;
    direction: rtl;
    padding: 40px;
    color: #1a1508;
    background: #fff;
  }
  h1 { font-size: 20px; text-align: center; margin-bottom: 4px; }
  .sub { text-align: center; color: #666; font-size: 12px; margin-bottom: 28px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 8px 6px; border-bottom: 1px solid #ddd; font-size: 12px; text-align: center; }
  th { color: #666; font-weight: 600; background: #f7f2e4; }
  .summary { margin-top: 20px; text-align: left; font-size: 13px; font-weight: 700; }
  .footer { margin-top: 30px; text-align: center; font-size: 11px; color: #999; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
  <h1>آبشده قصر طلا</h1>
  <p class="sub">گزارش سفارش‌ها - ${rangeLabel}</p>
  <table>
    <thead>
      <tr>
        <th>تاریخ</th><th>نوع</th><th>وضعیت</th><th>وزن (گرم۱۸)</th><th>${unitLabel}</th><th>مبلغ کل</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <p class="summary">مجموع طلا: ${goldSummary} — مجموع نقدی: ${cashSummary} — تعداد سفارش‌ها: ${fa(orders.length)}</p>
  <p class="footer">این گزارش در تاریخ ${formatDate(new Date().toISOString())} صادر شده است.</p>
</body>
</html>`;

  printHtml(html);
}
