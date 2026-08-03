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


def get_effective_limits(db: Session, user) -> dict:
    """
    Global limits (get_order_limits), with any of the four fields
    overridden by the user's role if that role has a non-null value
    set for it - see min_weight/max_weight/min_amount/max_amount on
    the Role model. Also includes price_label_mode and the user's own
    commission (type + value) from their role, so the frontend can
    show the ACTUAL price this user would get - not the raw source
    price - on the main trading screen, not just at order-submit time.
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

    result["card_commissions"] = price_cards_service.card_commissions_for_user(db, user)
    return result