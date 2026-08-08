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
from app.gold_conversion import mesghal17_to_gram18, motaferaghe_to_gram18

logger = logging.getLogger(__name__)

GOLD_ITEM_TYPE = 1
COIN_ITEM_TYPE = 2

# Synthetic app-only cards that mirror another goldbridge item's price.
# Kept in a high id range so they never collide with real goldbridge ids.
SPECIAL_CARD_MOTAFEREGHE_ID = 900001       # متفرقه — sell only, گرم۱۸
SPECIAL_CARD_NAGHD_KARTKHAN_ID = 900002    # نقد کارتخوان — buy only, مثقال۱۷
DEFAULT_PRICE_SOURCE_ITEM_ID = 1
# نقد کارتخوان is always id:1 (مثقال۱۷) + this fixed markup (تومان).
NAGHD_KARTKHAN_MARKUP_TOMAN = 100_000

SPECIAL_MIRRORED_CARDS = (
    {
        "goldbridge_item_id": SPECIAL_CARD_MOTAFEREGHE_ID,
        "display_name": "متفرقه",
        "price_source_item_id": DEFAULT_PRICE_SOURCE_ITEM_ID,
        "price_label_mode": "gram18_only",
        "orderable_buy": False,
        "orderable_sell": True,
        "sort_order": 100,
    },
    {
        "goldbridge_item_id": SPECIAL_CARD_NAGHD_KARTKHAN_ID,
        "display_name": "نقد کارتخوان",
        "price_source_item_id": DEFAULT_PRICE_SOURCE_ITEM_ID,
        "price_label_mode": "mesghal17_only",
        "orderable_buy": True,
        "orderable_sell": False,
        "sort_order": 101,
    },
)

_latest_items: dict[int, dict] = {}   # goldbridge_item_id -> cleaned item
# Feed-level: time of the most recent *actual* price change from source.
_latest_updated_at: str | None = None
# Per-item: last time that item's buy/sell actually changed (not every poll).
_item_price_changed_at: dict[int, str] = {}
_lock = asyncio.Lock()


def get_raw_items() -> dict[int, dict]:
    return _latest_items


def get_raw_item(goldbridge_item_id: int) -> dict | None:
    return _latest_items.get(goldbridge_item_id)


def get_updated_at() -> str | None:
    return _latest_updated_at


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _price_equal(a, b) -> bool:
    if a is None and b is None:
        return True
    if a is None or b is None:
        return False
    try:
        return round(float(a)) == round(float(b))
    except (TypeError, ValueError):
        return a == b


def mark_item_price_changed(goldbridge_item_id: int, when: str | None = None) -> str:
    """Record that this item's quote changed — advances client 'آخرین بروزرسانی'."""
    ts = when or _now_iso()
    _item_price_changed_at[int(goldbridge_item_id)] = ts
    global _latest_updated_at
    _latest_updated_at = ts
    return ts


def item_price_changed_at(goldbridge_item_id: int | None) -> str | None:
    if goldbridge_item_id is None:
        return _latest_updated_at
    return _item_price_changed_at.get(int(goldbridge_item_id)) or _latest_updated_at


def _merge_polled_items(cleaned: dict[int, dict]) -> bool:
    """Replace cache; bump per-item timestamps only when buy/sell changed.

    Returns True if any item's quote changed (or this is the first fill).
    """
    global _latest_items, _latest_updated_at
    now = _now_iso()
    any_change = False
    for item_id, item in cleaned.items():
        prev = _latest_items.get(item_id)
        changed = (
            prev is None
            or not _price_equal(prev.get("buy"), item.get("buy"))
            or not _price_equal(prev.get("sell"), item.get("sell"))
        )
        if changed:
            _item_price_changed_at[item_id] = now
            any_change = True
        elif item_id not in _item_price_changed_at:
            # First time we see this id without a prior stamp — seed once.
            _item_price_changed_at[item_id] = now
    _latest_items = cleaned
    if _latest_updated_at is None or any_change:
        _latest_updated_at = now
    return any_change


