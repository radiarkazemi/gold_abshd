// Mirrors backend/app/gold_conversion.py exactly - keep both in sync
// if the formula ever changes there.
// Market formula: گرم۱۸ = مثقال۱۷ / 4.3318
const MESGHAL17_TO_GRAM18 = 4.3318;
// متفرقه بفروشید: (قیمت خرید id:1 + کارمزد) / 4.39
const MOTAFEREGHE_TO_GRAM18 = 4.39;
export const MOTAFEREGHE_ITEM_ID = 900001;

export function mesghal17ToGram18(mesghal17Price) {
  return mesghal17Price / MESGHAL17_TO_GRAM18;
}

export function motaferagheToGram18(mesghal17Price) {
  return mesghal17Price / MOTAFEREGHE_TO_GRAM18;
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

function commissionAmount(rawPrice, commissionType, commissionValue) {
  if (commissionType === "percentage") return rawPrice * (commissionValue / 100);
  return Number(commissionValue) || 0;
}

export function personalizePrice(rawPrice, commissionType, commissionValue) {
  if (!rawPrice) return rawPrice;
  const isCoin = rawPrice.unit === "count";
  const isMotaferaghe =
    rawPrice.pricing_mode === "motaferaghe_sell" ||
    rawPrice.goldbridge_item_id === MOTAFEREGHE_ITEM_ID;

  if (isMotaferaghe && !isCoin) {
    // متفرقه: base = id:1 بخرید; بفروشید = (price + commission) / 4.39
    const raw = rawPrice.buy_price ?? rawPrice.sell_price;
    const commission = commissionAmount(raw, commissionType, commissionValue);
    const mesghal = raw + commission;
    const gram18 = motaferagheToGram18(mesghal);
    return {
      ...rawPrice,
      buy_price: mesghal,
      sell_price: mesghal,
      gram18_buy_price: gram18,
      gram18_sell_price: gram18,
    };
  }

  const buy = applyCommission(rawPrice.buy_price, "buy", commissionType, commissionValue);
  const sell = applyCommission(rawPrice.sell_price, "sell", commissionType, commissionValue);
  return {
    ...rawPrice,
    buy_price: buy,
    sell_price: sell,
    gram18_buy_price: isCoin ? null : mesghal17ToGram18(buy),
    gram18_sell_price: isCoin ? null : mesghal17ToGram18(sell),
  };
}
