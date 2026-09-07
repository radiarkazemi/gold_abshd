"""
Per-admin device registry.

Each admin may stay logged in on up to AdminUser.max_devices browser
installs at the same time. On a new login when the limit is reached,
the oldest device (by last_seen_at) is evicted. Evicted devices get
401 on the next request and must log in again.
"""
from datetime import datetime

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models_db import AdminUser, AdminDevice


def list_admin_devices(db: Session, admin: AdminUser) -> list[AdminDevice]:
    return (
        db.query(AdminDevice)
        .filter(AdminDevice.admin_user_id == admin.id)
        .order_by(AdminDevice.last_seen_at.desc().nullslast(), AdminDevice.created_at.desc())
        .all()
    )


def count_admin_devices(db: Session, admin: AdminUser) -> int:
    return db.query(AdminDevice).filter(AdminDevice.admin_user_id == admin.id).count()


def find_admin_device(db: Session, admin: AdminUser, device_id: str) -> AdminDevice | None:
    return (
        db.query(AdminDevice)
        .filter(AdminDevice.admin_user_id == admin.id, AdminDevice.device_id == device_id)
        .first()
    )


def touch_admin_device(db: Session, admin: AdminUser, device_id: str) -> None:
    row = find_admin_device(db, admin, device_id)
    if row:
        row.last_seen_at = datetime.utcnow()
        db.commit()


def register_or_touch_admin_device(
    db: Session,
    admin: AdminUser,
    device_id: str,
    device_info: str = "",
) -> AdminDevice:
    if not device_id:
        raise HTTPException(status_code=400, detail="شناسه دستگاه ارسال نشده است")

    existing = find_admin_device(db, admin, device_id)
    if existing:
        existing.last_seen_at = datetime.utcnow()
        if device_info:
            existing.device_info = device_info
        db.commit()
        db.refresh(existing)
        return existing

    max_allowed = max(1, int(admin.max_devices or 1))
    current = count_admin_devices(db, admin)

    if current >= max_allowed:
        excess = current - max_allowed + 1
        oldest = (
            db.query(AdminDevice)
            .filter(AdminDevice.admin_user_id == admin.id)
            .order_by(AdminDevice.last_seen_at.asc().nullsfirst(), AdminDevice.created_at.asc())
            .limit(excess)
            .all()
        )
        for old_dev in oldest:
            db.delete(old_dev)
        db.flush()

    row = AdminDevice(
        admin_user_id=admin.id,
        device_id=device_id,
        device_info=device_info or "",
        last_seen_at=datetime.utcnow(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row
