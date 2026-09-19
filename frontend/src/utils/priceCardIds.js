/** Shared goldbridge / shop card ids. Keep in sync with backend price_cards.py */
export const SPECIAL_MOTAFEREGHE_ID = 900001;
export const SPECIAL_NAGHD_KARTKHAN_ID = 900002;
/** Farshad hidden master — legacy formula source (id:1). */
export const SOURCE_MIRROR_ITEM_ID = 1;
/** Goldbridge stable alias for tomorrow Farshad نقدی (نقد فردا / GET /price). */
export const MAIN_CASH_ITEM_ID = 900000;
/** @deprecated use MAIN_CASH_ITEM_ID */
export const FARSHAD_TRADE_CASH_ITEM_ID = MAIN_CASH_ITEM_ID;
export const LEGACY_WEEKDAY_CASH_ITEM_IDS = new Set([1009, 1010, 1011, 1012, 1013]);
/** @deprecated */
export const LEGACY_MAIN_CASH_ITEM_IDS = LEGACY_WEEKDAY_CASH_ITEM_IDS;

/** Shop main card only — goldbridge 900000 (نقد فردا). Not Farshad weekday ids. */
export function isMainCashItemId(id) {
  return Number(id) === MAIN_CASH_ITEM_ID;
}

export function isLegacyWeekdayCashId(id) {
  return LEGACY_WEEKDAY_CASH_ITEM_IDS.has(Number(id));
}

export function isFarshadTradeTile(card) {
  return !!(card?.is_farshad_trade_tile || isMainCashItemId(card?.goldbridge_item_id));
}

export function isFarshadHiddenMaster(card) {
  return !!(card?.is_farshad_hidden_master || Number(card?.goldbridge_item_id) === SOURCE_MIRROR_ITEM_ID);
}

/** Organized shop cards stay fully open in admin; weekday leftovers collapse. */
export function isPrimaryAdminCard(card) {
  const id = Number(card?.goldbridge_item_id);
  return (
    isMainCashItemId(id)
    || id === SPECIAL_NAGHD_KARTKHAN_ID
    || id === SPECIAL_MOTAFEREGHE_ID
    || id === SOURCE_MIRROR_ITEM_ID
  );
}

/**
 * Customer + admin order:
 * 1) نقد فردا (900000)
 * 2) نقد کارتخوان (900002)
 * 3) متفرقه (900001)
 * then everything else.
 */
export function priceCardRank(card) {
  const id = Number(card?.goldbridge_item_id);
  if (isMainCashItemId(id)) return 0;
  if (id === SPECIAL_NAGHD_KARTKHAN_ID) return 1;
  if (id === SPECIAL_MOTAFEREGHE_ID) return 2;
  if (id === SOURCE_MIRROR_ITEM_ID) return 3;
  if (isLegacyWeekdayCashId(id)) return 6;
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

/**
 * Trader UI action sides for a card.
 * - متفرقه (900001): sell only (بفروشید)
 * - نقد کارتخوان (900002): buy only (بخرید)
 * - everything else: both
 */
export function cardActionSideMode(card) {
  const id = Number(card?.goldbridge_item_id);
  if (id === SPECIAL_MOTAFEREGHE_ID) return "sell";
  if (id === SPECIAL_NAGHD_KARTKHAN_ID) return "buy";
  return "both";
}