def is_coin_item(goldbridge_item_id: int) -> bool:
    item = _latest_items.get(goldbridge_item_id)
    if item:
        return bool(item["type"] == COIN_ITEM_TYPE)
    # Synthetic mirrored cards are always gold (type=1).
    if goldbridge_item_id in (
        SPECIAL_CARD_MOTAFEREGHE_ID,
        SPECIAL_CARD_NAGHD_KARTKHAN_ID,
    ):
        return False
    return False


def is_special_mirrored_card(goldbridge_item_id: int) -> bool:
    return goldbridge_item_id in (
        SPECIAL_CARD_MOTAFEREGHE_ID,
        SPECIAL_CARD_NAGHD_KARTKHAN_ID,
    )


def ensure_special_mirrored_cards(db: Session | None = None) -> None:
    """Idempotently create متفرقه / نقد کارتخوان rows (mirror item id 1).

    Product identity fields stay synced; admin-controlled visibility
    (`is_enabled`) and side toggles are only set on first create so
    «نمایش به مشتری» unticks persist.
    """
    from app.db import SessionLocal
    from app.models_db import PriceCard

    owns_session = db is None
    if owns_session:
        db = SessionLocal()
    try:
        for spec in SPECIAL_MIRRORED_CARDS:
            card = (
                db.query(PriceCard)
                .filter(PriceCard.goldbridge_item_id == spec["goldbridge_item_id"])
                .first()
            )
            is_new = card is None
            if is_new:
                card = PriceCard(goldbridge_item_id=spec["goldbridge_item_id"])
                db.add(card)
                card.is_enabled = True
                card.orderable_buy = spec["orderable_buy"]
                card.orderable_sell = spec["orderable_sell"]
                card.sort_order = spec["sort_order"]
            # Always keep product identity / pricing rules in sync.
            card.display_name = spec["display_name"]
            card.price_source_item_id = spec["price_source_item_id"]
            card.price_label_mode = spec["price_label_mode"]
            card.override_source_restriction = True
            # Mirrored cards always follow the source feed — not own manuals.
            card.use_manual_price = False
            if card.sort_order is None or card.sort_order == 0:
                card.sort_order = spec["sort_order"]
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        if owns_session:
            db.close()


def is_motaferaghe_card(goldbridge_item_id: int | None) -> bool:
    return goldbridge_item_id == SPECIAL_CARD_MOTAFEREGHE_ID


def is_naghd_kartkhan_card(goldbridge_item_id: int | None) -> bool:
    return goldbridge_item_id == SPECIAL_CARD_NAGHD_KARTKHAN_ID

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
                    _merge_polled_items(cleaned)

                _maybe_bootstrap_default_card(cleaned)
                try:
                    ensure_special_mirrored_cards()
                except Exception as seed_err:
                    logger.warning(f"[price-cards] special card seed failed: {seed_err}")

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


