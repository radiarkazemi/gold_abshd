/** Shared shop card ids — keep in sync with backend price_cards.py */

export const SPECIAL_MOTAFEREGHE_ID = 900001;
export const SPECIAL_NAGHD_KARTKHAN_ID = 900002;
/** Goldbridge stable alias for the shop's main/daily نقدی (آبشده). */
export const MAIN_CASH_ITEM_ID = 900000;
/** sort_order 1..PIN_SORT_MAX = user-pinned (shown after main daily). */
export const PIN_SORT_MAX = 50;
/** Default sort_order when unpinning a normal card. */
export const UNPINNED_SORT_ORDER = 100;
/** Default ranks for specials — must stay ABOVE PIN_SORT_MAX. */
export const SPECIAL_SORT_ORDER = {
  [SPECIAL_NAGHD_KARTKHAN_ID]: 60,
  [SPECIAL_MOTAFEREGHE_ID]: 61,
};

export function isMainCashCard(cardOrId) {
  const id = typeof cardOrId === "object" && cardOrId
    ? Number(cardOrId.goldbridge_item_id)
    : Number(cardOrId);
  return id === MAIN_CASH_ITEM_ID;
}

export function isSpecialMirroredId(id) {
  const n = Number(id);
  return n === SPECIAL_MOTAFEREGHE_ID || n === SPECIAL_NAGHD_KARTKHAN_ID;
}

/** User-pinned via sort_order (main daily is ranked separately). */
export function isPinnedCard(card) {
  if (!card || isMainCashCard(card)) return false;
  const so = Number(card.sort_order) || 0;
  return so > 0 && so <= PIN_SORT_MAX;
}

/** Restore sort_order when unpinning (specials keep their default ranks). */
export function unpinSortOrder(card) {
  const id = Number(card?.goldbridge_item_id);
  if (SPECIAL_SORT_ORDER[id] != null) return SPECIAL_SORT_ORDER[id];
  return UNPINNED_SORT_ORDER;
}

/**
 * Admin / shop list order:
 * 1) main daily نقدی (900000)
 * 2) user-pinned cards (incl. pinned specials)
 * 3) نقد کارتخوان
 * 4) متفرقه
 * 5) other enabled/orderable
 * 6) the rest
 */
export function priceCardRank(card) {
  const id = Number(card?.goldbridge_item_id);
  if (isMainCashCard(id)) return 0;
  if (isPinnedCard(card)) return 1;
  if (id === SPECIAL_NAGHD_KARTKHAN_ID) return 2;
  if (id === SPECIAL_MOTAFEREGHE_ID) return 3;
  if (card?.is_enabled || card?.orderable_buy || card?.orderable_sell) return 4;
  return 5;
}

export function sortPriceCards(cards) {
  return [...(cards || [])].sort((a, b) => {
    const rank = priceCardRank(a) - priceCardRank(b);
    if (rank !== 0) return rank;
    const so = (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0);
    if (so !== 0) return so;
    return Number(a.goldbridge_item_id) - Number(b.goldbridge_item_id);
  });
}

/** Next sort_order for a newly pinned card (lower = higher among pins). */
export function nextPinSortOrder(cards) {
  const used = (cards || [])
    .filter(isPinnedCard)
    .map((c) => Number(c.sort_order) || 0);
  if (!used.length) return PIN_SORT_MAX;
  const next = Math.min(...used) - 1;
  return next >= 1 ? next : 1;
}
