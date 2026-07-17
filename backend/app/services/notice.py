"""
The admin-editable notice/note shown under the prices on the main
screen (e.g. minimum order amount, delivery cutoff times, etc - the
same kind of thing the reference app showed as static text, except
here the admin can actually change it without a code deploy).
"""
from sqlalchemy.orm import Session

from app.models_db import AppSetting

NOTICE_KEY = "notice_text"

DEFAULT_NOTICE = (
    "مشتریان گرامی، لطفا موجودی حساب خود را پیش از ثبت سفارش بررسی کنید.\n"
    "فیش واریزی خود را حتما ضمیمه سفارش نمایید."
)


def get_notice(db: Session) -> str:
    row = db.query(AppSetting).filter(AppSetting.key == NOTICE_KEY).first()
    return row.value if row else DEFAULT_NOTICE


def get_notice_updated_at(db: Session) -> str | None:
    row = db.query(AppSetting).filter(AppSetting.key == NOTICE_KEY).first()
    return row.updated_at.isoformat() if row and row.updated_at else None


def set_notice(db: Session, text: str) -> str:
    row = db.query(AppSetting).filter(AppSetting.key == NOTICE_KEY).first()
    if row:
        row.value = text
    else:
        row = AppSetting(key=NOTICE_KEY, value=text)
        db.add(row)
    db.commit()
    return text
