/**
 * Detect whether the live market price for an order's instrument has
 * moved away from the raw مثقال ۱۷ price locked at submit time.
 * Uses raw (pre-commission) prices so admin and customer stay aligned
 * with the same market move.
 */

export function liveRawSidePrice(cards, order) {
  if (!order || !cards?.length) return null;
  const byId =
    order.goldbridge_item_id != null
      ? cards.find((c) => c.goldbridge_item_id === order.goldbridge_item_id)
      : null;
  const card = byId || cards.find((c) => c.is_primary) || cards[0];
  if (!card) return null;
  return order.side === "buy" ? card.buy_price : card.sell_price;
}

export function orderMarketPriceChanged(order, liveCards) {
  if (!order || order.status !== "pending") return false;
  const submitted = order.mesghal17_raw_price_at_submit;
  if (submitted == null) return false;
  const live = liveRawSidePrice(liveCards, order);
  if (live == null) return false;
  return Math.round(Number(live)) !== Math.round(Number(submitted));
}

export function orderPriceChangeLabel(order, liveCards) {
  if (!orderMarketPriceChanged(order, liveCards)) return null;
  const submitted = Math.round(Number(order.mesghal17_raw_price_at_submit));
  const live = Math.round(Number(liveRawSidePrice(liveCards, order)));
  return { from: submitted, to: live };
}