def resolve_effective_item(card, item: dict | None) -> dict | None:
    """
    Pick live goldbridge prices, mirrored source prices, or admin manuals.

    Live quotes are used whenever buy/sell exist - goldbridge's own
    `active` flag is informational only (shown in admin UI) and must
    NOT hide priced items from customers (most coins sit at active=False
    while still carrying valid buy/sell).

    Manual wins when the admin explicitly enables use_manual_price, or
    as a fallback when the live feed has no buy/sell at all but manuals
    are filled in.

    Mirrored cards (price_source_item_id) copy buy/sell from the source
    item while keeping this card's own goldbridge_item_id for orders /
    commissions.
    """
    source_item = item
    if card and getattr(card, "price_source_item_id", None):
        mirrored = _latest_items.get(int(card.price_source_item_id))
        if mirrored:
            source_item = mirrored

    has_live_prices = bool(
        source_item
        and source_item.get("buy") is not None
        and source_item.get("sell") is not None
    )
    # متفرقه only needs the source BUY quote (used for its بفروشید side).
    is_motaferaghe = bool(card and is_motaferaghe_card(card.goldbridge_item_id))
    is_naghd = bool(card and is_naghd_kartkhan_card(card.goldbridge_item_id))
    if is_motaferaghe and source_item and source_item.get("buy") is not None:
        has_live_prices = True
    # نقد کارتخوان is buy-only and mirrors id:1 buy (+ fixed markup).
    if is_naghd and source_item and source_item.get("buy") is not None:
        has_live_prices = True
    manuals_ok = bool(
        card
        and card.manual_buy is not None
        and card.manual_sell is not None
    )
    use_manual = bool(card and card.use_manual_price and manuals_ok) or (
        not has_live_prices and manuals_ok
    )
    if use_manual:
        base = dict(source_item) if source_item else {
            "goldbridge_item_id": card.goldbridge_item_id,
            "name": card.display_name or f"#{card.goldbridge_item_id}",
            "type": GOLD_ITEM_TYPE,
            "ayar": None,
            "item_weight": None,
            "allow_buy": True,
            "allow_sell": True,
            "active": True,
        }
        base["goldbridge_item_id"] = card.goldbridge_item_id
        if card.display_name:
            base["name"] = card.display_name
        base["buy"] = float(card.manual_buy)
        base["sell"] = float(card.manual_sell)
        base["price_source"] = "manual"
        base["active"] = True
        return base
    if has_live_prices:
        out = dict(source_item)
        if card:
            out["goldbridge_item_id"] = card.goldbridge_item_id
            if card.display_name:
                out["name"] = card.display_name
        if card and getattr(card, "price_source_item_id", None):
            out["price_source"] = "mirrored"
            out["mirrored_from"] = int(card.price_source_item_id)
            # Mirrored cards ignore goldbridge allow flags for the source.
            out["allow_buy"] = True
            out["allow_sell"] = True
        else:
            out["price_source"] = "live"
        if is_motaferaghe:
            # متفرقه بفروشید always uses id:1 بخرید price as the base quote.
            buy = float(source_item["buy"])
            out["buy"] = buy
            out["sell"] = buy
            out["pricing_mode"] = "motaferaghe_sell"
            if out.get("sell") is None:
                out["sell"] = buy
        elif is_naghd:
            # Raw mirror of id:1 بخرید. Markup (+100k) is applied AFTER
            # commission in personalizePrice / _price_gold_order.
            buy = float(source_item["buy"])
            out["buy"] = buy
            out["sell"] = buy
            out["pricing_mode"] = "naghd_kartkhan_buy"
            out["markup_toman"] = NAGHD_KARTKHAN_MARKUP_TOMAN
        return out
    return None


# --- Admin management (PriceCard rows) ---

def effective_orderable(card, item: dict) -> tuple[bool, bool]:
    """
    The final (buy, sell) orderable state after combining this app's
    own toggle with goldbridge's own allow_buy/allow_sell - unless
    override_source_restriction is set OR prices are manual/mirrored,
    in which case this app's toggle alone decides.
    """
    source = (item or {}).get("price_source")
    if (
        card.override_source_restriction
        or source == "manual"
        or source == "mirrored"
    ):
        return bool(card.orderable_buy), bool(card.orderable_sell)
    return (
        bool(card.orderable_buy) and item.get("allow_buy", False),
        bool(card.orderable_sell) and item.get("allow_sell", False),
    )


def _role_commissions_for_card(db: Session, goldbridge_item_id: int, roles: list) -> list[dict]:
    from app.models_db import PriceCardCommission

    overrides = {
        row.role_id: row
        for row in db.query(PriceCardCommission)
        .filter(PriceCardCommission.goldbridge_item_id == goldbridge_item_id)
        .all()
    }
    result = []
    for role in roles:
        ov = overrides.get(role.id)
        ctype = ov.commission_type if ov else role.commission_type
        result.append({
            "role_id": role.id,
            "role_name": role.name,
            "commission_type": ctype.value if hasattr(ctype, "value") else ctype,
            "commission_value": float(ov.commission_value if ov else role.commission_value),
            "can_order": bool(ov.can_order) if ov else True,
            "is_override": ov is not None,
        })
    return result


