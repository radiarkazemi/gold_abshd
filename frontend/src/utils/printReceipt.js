function fa(n, opts) {
  return Number(n).toLocaleString("fa-IR", opts);
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

// Opens a new tab with a print-ready receipt for one order, then
// triggers the browser's native print dialog - the user picks "Save as
// PDF" there. This is deliberately NOT a JS PDF-generation library:
// those don't render Persian/Arabic script correctly without a lot of
// font-embedding work, while the browser's own print engine handles
// RTL Persian text perfectly since it's just normal HTML/CSS.
export function downloadOrderReceipt(order) {
  const weight = order.amount_type === "weight" ? order.value : order.value / order.price_at_submit;
  const money = order.amount_type === "amount" ? order.value : order.value * order.price_at_submit;

  const rows = [
    ["نوع سفارش", SIDE_LABEL[order.side] || order.side],
    ["وضعیت", STATUS_LABEL[order.status] || order.status],
    ["وزن طلا", `${fa(weight, { maximumFractionDigits: 3 })} گرم ۱۸`],
    ["مبلغ کل", `${fa(Math.round(money))} تومان`],
    ...(order.mesghal17_price_at_submit
      ? [["قیمت (مثقال ۱۷)", `${fa(Math.round(order.mesghal17_price_at_submit))} تومان`]]
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
  <script>window.onload = () => setTimeout(() => window.print(), 300);</script>
</body>
</html>`;

  const win = window.open("", "_blank");
  win.document.write(html);
  win.document.close();
}