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
# Farshad /trade cash tile (نقدی یکشنبه). Id 1 is the hidden master.
FARSHAD_TRADE_CASH_ITEM_ID = 1013
# نقد کارتخوان is always id:1 (مثقال۱۷) + this fixed markup (تومان).
NAGHD_KARTKHAN_MARKUP_TOMAN = 100_000


def card_list_rank(item_id: int, sort_order: int | None = None, *, in_use: bool = False) -> tuple[int, int, int]:
    """Stable list order: 1013 first, then specials, then hidden master id:1."""
    iid = int(item_id or 0)
    so = int(sort_order or 0)
    if iid == FARSHAD_TRADE_CASH_ITEM_ID:
        return (0, so, iid)
    if iid == SPECIAL_CARD_MOTAFEREGHE_ID:
        return (1, so, iid)
    if iid == SPECIAL_CARD_NAGHD_KARTKHAN_ID:
        return (2, so, iid)
    if iid == DEFAULT_PRICE_SOURCE_ITEM_ID:
        return (3, so, iid)
    return (4 if in_use else 5, so, iid)


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
# Admin-typed manuals, keyed by goldbridge_item_id. Same idea as _latest_items:
# WS / mirrored cards read this instead of waiting on Postgres.
_manual_quotes: dict[int, dict] = {}
# Snapshot of PriceCard config for the 0.25s broadcast loop (no DB on hot path).
_card_config_cache: list | None = None
# After متفرقه / نقد کارتخوان rows exist and match spec, skip ensure() entirely.
_specials_ready = False


def extra_shop_margin_toman() -> float:
    """Hedge pad (Toman) applied to live goldbridge gold quotes only."""
    try:
        return max(0.0, float(getattr(settings, "EXTRA_SHOP_MARGIN_TOMAN", 0) or 0))
    except (TypeError, ValueError):
        return 0.0


def _maybe_toman(value):
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if settings.PRICE_API_RIAL_TO_TOMAN:
        number = number / 10.0
    return number


def clean_goldbridge_item(item: dict) -> dict | None:
    """Normalize one goldbridge /prices row to Toman in-app units."""
    if not item:
        return None
    item_id = item.get("id", item.get("goldbridge_item_id"))
    if item_id is None:
        return None
    buy = _maybe_toman(item.get("buy"))
    sell = _maybe_toman(item.get("sell"))
    last_update = (
        item.get("last_update_time")
        or item.get("source_updated_at")
        or item.get("updated_at")
    )
    return {
        "goldbridge_item_id": int(item_id),
        "name": item.get("name"),
        "type": item.get("type"),
        "ayar": item.get("ayar"),
        "item_weight": item.get("item_weight"),
        "buy": buy,
        "sell": sell,
        "base_price": _maybe_toman(item.get("base_price")),
        "profit": _maybe_toman(item.get("profit")),
        "master_profit": _maybe_toman(item.get("master_profit")),
        "farshad_commission": _maybe_toman(item.get("farshad_commission")),
        "farshad_spread": _maybe_toman(item.get("farshad_spread")),
        "stale": bool(item.get("stale")),
        "related_id": int(item["related_id"]) if item.get("related_id") not in (None, "") else None,
        "related_diff": _maybe_toman(item.get("related_diff")),
        "allow_buy": bool(item.get("allow_buy")),
        "allow_sell": bool(item.get("allow_sell")),
        "active": bool(item.get("active")),
        "last_update_time": last_update,
    }


def _apply_live_shop_margin(item: dict) -> dict:
    """Pad Farshad on-screen quotes. Coins and non-live rows are unchanged."""
    out = dict(item)
    out.setdefault("farshad_buy", out.get("buy"))
    out.setdefault("farshad_sell", out.get("sell"))
    if out.get("type") == COIN_ITEM_TYPE or out.get("price_source") != "live":
        out["shop_margin_toman"] = 0.0
        return out
    margin = extra_shop_margin_toman()
    out["shop_margin_toman"] = margin
    if margin <= 0:
        return out
    if out.get("buy") is not None:
        out["buy"] = float(out["buy"]) + margin
    if out.get("sell") is not None:
        out["sell"] = float(out["sell"]) - margin
    return out


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


