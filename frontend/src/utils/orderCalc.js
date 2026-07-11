// An order is stored as EITHER a weight OR a money amount (whichever the
// user typed in), with the گرم۱۸ price at submit time. These derive
// whichever side wasn't directly entered, so every view can always show
// both.

export function orderGoldWeight(order) {
  if (order.amount_type === "weight") return order.value;
  return order.value / order.price_at_submit;
}

export function orderTotalMoney(order) {
  if (order.amount_type === "amount") return order.value;
  return order.value * order.price_at_submit;
}

// Sums weight/money per side (buy/sell) across a list of orders - used
// for the "how much did I buy/sell in total" summary bar.
export function summarizeOrders(orders) {
  const totals = {
    buy: { weight: 0, money: 0, count: 0 },
    sell: { weight: 0, money: 0, count: 0 },
  };
  for (const o of orders) {
    const bucket = totals[o.side];
    if (!bucket) continue;
    bucket.weight += orderGoldWeight(o);
    bucket.money += orderTotalMoney(o);
    bucket.count += 1;
  }
  return totals;
}