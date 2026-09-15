/** Shared goldbridge / shop card ids. Keep in sync with backend price_cards.py */
export const SPECIAL_MOTAFEREGHE_ID = 900001;
export const SPECIAL_NAGHD_KARTKHAN_ID = 900002;
/** Farshad hidden master — legacy formula source (id:1). */
export const SOURCE_MIRROR_ITEM_ID = 1;
/** Goldbridge stable alias for tomorrow Farshad نقدی (GET /price). */
export const MAIN_CASH_ITEM_ID = 900000;
/** @deprecated use MAIN_CASH_ITEM_ID */
export const FARSHAD_TRADE_CASH_ITEM_ID = MAIN_CASH_ITEM_ID;
export const LEGACY_MAIN_CASH_ITEM_IDS = new Set([1009, 1010, 1011, 1012, 1013]);

export function isMainCashItemId(id) {
  const n = Number(id);
  return n === MAIN_CASH_ITEM_ID || LEGACY_MAIN_CASH_ITEM_IDS.has(n);
}

export function isFarshadTradeTile(card) {
  return !!(card?.is_farshad_trade_tile || isMainCashItemId(card?.goldbridge_item_id));
}

export function isFarshadHiddenMaster(card) {
  return !!(card?.is_farshad_hidden_master || Number(card?.goldbridge_item_id) === SOURCE_MIRROR_ITEM_ID);
}

/** Main admin cards stay fully open; everything else is title-only until ticked. */
export function isPrimaryAdminCard(card) {
  const id = Number(card?.goldbridge_item_id);
  return (
    isMainCashItemId(id)
    || id === SPECIAL_MOTAFEREGHE_ID
    || id === SPECIAL_NAGHD_KARTKHAN_ID
    || id === SOURCE_MIRROR_ITEM_ID
  );
}

/** Lower rank = earlier in admin / customer lists. Main cash is always first. */
export function priceCardRank(card) {
  const id = Number(card?.goldbridge_item_id);
  if (isMainCashItemId(id)) return 0;
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
