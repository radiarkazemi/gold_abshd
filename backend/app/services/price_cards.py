"""
Polls goldbridge's /prices (ALL items) on an interval, and manages
which of those items are shown to customers as "price cards" and
which side(s) of which cards customers can actually place orders
against.

Any number of cards may be orderable simultaneously now, each with
independent buy/sell toggles (see PriceCard in models_db.py). Gold
items (type=1) trade in گرم۱۸ against the existing balance ledger.
Coin items (type=2) trade by count against their OWN separate
per-item ledger - see BalanceTransaction.goldbridge_item_id and
services/orders.py.
"""
import asyncio
import logging
from datetime import datetime, timezone

import httpx
from sqlalchemy.orm import Session

from app.config import settings
from app.gold_conversion import mesghal17_to_gram18

logger = logging.getLogger(__name__)

GOLD_ITEM_TYPE = 1
COIN_ITEM_TYPE = 2

_latest_items: dict[int, dict] = {}   # goldbridge_item_id -> cleaned item
_latest_updated_at: str | None = None
_lock = asyncio.Lock()


def get_raw_items() -> dict[int, dict]:
    return _latest_items


def get_raw_item(goldbridge_item_id: int) -> dict | None:
    return _latest_items.get(goldbridge_item_id)


def get_updated_at() -> str | None:
    return _latest_updated_at


def is_coin_item(goldbridge_item_id: int) -> bool:
    item = _latest_items.get(goldbridge_item_id)
    return bool(item and item["type"] == COIN_ITEM_TYPE)


_bootstrap_attempted = False


def _maybe_bootstrap_default_card(cleaned_items: dict[int, dict]) -> None:
    """
    Runs after every successful poll, but only actually does anything
    ONCE per process, and only if the DB has zero PriceCard rows at
    all - i.e. a genuinely fresh install or an upgrade from before
    this feature existed.
    """
    global _bootstrap_attempted
    if _bootstrap_attempted or not settings.DEFAULT_ORDERABLE_ITEM_ID:
        return
    _bootstrap_attempted = True

    from app.db import SessionLocal
    from app.models_db import PriceCard

    db = SessionLocal()
    try:
        if db.query(PriceCard).count() > 0:
            return  # admin has already configured cards - never override that

        try:
            default_id = int(settings.DEFAULT_ORDERABLE_ITEM_ID)
        except ValueError:
            logger.warning("[price-cards] GOLDAPP_DEFAULT_ORDERABLE_ITEM_ID is not a valid integer, skipping bootstrap")
            return

        if default_id not in cleaned_items:
            logger.warning(
                f"[price-cards] bootstrap item id={default_id} not found in the first poll - "
                f"skipping auto-setup, an admin will need to enable a card manually"
            )
            return

        set_card_enabled(db, default_id, True, sort_order=0)
        set_card_orderable_sides(db, default_id, True, True)
        logger.info(f"[price-cards] auto-enabled item id={default_id} as orderable (first-run bootstrap)")
    finally:
        db.close()


async def poll_all_items():
    """Background task - call this once from main.py's startup."""
    if settings.PRICE_SOURCE.lower() != "api":
        logger.info("[price-cards] GOLDAPP_PRICE_SOURCE is not 'api' - price cards feature is inactive")
        return
    if not settings.PRICE_API_ALL_URL:
        logger.warning("[price-cards] GOLDAPP_PRICE_API_ALL_URL not set - price cards feature is inactive")
        return

    headers = {}
    if settings.PRICE_API_KEY:
        headers["Authorization"] = f"Bearer {settings.PRICE_API_KEY}"

    backoff = settings.PRICE_API_POLL_SECONDS
    async with httpx.AsyncClient(timeout=10) as client:
        while True:
            try:
                resp = await client.get(settings.PRICE_API_ALL_URL, headers=headers)
                resp.raise_for_status()
                data = resp.json()
                items = data.get("prices") or []

                cleaned = {}
                for item in items:
                    item_id = item.get("id")
                    if item_id is None:
                        continue
                    buy = item.get("buy")
                    sell = item.get("sell")
                    if settings.PRICE_API_RIAL_TO_TOMAN and buy is not None and sell is not None:
                        buy = buy / 10
                        sell = sell / 10
                    cleaned[item_id] = {
                        "goldbridge_item_id": item_id,
                        "name": item.get("name"),
                        "type": item.get("type"),
                        "ayar": item.get("ayar"),
                        "item_weight": item.get("item_weight"),
                        "buy": buy,
                        "sell": sell,
                        "allow_buy": bool(item.get("allow_buy")),
                        "allow_sell": bool(item.get("allow_sell")),
                        "active": bool(item.get("active")),
                        "last_update_time": item.get("last_update_time"),
                    }

                async with _lock:
                    global _latest_items, _latest_updated_at
                    _latest_items = cleaned
                    _latest_updated_at = datetime.now(timezone.utc).isoformat()

                _maybe_bootstrap_default_card(cleaned)

                backoff = settings.PRICE_API_POLL_SECONDS
            except Exception as e:
                logger.warning(f"[price-cards] fetch failed: {type(e).__name__}: {e}")
                backoff = min(backoff * 2, 60)

            await asyncio.sleep(backoff)


def item_price_with_commission(item: dict, side: str, commission_type: str, commission_value: float) -> float:
    """Same +/- commission formula used everywhere else, generalized
    to any goldbridge item (gold or coin) instead of assuming a single
    global one."""
    raw = item["buy"] if side == "buy" else item["sell"]
    commission = raw * (commission_value / 100) if commission_type == "percentage" else commission_value
    return raw + commission if side == "buy" else raw - commission