def list_admin_cards(db: Session) -> list[dict]:
    """Every known goldbridge item + enabled/mirrored/manual-only cards, with
    admin toggles, manuals, and per-role commission overrides."""
    from app.models_db import PriceCard, Role

    ensure_special_mirrored_cards(db)

    existing = {c.goldbridge_item_id: c for c in db.query(PriceCard).all()}
    roles = db.query(Role).order_by(Role.name).all()
    result = []
    seen = set()

    for item_id, item in sorted(_latest_items.items()):
        seen.add(item_id)
        card = existing.get(item_id)
        effective = resolve_effective_item(card, item)
        result.append({
            **item,
            "goldbridge_item_id": item_id,
            "display_name": (card.display_name if card and card.display_name else item["name"]),
            "is_enabled": bool(card.is_enabled) if card else False,
            "orderable_buy": bool(card.orderable_buy) if card else False,
            "orderable_sell": bool(card.orderable_sell) if card else False,
            "override_source_restriction": bool(card.override_source_restriction) if card else False,
            "use_manual_price": bool(card.use_manual_price) if card else False,
            "manual_buy": card.manual_buy if card else None,
            "manual_sell": card.manual_sell if card else None,
            "price_source_item_id": card.price_source_item_id if card else None,
            "price_label_mode": card.price_label_mode if card else None,
            "live_buy": item.get("buy"),
            "live_sell": item.get("sell"),
            "buy": effective["buy"] if effective else item.get("buy"),
            "sell": effective["sell"] if effective else item.get("sell"),
            "price_source": effective["price_source"] if effective else "unavailable",
            "sort_order": card.sort_order if card else 0,
            "role_commissions": _role_commissions_for_card(db, item_id, roles),
        })

    for item_id, card in existing.items():
        if item_id in seen:
            continue
        # Always include mirrored specials + any enabled/manual extras.
        is_mirrored = bool(getattr(card, "price_source_item_id", None))
        if not card.is_enabled and not card.use_manual_price and not is_mirrored:
            continue
        effective = resolve_effective_item(card, None)
        if not effective:
            # Still show the admin row so commissions can be set before feed is up.
            result.append({
                "goldbridge_item_id": item_id,
                "name": card.display_name or f"#{item_id}",
                "display_name": card.display_name or f"#{item_id}",
                "type": GOLD_ITEM_TYPE,
                "ayar": None,
                "item_weight": None,
                "buy": None,
                "sell": None,
                "live_buy": None,
                "live_sell": None,
                "allow_buy": True,
                "allow_sell": True,
                "active": False,
                "is_enabled": bool(card.is_enabled),
                "orderable_buy": bool(card.orderable_buy),
                "orderable_sell": bool(card.orderable_sell),
                "override_source_restriction": bool(card.override_source_restriction),
                "use_manual_price": bool(card.use_manual_price),
                "manual_buy": card.manual_buy,
                "manual_sell": card.manual_sell,
                "price_source_item_id": card.price_source_item_id,
                "price_label_mode": card.price_label_mode,
                "price_source": "unavailable",
                "sort_order": card.sort_order,
                "role_commissions": _role_commissions_for_card(db, item_id, roles),
            })
            continue
        result.append({
            "goldbridge_item_id": item_id,
            "name": card.display_name or effective.get("name") or f"#{item_id}",
            "display_name": card.display_name or effective.get("name") or f"#{item_id}",
            "type": effective.get("type", GOLD_ITEM_TYPE),
            "ayar": effective.get("ayar"),
            "item_weight": effective.get("item_weight"),
            "buy": effective["buy"],
            "sell": effective["sell"],
            "live_buy": None,
            "live_sell": None,
            "allow_buy": True,
            "allow_sell": True,
            "active": True,
            "is_enabled": bool(card.is_enabled),
            "orderable_buy": bool(card.orderable_buy),
            "orderable_sell": bool(card.orderable_sell),
            "override_source_restriction": bool(card.override_source_restriction),
            "use_manual_price": bool(card.use_manual_price),
            "manual_buy": card.manual_buy,
            "manual_sell": card.manual_sell,
            "price_source_item_id": card.price_source_item_id,
            "price_label_mode": card.price_label_mode,
            "price_source": effective.get("price_source", "mirrored"),
            "sort_order": card.sort_order,
            "role_commissions": _role_commissions_for_card(db, item_id, roles),
        })

    result.sort(key=lambda c: (c.get("sort_order") or 0, c.get("goldbridge_item_id") or 0))
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
    card = _get_or_create_card(db, goldbridge_item_id)
    has_source = goldbridge_item_id in _latest_items or bool(getattr(card, "price_source_item_id", None))
    has_manuals = card.manual_buy is not None and card.manual_sell is not None
    if not has_source and not has_manuals:
        raise ValueError("این آیتم در حال حاضر از goldbridge دریافت نشده است")

    card.orderable_buy = orderable_buy
    card.orderable_sell = orderable_sell
    if orderable_buy or orderable_sell:
        card.is_enabled = True
    db.commit()


