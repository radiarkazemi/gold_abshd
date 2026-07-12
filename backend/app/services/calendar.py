"""
Iranian (Jalali) calendar support: figuring out which days are trading
days (not weekend, not an admin-defined holiday) and computing the
current "نقد" settlement day label shown next to the price - e.g.
"نقد شنبه" meaning a trade placed now settles/clears on the next
Saturday.

Religious Iranian holidays move every Gregorian year (they follow the
lunar Hijri calendar), so there's no formula for them - the admin adds
specific dates via the holidays table. Nowruz (the ~4-day new year
holiday in mid-to-late March) is the one exception worth seeding by
default since its Jalali date is fixed (1-4 Farvardin every year); the
rest are managed manually.
"""
from datetime import datetime, timedelta

import jdatetime
from sqlalchemy.orm import Session

from app.config import settings
from app.models_db import Holiday

JALALI_WEEKDAY_BY_INDEX = ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه"]
# jdatetime's date.weekday(): Saturday=0 ... Friday=6 (verified empirically)


def to_jalali(dt: datetime) -> jdatetime.date:
    return jdatetime.date.fromgregorian(date=dt.date())


def jalali_weekday_name(dt: datetime) -> str:
    return JALALI_WEEKDAY_BY_INDEX[to_jalali(dt).weekday()]


def _is_holiday(db: Session, dt: datetime) -> bool:
    day_start = datetime(dt.year, dt.month, dt.day)
    return db.query(Holiday).filter(Holiday.date == day_start).first() is not None


def is_trading_day(db: Session, dt: datetime) -> bool:
    if dt.weekday() in settings.WEEKEND_DAYS_SET:  # Python weekday: Mon=0..Sun=6
        return False
    if _is_holiday(db, dt):
        return False
    return True


def next_trading_day(db: Session, from_dt: datetime) -> datetime:
    """First trading day strictly AFTER from_dt's date."""
    candidate = datetime(from_dt.year, from_dt.month, from_dt.day) + timedelta(days=1)
    for _ in range(30):  # safety cap - shouldn't ever need more than a week or two
        if is_trading_day(db, candidate):
            return candidate
        candidate += timedelta(days=1)
    return candidate  # fallback, should be unreachable in practice


def get_settlement_label(db: Session, now: datetime | None = None) -> dict:
    """
    Returns the current "نقد" settlement info: which day trades placed
    right now will settle on, in both Jalali-weekday-name and ISO date
    form.

    Rule: settlement is simply the next trading day after today (skipping
    weekends and admin-defined holidays) - no time-of-day adjustment.
    An earlier version of this also pushed one extra day forward after a
    cutoff hour, based on a wrong assumption that only Friday was a
    non-trading day; once the real weekend (Thursday+Friday) is used,
    that extra push isn't needed and was actually producing a day too
    many.
    """
    now = now or datetime.utcnow()
    settlement_date = next_trading_day(db, now)

    weekday_name = jalali_weekday_name(settlement_date)
    return {
        "label": f"نقد {weekday_name}",
        "weekday": weekday_name,
        "date": settlement_date.date().isoformat(),
        "jalali_date": str(to_jalali(settlement_date)),
    }