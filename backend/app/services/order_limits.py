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