def set_card_override(db: Session, goldbridge_item_id: int, override: bool):
    card = _get_or_create_card(db, goldbridge_item_id)
    card.override_source_restriction = override
    db.commit()


def set_card_manual_price(
    db: Session,
    goldbridge_item_id: int,
    use_manual_price: bool,
    manual_buy: float | None,
    manual_sell: float | None,
):
    if use_manual_price:
        if manual_buy is None or manual_sell is None:
            raise ValueError("برای قیمت دستی، هر دو قیمت خرید و فروش لازم است")
        if manual_buy <= 0 or manual_sell <= 0:
            raise ValueError("قیمت دستی باید بزرگتر از صفر باشد")
    card = _get_or_create_card(db, goldbridge_item_id)
    card.use_manual_price = use_manual_price
    card.manual_buy = manual_buy
    card.manual_sell = manual_sell
    if use_manual_price:
        card.is_enabled = True
    mark_item_price_changed(goldbridge_item_id)
    db.commit()


def set_card_role_commission(
    db: Session,
    goldbridge_item_id: int,
    role_id: str,
    commission_type: str,
    commission_value: float,
    can_order: bool = True,
):
    from app.models_db import PriceCardCommission, Role, CommissionTypeEnum

    if commission_type not in ("fixed", "percentage"):
        raise ValueError("نوع کمیسیون نامعتبر است")
    role = db.query(Role).filter(Role.id == role_id).first()
    if not role:
        raise ValueError("دسته‌بندی پیدا نشد")

    _get_or_create_card(db, goldbridge_item_id)
    row = (
        db.query(PriceCardCommission)
        .filter(
            PriceCardCommission.goldbridge_item_id == goldbridge_item_id,
            PriceCardCommission.role_id == role_id,
        )
        .first()
    )
    if not row:
        row = PriceCardCommission(goldbridge_item_id=goldbridge_item_id, role_id=role_id)
        db.add(row)
    row.commission_type = CommissionTypeEnum(commission_type)
    row.commission_value = float(commission_value)
    row.can_order = bool(can_order)
    db.commit()


def resolve_commission_for_user(db: Session, user, goldbridge_item_id: int) -> tuple[str, float]:
    from app.models_db import PriceCardCommission

    if not user or not user.role:
        return "fixed", 0.0
    ov = (
        db.query(PriceCardCommission)
        .filter(
            PriceCardCommission.goldbridge_item_id == goldbridge_item_id,
            PriceCardCommission.role_id == user.role_id,
        )
        .first()
    )
    if ov:
        return ov.commission_type.value, float(ov.commission_value)
    return user.role.commission_type.value, float(user.role.commission_value)


def resolve_can_order_for_user(db: Session, user, card, effective_item: dict | None) -> bool:
    """
    When a card is on manual prices, admin can allow/deny each role
    (دسته بندی) from placing orders. Live-feed cards ignore this and
    use the normal orderable_buy/sell toggles for everyone.
    """
    from app.models_db import PriceCardCommission

    if not effective_item or effective_item.get("price_source") != "manual":
        return True
    if not user or not getattr(user, "role_id", None):
        return False
    ov = (
        db.query(PriceCardCommission)
        .filter(
            PriceCardCommission.goldbridge_item_id == card.goldbridge_item_id,
            PriceCardCommission.role_id == user.role_id,
        )
        .first()
    )
    if ov is None:
        return True
    return bool(ov.can_order)


