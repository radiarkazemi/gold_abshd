"""
Global trading status: when the admin marks trading OFFLINE, new buy/sell
orders from customers are rejected server-side (not just hidden in the
UI - a customer hitting the API directly couldn't bypass this). Phone
orders (admin manually entering a trade) are NOT blocked by this, since
those are the admin directly handling a trade regardless of automated
status.
"""
from sqlalchemy.orm import Session

from app.models_db import AppSetting

TRADING_STATUS_KEY = "trading_online"


def is_trading_online(db: Session) -> bool:
    row = db.query(AppSetting).filter(
        AppSetting.key == TRADING_STATUS_KEY).first()
    if not row:
        return True  # default: online
    return row.value == "true"


def set_trading_online(db: Session, online: bool) -> bool:
    row = db.query(AppSetting).filter(
        AppSetting.key == TRADING_STATUS_KEY).first()
    value = "true" if online else "false"
    if row:
        row.value = value
    else:
        row = AppSetting(key=TRADING_STATUS_KEY, value=value)
        db.add(row)
    db.commit()
    return online