# --- Admin management (PriceCard rows) ---

def effective_orderable(card, item: dict) -> tuple[bool, bool]:
    """
    The final (buy, sell) orderable state after combining this app's
    own toggle with goldbridge's own allow_buy/allow_sell - unless
    override_source_restriction is set, in which case this app's
    toggle alone decides. Used both for the customer-facing broadcast
    AND at order-submit time (routers/orders.py) so the two can never
    disagree.
    """
    if card.override_source_restriction:
        return bool(card.orderable_buy), bool(card.orderable_sell)
    return (
        bool(card.orderable_buy) and item.get("allow_buy", False),
        bool(card.orderable_sell) and item.get("allow_sell", False),
    )


def list_admin_cards(db: Session) -> list[dict]:
    """Every currently-known goldbridge item, joined with this app's
    enabled/orderable choices for it (defaults if no PriceCard row
    exists yet)."""
    from app.models_db import PriceCard

    existing = {c.goldbridge_item_id: c for c in db.query(PriceCard).all()}
    result = []
    for item_id, item in sorted(_latest_items.items()):
        card = existing.get(item_id)
        result.append({
            **item,
            "display_name": (card.display_name if card and card.display_name else item["name"]),
            "is_enabled": bool(card.is_enabled) if card else False,
            "orderable_buy": bool(card.orderable_buy) if card else False,
            "orderable_sell": bool(card.orderable_sell) if card else False,
            "override_source_restriction": bool(card.override_source_restriction) if card else False,
            "sort_order": card.sort_order if card else 0,
        })
    return result


def _get_or_create_card(db: Session, goldbridge_item_id: int):
    from app.models_db import PriceCard

    card = db.query(PriceCard).filter(PriceCard.goldbridge_item_id == goldbridge_item_id).first()
    if not card:
        card = PriceCard(goldbridge_item_id=goldbridge_item_id)
        db.add(card)
    return card


def set_card_enabled(db: Session, goldbridge_item_id: int, is_enabled: bool,
                      display_name: str | None = None, sort_order: int | None = None):
    card = _get_or_create_card(db, goldbridge_item_id)
    card.is_enabled = is_enabled
    if display_name is not None:
        card.display_name = display_name or None
    if sort_order is not None:
        card.sort_order = sort_order
    db.commit()


def set_card_orderable_sides(db: Session, goldbridge_item_id: int, orderable_buy: bool, orderable_sell: bool):
    """
    Independent per-side switches - a card can allow buying but not
    selling, or vice versa, or neither, or both. Any number of cards
    may have either flag set; there's no exclusivity between cards
    anymore. Turning either side on also enables the card's display
    (a card orderable on some side should obviously be visible).
    """
    if goldbridge_item_id not in _latest_items:
        raise ValueError("این آیتم در حال حاضر از goldbridge دریافت نشده است")

    card = _get_or_create_card(db, goldbridge_item_id)
    card.orderable_buy = orderable_buy
    card.orderable_sell = orderable_sell
    if orderable_buy or orderable_sell:
        card.is_enabled = True
    db.commit()


def set_card_override(db: Session, goldbridge_item_id: int, override: bool):
    """
    When True, this app's own orderable_buy/orderable_sell are final
    for this card - goldbridge's own allow_buy/allow_sell flags are
    ignored. Admin's explicit choice, off by default.
    """
    if goldbridge_item_id not in _latest_items:
        raise ValueError("این آیتم در حال حاضر از goldbridge دریافت نشده است")

    card = _get_or_create_card(db, goldbridge_item_id)
    card.override_source_restriction = override
    db.commit()


def get_card_state(db: Session, goldbridge_item_id: int):
    from app.models_db import PriceCard
    return db.query(PriceCard).filter(PriceCard.goldbridge_item_id == goldbridge_item_id).first()


def build_broadcast_payload(db: Session) -> dict:
    """
    {"cards": [...], "updated_at": ...} sent to customers via both
    GET /api/price and every /ws/price frame. Each card carries its own
    orderable_buy/orderable_sell/is_primary flags - the frontend renders
    every enabled card the same way, sized differently only for
    whichever one is_primary (the lowest sort_order).
    """
    return {
        "cards": get_enabled_cards_for_broadcast(db),
        "updated_at": _latest_updated_at,
    }


def get_enabled_cards_for_broadcast(db: Session) -> list[dict]:
    from app.models_db import PriceCard

    cards = (
        db.query(PriceCard)
        .filter(PriceCard.is_enabled == True)  # noqa: E712
        .order_by(PriceCard.sort_order, PriceCard.created_at)
        .all()
    )
    result = []
    for i, card in enumerate(cards):
        item = _latest_items.get(card.goldbridge_item_id)
        if not item or item["buy"] is None or item["sell"] is None:
            continue
        is_gold = item["type"] == GOLD_ITEM_TYPE
        buy_ok, sell_ok = effective_orderable(card, item)
        result.append({
            "goldbridge_item_id": card.goldbridge_item_id,
            "name": card.display_name or item["name"],
            "type": item["type"],
            "unit": "count" if item["type"] == COIN_ITEM_TYPE else "gram18",
            "item_weight": item.get("item_weight"),
            "is_primary": i == 0,
            "orderable_buy": buy_ok,
            "orderable_sell": sell_ok,
            "buy_price": item["buy"],
            "sell_price": item["sell"],
            "gram18_buy_price": mesghal17_to_gram18(item["buy"]) if is_gold else None,
            "gram18_sell_price": mesghal17_to_gram18(item["sell"]) if is_gold else None,
        })
    return result