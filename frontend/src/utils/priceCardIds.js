/** Shared goldbridge / shop card ids. Keep in sync with backend price_cards.py */
export const SPECIAL_MOTAFEREGHE_ID = 900001;
export const SPECIAL_NAGHD_KARTKHAN_ID = 900002;
/** Farshad hidden master — formula source for متفرقه / نقد کارتخوان. */
export const SOURCE_MIRROR_ITEM_ID = 1;
/** Farshad /trade cash tile (نقدی یکشنبه). This is the shop's main card. */
export const FARSHAD_TRADE_CASH_ITEM_ID = 1013;

export function isFarshadTradeTile(card) {
  return !!(card?.is_farshad_trade_tile || Number(card?.goldbridge_item_id) === FARSHAD_TRADE_CASH_ITEM_ID);
}

export function isFarshadHiddenMaster(card) {
  return !!(card?.is_farshad_hidden_master || Number(card?.goldbridge_item_id) === SOURCE_MIRROR_ITEM_ID);
}

/** Lower rank = earlier in admin / customer lists. 1013 is always first. */
export function priceCardRank(card) {
  const id = Number(card?.goldbridge_item_id);
  if (id === FARSHAD_TRADE_CASH_ITEM_ID) return 0;
  if (id === SPECIAL_MOTAFEREGHE_ID) return 1;
  if (id === SPECIAL_NAGHD_KARTKHAN_ID) return 2;
  if (id === SOURCE_MIRROR_ITEM_ID) return 3;
  if (card?.is_enabled || card?.orderable_buy || card?.orderable_sell) return 4;
  return 5;
}

export function sortPriceCards(cards) {
  return [...(cards || [])].sort((a, b) => {
    const rank = priceCardRank(a) - priceCardRank(b);
    if (rank !== 0) return rank;
    const so = (a.sort_order || 0) - (b.sort_order || 0);
    if (so !== 0) return so;
    return Number(a.goldbridge_item_id) - Number(b.goldbridge_item_id);
  });
}
