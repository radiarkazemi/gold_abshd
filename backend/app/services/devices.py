"""
Per-user device registry.

After first activation with a registration key, the customer may log in
from up to User.max_devices distinct browser installs (localStorage
device ids). Known devices are refreshed on each successful OTP verify;
when a new device logs in and the limit is already reached, the oldest
device (by last_seen_at) is evicted so the new one can take its slot.
All device history is kept in the admin view even after eviction.
"""
from datetime import datetime

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models_db import User, UserDevice


def list_user_devices(db: Session, user: User) -> list[UserDevice]:
    return (
        db.query(UserDevice)
        .filter(UserDevice.user_id == user.id)
        .order_by(UserDevice.last_seen_at.desc().nullslast(), UserDevice.created_at.desc())
        .all()
    )


def count_user_devices(db: Session, user: User) -> int:
    return db.query(UserDevice).filter(UserDevice.user_id == user.id).count()


def find_user_device(db: Session, user: User, device_id: str) -> UserDevice | None:
    return (
        db.query(UserDevice)
        .filter(UserDevice.user_id == user.id, UserDevice.device_id == device_id)
        .first()
    )


def user_is_activated(db: Session, user: User) -> bool:
    """Activated once they have any registered device, or legacy device_id."""
    if count_user_devices(db, user) > 0:
        return True
    return bool(user.device_id)


def ensure_device_allowed(db: Session, user: User, device_id: str):
    """
    Pre-OTP gate for already-activated users. Always allows login;
    actual eviction of the oldest device (if over the limit) happens
    in register_or_touch_device after OTP succeeds.
    """
    pass


def register_or_touch_device(
    db: Session,
    user: User,
    device_id: str,
    device_info: str = "",
    *,
    allow_new: bool = True,
) -> UserDevice:
    """
    Upsert the device for this user. When allow_new is False, only
    existing devices (or the legacy user.device_id) may proceed.
    """
    existing = find_user_device(db, user, device_id)
    if existing:
        existing.last_seen_at = datetime.utcnow()
        if device_info:
            existing.device_info = device_info
        user.device_id = device_id
        user.device_info = device_info or user.device_info
        db.commit()
        db.refresh(existing)
        return existing

    if user.device_id == device_id and count_user_devices(db, user) == 0:
        # Promote legacy single-device field into the devices table.
        row = UserDevice(
            user_id=user.id,
            device_id=device_id,
            device_info=device_info or user.device_info or "",
            last_seen_at=datetime.utcnow(),
        )
        db.add(row)
        user.device_info = device_info or user.device_info
        db.commit()
        db.refresh(row)
        return row

    if not allow_new:
        raise HTTPException(
            status_code=403,
            detail="این دستگاه برای این حساب مجاز نیست",
        )

    max_allowed = max(1, int(user.max_devices or 1))
    current = count_user_devices(db, user)

    # Evict oldest devices until there's room for the new one.
    if current >= max_allowed:
        excess = current - max_allowed + 1
        oldest = (
            db.query(UserDevice)
            .filter(UserDevice.user_id == user.id)
            .order_by(UserDevice.last_seen_at.asc().nullsfirst(), UserDevice.created_at.asc())
            .limit(excess)
            .all()
        )
        for old_dev in oldest:
            db.delete(old_dev)
        db.flush()

    row = UserDevice(
        user_id=user.id,
        device_id=device_id,
        device_info=device_info or "",
        last_seen_at=datetime.utcnow(),
    )
    db.add(row)
    user.device_id = device_id
    user.device_info = device_info or ""
    db.commit()
    db.refresh(row)
    return row


def revoke_user_device(db: Session, user: User, device_row_id: str) -> None:
    row = (
        db.query(UserDevice)
        .filter(UserDevice.id == device_row_id, UserDevice.user_id == user.id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="دستگاه پیدا نشد")

    was_legacy = user.device_id == row.device_id
    db.delete(row)
    db.flush()

    remaining = list_user_devices(db, user)
    if was_legacy:
        if remaining:
            user.device_id = remaining[0].device_id
            user.device_info = remaining[0].device_info
        else:
            user.device_id = None
            user.device_info = None
    db.commit()
