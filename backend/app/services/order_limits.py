"""
Order min/max limits, admin-editable at runtime (no redeploy needed),
same AppSetting key-value pattern as trading_status.py.

Two independent pairs: weight (گرم ۱۸) and amount (تومان) - a customer
placing an order in either mode gets validated against the matching
pair. 0 for max_* means "no upper limit".
"""
from sqlalchemy.orm import Session

from app.models_db import AppSetting
from app.config import settings

KEYS = {
    "min_weight": ("order_limit_min_weight", lambda: settings.MIN_ORDER_WEIGHT),
    "max_weight": ("order_limit_max_weight", lambda: settings.MAX_ORDER_WEIGHT),
    "min_amount": ("order_limit_min_amount", lambda: 0.0),
    "max_amount": ("order_limit_max_amount", lambda: 0.0),  # 0 = no limit
}


def get_order_limits(db: Session) -> dict:
    result = {}
    for field, (key, default_fn) in KEYS.items():
        row = db.query(AppSetting).filter(AppSetting.key == key).first()
        result[field] = float(row.value) if row else default_fn()
    return result


def set_order_limits(db: Session, **updates: float) -> dict:
    """Pass any subset of min_weight/max_weight/min_amount/max_amount;
    unset ones are left as-is."""
    for field, value in updates.items():
        if value is None:
            continue
        if field not in KEYS:
            continue
        key = KEYS[field][0]
        row = db.query(AppSetting).filter(AppSetting.key == key).first()
        if row:
            row.value = str(value)
        else:
            row = AppSetting(key=key, value=str(value))
            db.add(row)
    db.commit()
    return get_order_limits(db)


def _primary_gold_gram18_buy_unit(db: Session, user) -> float | None:
    """Rounded گرم۱۸ buy unit for the primary gold card, with this user's
    effective commission — same rounding the price card / admin دسته بندی
    amount auto-fill uses (Math.round / round)."""
    from app.gold_conversion import mesghal17_to_gram18
    from app.services import price_cards as price_cards_service
    from app.services.orders import apply_role_pricing_formula

    try:
        cards = price_cards_service.get_enabled_cards_for_broadcast(db)
    except Exception:
        return None

    gold = next(
        (c for c in cards if c.get("type") == price_cards_service.GOLD_ITEM_TYPE and c.get("is_primary")),
        None,
    )
    if not gold:
        gold = next((c for c in cards if c.get("type") == price_cards_service.GOLD_ITEM_TYPE), None)
    if not gold or gold.get("buy_price") is None:
        return None

    commission_type = "fixed"
    commission_value = 0.0
    role = getattr(user, "role", None)
    if role is not None:
        commission_type = (
            role.commission_type.value if hasattr(role.commission_type, "value") else str(role.commission_type)
        )
        commission_value = float(role.commission_value or 0)

    gold_id = gold.get("goldbridge_item_id")
    try:
        for row in price_cards_service.card_commissions_for_user(db, user):
            if row.get("goldbridge_item_id") == gold_id:
                commission_type = row.get("commission_type") or commission_type
                commission_value = float(row.get("commission_buy_value") or row.get("commission_value") or 0)
                break
    except Exception:
        pass

    final_buy_mesghal = apply_role_pricing_formula(
        float(gold["buy_price"]),
        "buy",
        commission_type,
        commission_value,
    )
    return float(round(mesghal17_to_gram18(final_buy_mesghal)))


def live_amount_limits_from_weights(
    db: Session,
    user,
    *,
    min_weight: float | None,
    max_weight: float | None,
) -> tuple[float | None, float | None]:
    """Derive تومان min/max from weight limits × live primary gold buy unit."""
    unit = _primary_gold_gram18_buy_unit(db, user)
    if unit is None or unit <= 0:
        return None, None
    min_amount = round(float(min_weight) * unit) if min_weight is not None else None
    max_amount = round(float(max_weight) * unit) if max_weight is not None else None
    return min_amount, max_amount


def get_effective_limits(db: Session, user) -> dict:
    """
    Global limits (get_order_limits), with any of the four fields
    overridden by the user's role if that role has a non-null value
    set for it - see min_weight/max_weight/min_amount/max_amount on
    the Role model. Also includes price_label_mode and the user's own
    commission (type + value) from their role, so the frontend can
    show the ACTUAL price this user would get - not the raw source
    price - on the main trading screen, not just at order-submit time.

    When a دسته بندی sets weight limits, تومان amounts are recomputed
    from the live gold price on every read (weight is the source of
    truth; stored amounts are only a save-time snapshot).
    """
    from app.services import price_cards as price_cards_service

    result = get_order_limits(db)
    result["price_label_mode"] = "mesghal_and_gram18"
    result["commission_type"] = "fixed"
    result["commission_value"] = 0.0
    result["trading_banned"] = False
    result["kyc_status"] = "none"
    result["kyc_approved"] = False
    result["card_commissions"] = []
    result["amount_limits_follow_weight"] = False

    role = getattr(user, "role", None)
    result["trading_banned"] = bool(getattr(user, "is_trading_banned", False))
    kyc_status = getattr(user, "kyc_status", None) or "none"
    result["kyc_status"] = kyc_status
    result["kyc_approved"] = kyc_status == "approved"
    result["pending_seconds"] = int(settings.ORDER_PENDING_SECONDS)
    if role:
        for field in ("min_weight", "max_weight", "min_amount", "max_amount"):
            override = getattr(role, field, None)
            if override is not None:
                result[field] = override
        result["price_label_mode"] = role.price_label_mode or "mesghal_and_gram18"
        result["commission_type"] = role.commission_type.value if hasattr(role.commission_type, "value") else role.commission_type
        result["commission_value"] = role.commission_value

        role_min_w = getattr(role, "min_weight", None)
        role_max_w = getattr(role, "max_weight", None)
        if role_min_w is not None or role_max_w is not None:
            result["amount_limits_follow_weight"] = True
            live_min, live_max = live_amount_limits_from_weights(
                db,
                user,
                min_weight=role_min_w,
                max_weight=role_max_w,
            )
            if role_min_w is not None and live_min is not None:
                result["min_amount"] = float(live_min)
            if role_max_w is not None and live_max is not None:
                result["max_amount"] = float(live_max)

    result["card_commissions"] = price_cards_service.card_commissions_for_user(db, user)
    return result