// Mirrors backend/app/gold_conversion.py exactly - keep both in sync
// if the formula ever changes there.
const MESGHAL_TO_GRAM = 4.6083;
const PURITY_18K = 750;
const PURITY_17K = 708;

export function mesghal17ToGram18(mesghal17Price) {
  return (mesghal17Price * PURITY_18K) / PURITY_17K / MESGHAL_TO_GRAM;
}

// Applies a user's own commission to a raw مثقال۱۷ price - mirrors
// backend/app/services/orders.py apply_pricing_formula exactly:
//   final_buy  = raw_buy  + commission
//   final_sell = raw_sell - commission
// Used ONLY for display (usePriceFeed) - the actual order is always
// priced authoritatively by the backend at submit time using the same
// formula server-side, this never affects what a user is charged.
export function applyCommission(rawPrice, side, commissionType, commissionValue) {
  const commission =
    commissionType === "percentage" ? rawPrice * (commissionValue / 100) : commissionValue;
  return side === "buy" ? rawPrice + commission : rawPrice - commission;
}

export function personalizePrice(rawPrice, commissionType, commissionValue) {
  if (!rawPrice) return rawPrice;
  const buy = applyCommission(rawPrice.buy_price, "buy", commissionType, commissionValue);
  const sell = applyCommission(rawPrice.sell_price, "sell", commissionType, commissionValue);
  const isCoin = rawPrice.unit === "count";
  return {
    ...rawPrice,
    buy_price: buy,
    sell_price: sell,
    gram18_buy_price: isCoin ? null : mesghal17ToGram18(buy),
    gram18_sell_price: isCoin ? null : mesghal17ToGram18(sell),
  };
}