def _parse_ts_ms(value) -> float | None:
    """Parse an ISO / space-separated timestamp to epoch ms, or None."""
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    if " " in s and "T" not in s:
        s = s.replace(" ", "T", 1)
    try:
        # Already zoned (goldbridge now emits Asia/Tehran ISO).
        if s.endswith(("z", "Z")):
            s = s[:-1] + "+00:00"
            return datetime.fromisoformat(s).timestamp() * 1000
        tail = s[10:] if len(s) > 10 else ""
        if any(ch in tail for ch in ("+", "-")):
            return datetime.fromisoformat(s).timestamp() * 1000
        # Legacy naive stamps from older goldbridge = Asia/Tehran wall clock.
        from zoneinfo import ZoneInfo
        dt = datetime.fromisoformat(s).replace(tzinfo=ZoneInfo("Asia/Tehran"))
        return dt.timestamp() * 1000
    except ValueError:
        return None


def _normalize_source_ts(value) -> str | None:
    """Normalize goldbridge last_update_time to a zoned ISO string."""
    ms = _parse_ts_ms(value)
    if ms is None:
        return None
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat()


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
    # Never fall back to the feed-level clock: that advances whenever *any*
    # item moves and would drag unrelated cards' "آخرین بروزرسانی" forward.
    return _item_price_changed_at.get(int(goldbridge_item_id))


def _item_is_manual(item_id: int) -> bool:
    """True while this item's customer quote is the admin-typed manual."""
    cached = _manual_quotes.get(int(item_id))
    if cached is not None:
        return bool(cached.get("use_manual"))
    if _card_config_cache:
        for card in _card_config_cache:
            if int(card.goldbridge_item_id) == int(item_id):
                return bool(getattr(card, "use_manual_price", False))
    return False