def card_commissions_for_user(db: Session, user) -> list[dict]:
    from app.models_db import PriceCard, PriceCardCommission

    if not user or not user.role:
        return []
    cards = db.query(PriceCard).filter(PriceCard.is_enabled == True).all()  # noqa: E712
    overrides = {
        row.goldbridge_item_id: row
        for row in db.query(PriceCardCommission)
        .filter(PriceCardCommission.role_id == user.role_id)
        .all()
    }
    default_type = user.role.commission_type.value
    default_value = float(user.role.commission_value)
    result = []
    for card in cards:
        ov = overrides.get(card.goldbridge_item_id)
        effective = resolve_effective_item(card, _latest_items.get(card.goldbridge_item_id))
        is_manual = bool(effective and effective.get("price_source") == "manual")
        can_order = True
        if is_manual:
            can_order = bool(ov.can_order) if ov is not None else True
        result.append({
            "goldbridge_item_id": card.goldbridge_item_id,
            "commission_type": ov.commission_type.value if ov else default_type,
            "commission_value": float(ov.commission_value) if ov else default_value,
            "can_order": can_order,
        })
    return result


def get_card_state(db: Session, goldbridge_item_id: int):
    from app.models_db import PriceCard
    return db.query(PriceCard).filter(PriceCard.goldbridge_item_id == goldbridge_item_id).first()


def build_broadcast_payload(db: Session) -> dict:
    return {
        "cards": get_enabled_cards_for_broadcast(db),
        "updated_at": _latest_updated_at,
    }


def get_enabled_cards_for_broadcast(db: Session) -> list[dict]:
    from app.models_db import PriceCard

    ensure_special_mirrored_cards(db)

    cards = (
        db.query(PriceCard)
        .filter(PriceCard.is_enabled == True)  # noqa: E712
        .order_by(PriceCard.sort_order, PriceCard.created_at)
        .all()
    )
    result = []
    for i, card in enumerate(cards):
        item = resolve_effective_item(card, _latest_items.get(card.goldbridge_item_id))
        if not item or item.get("buy") is None or item.get("sell") is None:
            continue
        is_gold = item.get("type", GOLD_ITEM_TYPE) == GOLD_ITEM_TYPE
        buy_ok, sell_ok = effective_orderable(card, item)
        buy = item["buy"]
        sell = item["sell"]
        if is_gold and is_motaferaghe_card(card.goldbridge_item_id):
            # Raw (pre-commission) گرم۱۸ uses the متفرقه divisor; commission
            # is applied client/server as (price + commission) / 4.39.
            gram18_buy = motaferaghe_to_gram18(buy)
            gram18_sell = motaferaghe_to_gram18(sell)
            pricing_mode = "motaferaghe_sell"
        elif is_gold and is_naghd_kartkhan_card(card.goldbridge_item_id):
            gram18_buy = mesghal17_to_gram18(buy)
            gram18_sell = mesghal17_to_gram18(sell)
            pricing_mode = "naghd_kartkhan_buy"
        elif is_gold:
            gram18_buy = mesghal17_to_gram18(buy)
            gram18_sell = mesghal17_to_gram18(sell)
            pricing_mode = None
        else:
            gram18_buy = None
            gram18_sell = None
            pricing_mode = None
        # Clock freezes until this card's source quote actually changes.
        source_id = card.price_source_item_id or card.goldbridge_item_id
        card_updated_at = item_price_changed_at(source_id)
        result.append({
            "goldbridge_item_id": card.goldbridge_item_id,
            "name": card.display_name or item.get("name") or f"#{card.goldbridge_item_id}",
            "type": item.get("type", GOLD_ITEM_TYPE),
            "unit": "count" if item.get("type") == COIN_ITEM_TYPE else "gram18",
            "item_weight": item.get("item_weight"),
            "is_primary": i == 0,
            "orderable_buy": buy_ok,
            "orderable_sell": sell_ok,
            "buy_price": buy,
            "sell_price": sell,
            "gram18_buy_price": gram18_buy,
            "gram18_sell_price": gram18_sell,
            "price_source": item.get("price_source", "live"),
            "price_label_mode": card.price_label_mode,
            "price_source_item_id": card.price_source_item_id,
            "pricing_mode": pricing_mode,
            "updated_at": card_updated_at,
        })
    return result