def _dt_to_iso(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return _normalize_source_ts(value) or value
    if getattr(value, "tzinfo", None) is None:
        value = value.replace(tzinfo=timezone.utc)
    try:
        return value.isoformat()
    except AttributeError:
        return None


def _merge_polled_items(cleaned: dict[int, dict]) -> bool:
    """Merge poll into cache; live cards follow goldbridge last_update_time.

    Manual cards keep the admin-save clock. Overwriting that stamp with
    goldbridge ``last_update_time`` made the client «آخرین بروزرسانی»
    show the source tick instead of when the admin typed the price.

    Returns True if any item's buy/sell changed (for feed-level bookkeeping).
    """
    global _latest_items, _latest_updated_at
    now = _now_iso()
    any_change = False
    newest_src_ms: float | None = None
    newest_src_ts: str | None = None

    for item_id, item in cleaned.items():
        prev = _latest_items.get(item_id)
        price_changed = (
            prev is None
            or not _price_equal(prev.get("buy"), item.get("buy"))
            or not _price_equal(prev.get("sell"), item.get("sell"))
        )
        if price_changed:
            any_change = True

        # Always keep the live row (admin UI still shows goldbridge).
        _latest_items[item_id] = item

        if _item_is_manual(item_id):
            continue

        src_ts = _normalize_source_ts(item.get("last_update_time"))
        if src_ts:
            _item_price_changed_at[item_id] = src_ts
            src_ms = _parse_ts_ms(src_ts)
            if src_ms is not None and (newest_src_ms is None or src_ms > newest_src_ms):
                newest_src_ms = src_ms
                newest_src_ts = src_ts
        elif item_id not in _item_price_changed_at:
            _item_price_changed_at[item_id] = now

    if newest_src_ts and (
        _latest_updated_at is None
        or (_parse_ts_ms(newest_src_ts) or 0) > (_parse_ts_ms(_latest_updated_at) or 0)
    ):
        _latest_updated_at = newest_src_ts
    elif _latest_updated_at is None or any_change:
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


def _remember_manual_quote(
    goldbridge_item_id: int,
    *,
    use_manual: bool,
    buy,
    sell,
    updated_at: str | None = None,
) -> None:
    _manual_quotes[int(goldbridge_item_id)] = {
        "use_manual": bool(use_manual),
        "buy": buy,
        "sell": sell,
        "updated_at": updated_at,
    }
    if use_manual and updated_at:
        mark_item_price_changed(goldbridge_item_id, updated_at)


def _hydrate_manual_quotes_from_cards(cards) -> None:
    """Fill missing cache entries only — never clobber a just-saved quote."""
    for card in cards:
        iid = int(card.goldbridge_item_id)
        ts = _dt_to_iso(getattr(card, "manual_updated_at", None))
        if iid not in _manual_quotes:
            _remember_manual_quote(
                iid,
                use_manual=bool(getattr(card, "use_manual_price", False)),
                buy=getattr(card, "manual_buy", None),
                sell=getattr(card, "manual_sell", None),
                updated_at=ts,
            )
        elif bool(getattr(card, "use_manual_price", False)) and ts:
            if iid not in _item_price_changed_at:
                mark_item_price_changed(iid, ts)


def _card_snapshot(card):
    from types import SimpleNamespace
    return SimpleNamespace(
        goldbridge_item_id=int(card.goldbridge_item_id),
        display_name=card.display_name,
        use_manual_price=bool(getattr(card, "use_manual_price", False)),
        manual_buy=getattr(card, "manual_buy", None),
        manual_sell=getattr(card, "manual_sell", None),
        price_source_item_id=getattr(card, "price_source_item_id", None),
        price_label_mode=getattr(card, "price_label_mode", None),
        is_enabled=bool(card.is_enabled),
        orderable_buy=bool(card.orderable_buy),
        orderable_sell=bool(card.orderable_sell),
        override_source_restriction=bool(getattr(card, "override_source_restriction", False)),
        sort_order=card.sort_order or 0,
        created_at=getattr(card, "created_at", None),
        manual_updated_at=getattr(card, "manual_updated_at", None),
    )


def _invalidate_card_config_cache() -> None:
    global _card_config_cache
    _card_config_cache = None


def _store_card_snapshots(rows) -> list:
    global _card_config_cache
    snaps = [_card_snapshot(c) for c in rows]
    snaps.sort(key=lambda c: (c.sort_order or 0, str(c.created_at or ""), int(c.goldbridge_item_id)))
    _card_config_cache = snaps
    return snaps


def _patch_cached_card(goldbridge_item_id: int, **fields) -> None:
    if _card_config_cache is None:
        return
    iid = int(goldbridge_item_id)
    for card in _card_config_cache:
        if int(card.goldbridge_item_id) == iid:
            for key, value in fields.items():
                setattr(card, key, value)
            return
    _invalidate_card_config_cache()


def _load_card_snapshots(db: Session) -> list:
    if _card_config_cache is not None:
        return _card_config_cache
    from app.models_db import PriceCard
    rows = db.query(PriceCard).all()
    snaps = _store_card_snapshots(rows)
    _hydrate_manual_quotes_from_cards(snaps)
    return snaps


def ensure_special_mirrored_cards(db: Session | None = None) -> None:
    """Idempotently create متفرقه / نقد کارتخوان rows (mirror item id 1).

    Product identity fields stay synced; admin-controlled visibility
    (`is_enabled`) and side toggles are only set on first create so
    «نمایش به مشتری» unticks persist.

    After the rows match spec, later calls are a no-op — the old
    always-assign + commit path rewrote these two rows on every WS tick
    (~4×/s) and blocked id:1 manual saves.
    """
    global _specials_ready
    if _specials_ready:
        return

    from app.db import SessionLocal
    from app.models_db import PriceCard

    owns_session = db is None
    if owns_session:
        db = SessionLocal()
    try:
        dirty = False
        found = 0
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
                dirty = True
            if card.display_name != spec["display_name"]:
                card.display_name = spec["display_name"]
                dirty = True
            if card.price_source_item_id != spec["price_source_item_id"]:
                card.price_source_item_id = spec["price_source_item_id"]
                dirty = True
            if card.price_label_mode != spec["price_label_mode"]:
                card.price_label_mode = spec["price_label_mode"]
                dirty = True
            if not card.override_source_restriction:
                card.override_source_restriction = True
                dirty = True
            # Mirrored cards always follow the source feed — not own manuals.
            if card.use_manual_price:
                card.use_manual_price = False
                dirty = True
            if card.sort_order is None or card.sort_order == 0:
                card.sort_order = spec["sort_order"]
                dirty = True
            found += 1
        if dirty:
            db.commit()
            _invalidate_card_config_cache()
        if found == len(SPECIAL_MIRRORED_CARDS):
            _specials_ready = True
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
                    row = clean_goldbridge_item(item)
                    if not row:
                        continue
                    cleaned[row["goldbridge_item_id"]] = row

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
    global one. Pass the buy fee for side='buy' and the sell fee for
    side='sell'."""
    raw = item["buy"] if side == "buy" else item["sell"]
    if raw is None:
        return None
    commission = raw * (commission_value / 100) if commission_type == "percentage" else commission_value
    return raw + commission if side == "buy" else raw - commission


def _commission_pair(ov, default_value: float) -> tuple[float, float]:
    """Buy/sell fees for a card×role row. Missing side-specific columns
    (or a one-sided card that only stored commission_value) fall back to
    that single value so existing prices stay the same."""
    if not ov:
        return default_value, default_value
    legacy = float(ov.commission_value if ov.commission_value is not None else default_value)
    buy = getattr(ov, "commission_buy_value", None)
    sell = getattr(ov, "commission_sell_value", None)
    return (
        float(buy) if buy is not None else legacy,
        float(sell) if sell is not None else legacy,
    )


def _get_price_card_row(goldbridge_item_id: int, db: Session | None = None):
    """Load a PriceCard by goldbridge id. Always copy fields (never return a live ORM row)."""
    from types import SimpleNamespace
    from app.models_db import PriceCard

    def as_row(row):
        if row is None:
            return None
        return SimpleNamespace(
            goldbridge_item_id=row.goldbridge_item_id,
            display_name=row.display_name,
            use_manual_price=bool(row.use_manual_price),
            manual_buy=row.manual_buy,
            manual_sell=row.manual_sell,
            price_source_item_id=None,
        )

    if db is not None:
        return as_row(
            db.query(PriceCard).filter(PriceCard.goldbridge_item_id == int(goldbridge_item_id)).first()
        )

    from app.db import SessionLocal
    session = SessionLocal()
    try:
        return as_row(
            session.query(PriceCard).filter(PriceCard.goldbridge_item_id == int(goldbridge_item_id)).first()
        )
    finally:
        session.close()


def _snapshot_price_card(card):
    """Copy the fields mirrored cards need from an ORM row or SimpleNamespace."""
    if card is None:
        return None
    from types import SimpleNamespace
    return SimpleNamespace(
        goldbridge_item_id=getattr(card, "goldbridge_item_id", None),
        display_name=getattr(card, "display_name", None),
        use_manual_price=bool(getattr(card, "use_manual_price", False)),
        manual_buy=getattr(card, "manual_buy", None),
        manual_sell=getattr(card, "manual_sell", None),
        price_source_item_id=None,
    )


def _manual_quote_for(item_id: int | None) -> dict | None:
    if item_id is None:
        return None
    return _manual_quotes.get(int(item_id))


def _mirror_base_buy(
    src_card,
    source_live: dict | None,
    source_id: int | None = None,
) -> tuple[float | None, str]:
    """
    Base مثقال buy for متفرقه / نقد کارتخوان.

    When id:1 is on manual, this is EXACTLY the buy the admin typed
    (not live goldbridge, not sell, not after commission).

    In-memory `_manual_quotes` wins over a stale ORM snapshot so the two
    mirrored cards move as soon as the admin saves id:1.
    """
    sid = source_id
    if sid is None and src_card is not None:
        sid = getattr(src_card, "goldbridge_item_id", None)
    if sid is None:
        sid = DEFAULT_PRICE_SOURCE_ITEM_ID
    cached = _manual_quote_for(sid)
    if cached is not None:
        if cached.get("use_manual") and cached.get("buy") is not None:
            return float(cached["buy"]), "manual"
    elif src_card is not None and src_card.use_manual_price and src_card.manual_buy is not None:
        return float(src_card.manual_buy), "manual"
    if source_live is not None and source_live.get("buy") is not None:
        return float(source_live["buy"]), "live"
    return None, "unavailable"


def _live_or_manual_item(card, live_item: dict | None, *, buy_only_ok: bool = False) -> dict | None:
    """
    This card's own live vs manual quotes — no mirroring.

    Manual is used only while the admin has use_manual_price enabled.
    Unticking that flag returns to goldbridge immediately; leftover
    typed numbers are not a silent fallback.
    """
    cached = _manual_quote_for(getattr(card, "goldbridge_item_id", None)) if card else None
    manual_buy = cached.get("buy") if cached and cached.get("buy") is not None else (card.manual_buy if card else None)
    manual_sell = cached.get("sell") if cached and cached.get("sell") is not None else (card.manual_sell if card else None)
    if cached is not None:
        flagged_manual = bool(cached.get("use_manual"))
    else:
        flagged_manual = bool(card and card.use_manual_price)

    has_live_buy = bool(live_item and live_item.get("buy") is not None)
    has_live_sell = bool(live_item and live_item.get("sell") is not None)
    has_live_prices = has_live_buy and (buy_only_ok or has_live_sell)

    manuals_ok = bool(card and manual_buy is not None and manual_sell is not None)
    use_manual = bool(card and flagged_manual and manuals_ok)
    if use_manual:
        base = dict(live_item) if live_item else {
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
        base["buy"] = float(manual_buy)
        base["sell"] = float(manual_sell)
        base["price_source"] = "manual"
        base["active"] = True
        return base
    if has_live_prices:
        out = dict(live_item)
        if card:
            out["goldbridge_item_id"] = card.goldbridge_item_id
            if card.display_name:
                out["name"] = card.display_name
        out["price_source"] = "live"
        out["farshad_buy"] = out.get("buy")
        out["farshad_sell"] = out.get("sell")
        return _apply_live_shop_margin(out)
    return None


def _apply_mirrored_structure(card, source_resolved: dict) -> dict:
    """Copy the source card's effective quotes onto this synthetic card.

    متفرقه / نقد کارتخوان keep their existing formulas (base = source BUY).
    The source quote may be live goldbridge *or* id:1's admin manual.
    """
    out = dict(source_resolved)
    out["goldbridge_item_id"] = card.goldbridge_item_id
    if card.display_name:
        out["name"] = card.display_name
    out["price_source"] = "mirrored"
    # Actual formula source (id:1 for specials), not a stale/wrong ORM pointer.
    out["mirrored_from"] = int(
        source_resolved.get("goldbridge_item_id")
        or getattr(card, "price_source_item_id", None)
        or DEFAULT_PRICE_SOURCE_ITEM_ID
    )
    out["mirrored_source_mode"] = source_resolved.get("price_source") or "live"
    out["shop_margin_toman"] = 0
    out["allow_buy"] = True
    out["allow_sell"] = True
    out["active"] = True

    if is_motaferaghe_card(card.goldbridge_item_id):
        buy = float(source_resolved["buy"])
        out["buy"] = buy
        out["sell"] = buy
        out["pricing_mode"] = "motaferaghe_sell"
    elif is_naghd_kartkhan_card(card.goldbridge_item_id):
        buy = float(source_resolved["buy"])
        out["buy"] = buy
        out["sell"] = buy
        out["pricing_mode"] = "naghd_kartkhan_buy"
        out["markup_toman"] = NAGHD_KARTKHAN_MARKUP_TOMAN
    else:
        out["buy"] = float(source_resolved["buy"]) if source_resolved.get("buy") is not None else None
        out["sell"] = float(source_resolved["sell"]) if source_resolved.get("sell") is not None else None
    return out


def resolve_effective_item(
    card,
    item: dict | None,
    db: Session | None = None,
    *,
    source_card=None,
) -> dict | None:
    """
    Pick live goldbridge prices, mirrored source prices, or admin manuals.

    Live quotes are used whenever buy/sell exist - goldbridge's own
    `active` flag is informational only (shown in admin UI) and must
    NOT hide priced items from customers (most coins sit at active=False
    while still carrying valid buy/sell).

    Manual is used only while the admin has use_manual_price enabled.
    Unticking it returns every card — including متفرقه / نقد کارتخوان —
    to the goldbridge quote immediately.

    متفرقه / نقد کارتخوان ALWAYS mirror id:1 (raw live buy or typed
    manual buy) — never id:1013 and never the shop-padded customer
    quote. Formulas stay:
      متفرقه:       (id:1 buy + commission) / 4.39
      نقد کارتخوان: (id:1 buy + commission) + 100_000
    """
    is_special_mirror = bool(
        card
        and (is_motaferaghe_card(card.goldbridge_item_id) or is_naghd_kartkhan_card(card.goldbridge_item_id))
    )
    # Hard-lock specials to id:1 even if a row was pointed at 1013.
    source_id = DEFAULT_PRICE_SOURCE_ITEM_ID if is_special_mirror else (
        getattr(card, "price_source_item_id", None) if card else None
    )
    if source_id:
        source_live = _latest_items.get(int(source_id))
        if is_special_mirror:
            # Prefer the real id:1 ORM row over a stale/wrong source_card.
            if source_card is not None and int(getattr(source_card, "goldbridge_item_id", 0) or 0) == int(source_id):
                src_card = _snapshot_price_card(source_card)
            elif _manual_quote_for(int(source_id)) is not None:
                src_card = None
            elif db is not None:
                src_card = _get_price_card_row(int(source_id), db)
            else:
                src_card = None
        elif source_card is not None:
            src_card = _snapshot_price_card(source_card)
        elif _manual_quote_for(int(source_id)) is not None:
            src_card = None
        else:
            src_card = _get_price_card_row(int(source_id), db)

        if is_special_mirror:
            base_buy, mode = _mirror_base_buy(src_card, source_live, source_id=int(source_id))
            if base_buy is None:
                return None
            source_resolved = {
                "goldbridge_item_id": int(source_id),
                "name": (src_card.display_name if src_card and src_card.display_name else None),
                "type": GOLD_ITEM_TYPE,
                "ayar": (source_live or {}).get("ayar"),
                "item_weight": (source_live or {}).get("item_weight"),
                "buy": base_buy,
                "sell": base_buy,
                "allow_buy": True,
                "allow_sell": True,
                "active": True,
                "price_source": mode,
                "shop_margin_toman": 0,
            }
            return _apply_mirrored_structure(card, source_resolved)

        source_resolved = _live_or_manual_item(src_card, source_live, buy_only_ok=False)
        if not source_resolved or source_resolved.get("buy") is None:
            return None
        if source_resolved.get("sell") is None:
            return None
        return _apply_mirrored_structure(card, source_resolved)

    is_special = bool(
        card
        and (is_motaferaghe_card(card.goldbridge_item_id) or is_naghd_kartkhan_card(card.goldbridge_item_id))
    )
    return _live_or_manual_item(card, item, buy_only_ok=is_special)


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


def _role_commissions_for_card(
    db: Session,
    goldbridge_item_id: int,
    roles: list,
    overrides: dict | None = None,
) -> list[dict]:
    from app.models_db import PriceCardCommission

    if overrides is None:
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
        default = float(role.commission_value or 0)
        buy_value, sell_value = _commission_pair(ov, default)
        result.append({
            "role_id": role.id,
            "role_name": role.name,
            "commission_type": ctype.value if hasattr(ctype, "value") else ctype,
            "commission_value": buy_value,
            "commission_buy_value": buy_value,
            "commission_sell_value": sell_value,
            "can_order": bool(ov.can_order) if ov else True,
            "is_override": ov is not None,
        })
    return result


def list_admin_cards(db: Session) -> list[dict]:
    """Every known goldbridge item + enabled/mirrored/manual-only cards, with
    admin toggles, manuals, and per-role commission overrides."""
    from app.models_db import PriceCard, PriceCardCommission, Role

    ensure_special_mirrored_cards(db)

    existing_rows = db.query(PriceCard).all()
    existing = {c.goldbridge_item_id: c for c in existing_rows}
    _hydrate_manual_quotes_from_cards(existing_rows)
    _store_card_snapshots(existing_rows)
    roles = db.query(Role).order_by(Role.name).all()
    commissions_by_item: dict[int, dict] = {}
    for row in db.query(PriceCardCommission).all():
        commissions_by_item.setdefault(row.goldbridge_item_id, {})[row.role_id] = row
    result = []
    seen = set()

    for item_id, item in sorted(_latest_items.items()):
        seen.add(item_id)
        card = existing.get(item_id)
        src = existing.get(int(card.price_source_item_id)) if card and getattr(card, "price_source_item_id", None) else None
        effective = resolve_effective_item(card, item, db, source_card=src)
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
            "farshad_buy": item.get("buy"),
            "farshad_sell": item.get("sell"),
            "buy": effective["buy"] if effective else item.get("buy"),
            "sell": effective["sell"] if effective else item.get("sell"),
            "price_source": effective["price_source"] if effective else "unavailable",
            "mirrored_source_mode": (effective or {}).get("mirrored_source_mode"),
            "shop_margin_toman": (effective or {}).get("shop_margin_toman") or 0,
            "is_farshad_trade_tile": int(item_id) == FARSHAD_TRADE_CASH_ITEM_ID,
            "is_farshad_hidden_master": int(item_id) == DEFAULT_PRICE_SOURCE_ITEM_ID,
            "sort_order": card.sort_order if card else 0,
            "role_commissions": _role_commissions_for_card(db, item_id, roles, commissions_by_item.get(item_id, {})),
        })

    for item_id, card in existing.items():
        if item_id in seen:
            continue
        # Always include mirrored specials + any enabled/manual extras.
        is_mirrored = bool(getattr(card, "price_source_item_id", None))
        if not card.is_enabled and not card.use_manual_price and not is_mirrored:
            continue
        src = existing.get(int(card.price_source_item_id)) if getattr(card, "price_source_item_id", None) else None
        effective = resolve_effective_item(card, None, db, source_card=src)
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
                "mirrored_source_mode": None,
                "shop_margin_toman": 0,
                "is_farshad_trade_tile": int(item_id) == FARSHAD_TRADE_CASH_ITEM_ID,
                "is_farshad_hidden_master": int(item_id) == DEFAULT_PRICE_SOURCE_ITEM_ID,
                "sort_order": card.sort_order,
                "role_commissions": _role_commissions_for_card(db, item_id, roles, commissions_by_item.get(item_id, {})),
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
            "mirrored_source_mode": effective.get("mirrored_source_mode"),
            "shop_margin_toman": 0,
            "is_farshad_trade_tile": int(item_id) == FARSHAD_TRADE_CASH_ITEM_ID,
            "is_farshad_hidden_master": int(item_id) == DEFAULT_PRICE_SOURCE_ITEM_ID,
            "sort_order": card.sort_order,
            "role_commissions": _role_commissions_for_card(db, item_id, roles, commissions_by_item.get(item_id, {})),
        })

    result.sort(key=lambda c: card_list_rank(
        c.get("goldbridge_item_id") or 0,
        c.get("sort_order"),
        in_use=bool(c.get("is_enabled") or c.get("orderable_buy") or c.get("orderable_sell")),
    ))
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
    _invalidate_card_config_cache()


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
    _invalidate_card_config_cache()


def set_card_override(db: Session, goldbridge_item_id: int, override: bool):
    card = _get_or_create_card(db, goldbridge_item_id)
    card.override_source_restriction = override
    db.commit()
    _invalidate_card_config_cache()


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
    saved_at = None
    if use_manual_price:
        card.is_enabled = True
        card.manual_updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
        saved_at = mark_item_price_changed(goldbridge_item_id, _dt_to_iso(card.manual_updated_at))
    else:
        live = _latest_items.get(int(goldbridge_item_id))
        src_ts = _normalize_source_ts((live or {}).get("last_update_time"))
        if src_ts:
            mark_item_price_changed(goldbridge_item_id, src_ts)
    _remember_manual_quote(
        goldbridge_item_id,
        use_manual=use_manual_price,
        buy=manual_buy,
        sell=manual_sell,
        updated_at=saved_at,
    )
    db.commit()
    _patch_cached_card(
        goldbridge_item_id,
        use_manual_price=bool(use_manual_price),
        manual_buy=manual_buy,
        manual_sell=manual_sell,
        is_enabled=True if use_manual_price else bool(card.is_enabled),
        manual_updated_at=card.manual_updated_at,
    )


def set_card_role_commission(
    db: Session,
    goldbridge_item_id: int,
    role_id: str,
    commission_type: str,
    commission_value: float | None = None,
    can_order: bool = True,
    commission_buy_value: float | None = None,
    commission_sell_value: float | None = None,
):
    from app.models_db import PriceCardCommission, Role, CommissionTypeEnum

    if commission_type not in ("fixed", "percentage"):
        raise ValueError("نوع کمیسیون نامعتبر است")
    role = db.query(Role).filter(Role.id == role_id).first()
    if not role:
        raise ValueError("دسته‌بندی پیدا نشد")

    buy = commission_buy_value
    sell = commission_sell_value
    if buy is None and sell is None:
        if commission_value is None:
            raise ValueError("مقدار کمیسیون الزامی است")
        buy = sell = float(commission_value)
    if buy is None:
        buy = commission_value if commission_value is not None else sell
    if sell is None:
        sell = commission_value if commission_value is not None else buy
    buy = float(buy)
    sell = float(sell)

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
    row.commission_value = buy
    row.commission_buy_value = buy
    row.commission_sell_value = sell
    row.can_order = bool(can_order)
    db.commit()


def resolve_commission_for_user(db: Session, user, goldbridge_item_id: int) -> tuple[str, float, float]:
    """Return (commission_type, buy_value, sell_value). One-sided cards
    and older rows still have a single stored value, copied to both."""
    from app.models_db import PriceCardCommission

    if not user or not user.role:
        return "fixed", 0.0, 0.0
    default_value = float(user.role.commission_value or 0)
    default_type = user.role.commission_type.value
    ov = (
        db.query(PriceCardCommission)
        .filter(
            PriceCardCommission.goldbridge_item_id == goldbridge_item_id,
            PriceCardCommission.role_id == user.role_id,
        )
        .first()
    )
    buy_value, sell_value = _commission_pair(ov, default_value)
    if ov:
        return ov.commission_type.value, buy_value, sell_value
    return default_type, buy_value, sell_value


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
    all_cards = db.query(PriceCard).all()
    by_id = {c.goldbridge_item_id: c for c in all_cards}
    cards = [c for c in all_cards if c.is_enabled]
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
        src = by_id.get(int(card.price_source_item_id)) if getattr(card, "price_source_item_id", None) else None
        effective = resolve_effective_item(
            card, _latest_items.get(card.goldbridge_item_id), db, source_card=src
        )
        is_manual = bool(effective and effective.get("price_source") == "manual")
        can_order = True
        if is_manual:
            can_order = bool(ov.can_order) if ov is not None else True
        buy_value, sell_value = _commission_pair(ov, default_value)
        result.append({
            "goldbridge_item_id": card.goldbridge_item_id,
            "commission_type": ov.commission_type.value if ov else default_type,
            "commission_value": buy_value,
            "commission_buy_value": buy_value,
            "commission_sell_value": sell_value,
            "can_order": can_order,
        })
    return result


def get_card_state(db: Session, goldbridge_item_id: int):
    from app.models_db import PriceCard
    return db.query(PriceCard).filter(PriceCard.goldbridge_item_id == goldbridge_item_id).first()


def build_broadcast_payload(db: Session | None = None) -> dict:
    return {
        "cards": get_enabled_cards_for_broadcast(db),
        "updated_at": _latest_updated_at,
    }


def get_enabled_cards_for_broadcast(db: Session | None = None) -> list[dict]:
    snapshots = _card_config_cache
    owns_session = False
    if snapshots is None:
        if db is None:
            from app.db import SessionLocal
            db = SessionLocal()
            owns_session = True
        try:
            ensure_special_mirrored_cards(db)
            snapshots = _load_card_snapshots(db)
        finally:
            if owns_session:
                db.close()

    by_id = {c.goldbridge_item_id: c for c in snapshots}
    cards = [c for c in snapshots if c.is_enabled]
    cards.sort(key=lambda c: card_list_rank(
        c.goldbridge_item_id,
        getattr(c, "sort_order", 0),
        in_use=True,
    ))
    result = []
    for i, card in enumerate(cards):
        src = by_id.get(int(card.price_source_item_id)) if getattr(card, "price_source_item_id", None) else None
        item = resolve_effective_item(
            card,
            _latest_items.get(card.goldbridge_item_id),
            None,
            source_card=src,
        )
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
        # Live cards: goldbridge last_update_time. Manual / mirrored-manual:
        # the admin-save stamp on the source item (id:1 for متفرقه / نقد کارتخوان).
        source_id = card.price_source_item_id or card.goldbridge_item_id
        card_updated_at = item_price_changed_at(source_id)
        if item.get("price_source") == "manual" or item.get("mirrored_source_mode") == "manual":
            src_card = by_id.get(int(source_id))
            manual_ts = _dt_to_iso(getattr(src_card, "manual_updated_at", None)) if src_card else None
            card_updated_at = item_price_changed_at(source_id) or manual_ts
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
