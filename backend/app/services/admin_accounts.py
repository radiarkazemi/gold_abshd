"""
Sub-admin (accountant/manager/etc) accounts, the activity log, and
their two-step login (password, then SMS OTP - first login also needs
the registration_key handed out at creation time).

Distinct from services/... admin_users for CUSTOMER users - this is
specifically about admin_users, the ADMIN PANEL identities.
"""
import json
import random
import string
from datetime import datetime, timedelta

import bcrypt
from sqlalchemy.orm import Session

from app.models_db import AdminUser, AdminActivityLog, OtpCode
from app.permissions import valid_scopes
# same test-mode SMS placeholder as the customer flow
from app.auth import generate_otp_code, send_sms

SAFE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O, 1/I
KEY_DEFAULT_TTL_DAYS = 14
OTP_TTL_MINUTES = 5


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def _generate_registration_key() -> str:
    def chunk():
        return "".join(random.choices(SAFE_ALPHABET, k=4))
    return f"{chunk()}-{chunk()}-{chunk()}"


def verify_sub_admin_password(db: Session, username: str, password: str) -> AdminUser | None:
    """Step 1 of login: just the password check, no OTP yet."""
    row = db.query(AdminUser).filter(AdminUser.username == username, AdminUser.is_active == True).first()  # noqa: E712
    if not row:
        return None
    if not bcrypt.checkpw(password.encode(), row.password_hash.encode()):
        return None
    return row


def mark_login(db: Session, admin_user: AdminUser):
    admin_user.last_login_at = datetime.utcnow()
    db.commit()


def create_sub_admin(db: Session, username: str, password: str, full_name: str,
                     phone_number: str, national_id: str, permissions: list[str],
                     created_by: str, key_ttl_days: int = KEY_DEFAULT_TTL_DAYS) -> AdminUser:
    if db.query(AdminUser).filter(AdminUser.username == username).first():
        raise ValueError("این نام کاربری قبلا استفاده شده")
    if phone_number and db.query(AdminUser).filter(AdminUser.phone_number == phone_number).first():
        raise ValueError("این شماره موبایل قبلا استفاده شده")

    row = AdminUser(
        username=username,
        password_hash=hash_password(password),
        full_name=full_name,
        phone_number=phone_number,
        national_id=national_id,
        permissions=json.dumps(valid_scopes(permissions)),
        created_by=created_by,
        registration_key=_generate_registration_key(),
        registration_key_expires_at=datetime.utcnow() + timedelta(days=key_ttl_days),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def list_sub_admins(db: Session) -> list[AdminUser]:
    return db.query(AdminUser).order_by(AdminUser.created_at.desc()).all()


def get_sub_admin(db: Session, admin_user_id: str) -> AdminUser | None:
    return db.query(AdminUser).filter(AdminUser.id == admin_user_id).first()


def update_sub_admin(db: Session, admin_user_id: str, full_name: str | None = None,
                     permissions: list[str] | None = None, is_active: bool | None = None,
                     new_password: str | None = None) -> AdminUser:
    row = get_sub_admin(db, admin_user_id)
    if not row:
        raise ValueError("کاربر ادمین پیدا نشد")

    if full_name is not None:
        row.full_name = full_name
    if permissions is not None:
        row.permissions = json.dumps(valid_scopes(permissions))
    if is_active is not None:
        row.is_active = is_active
    if new_password:
        row.password_hash = hash_password(new_password)

    db.commit()
    db.refresh(row)
    return row


def delete_sub_admin(db: Session, admin_user_id: str):
    row = get_sub_admin(db, admin_user_id)
    if row:
        db.delete(row)
        db.commit()


def admin_user_permissions(row: AdminUser) -> list[str]:
    try:
        return json.loads(row.permissions or "[]")
    except (json.JSONDecodeError, TypeError):
        return []


# --- Two-step login: password (above) then SMS OTP (below) ---

def send_login_otp(db: Session, admin_user: AdminUser) -> str:
    """Called right after a successful password check. Sends (test-mode:
    prints, same placeholder as the customer flow) a fresh OTP to the
    sub-admin's phone_number and returns the code (caller doesn't need
    it except possibly for logging - never send it back in an API
    response)."""
    if not admin_user.phone_number:
        raise ValueError(
            "برای این حساب شماره موبایلی ثبت نشده - با مدیر اصلی هماهنگ کنید")

    code = generate_otp_code()
    otp = OtpCode(
        phone_number=admin_user.phone_number,
        code=code,
        expires_at=datetime.utcnow() + timedelta(minutes=OTP_TTL_MINUTES),
    )
    db.add(otp)
    db.commit()

    send_sms(admin_user.phone_number, f"کد ورود پنل مدیریت: {code}")
    return code


def verify_login_otp(db: Session, admin_user: AdminUser, code: str, registration_key: str | None) -> AdminUser:
    """Step 2 of login. On first activation (activated_at is None),
    registration_key must match and not be expired - after this call
    succeeds once, activated_at is set and the key is no longer needed
    on future logins."""
    otp = (
        db.query(OtpCode)
        .filter(
            OtpCode.phone_number == admin_user.phone_number,
            OtpCode.code == code,
            OtpCode.is_used.is_(False),
        )
        .order_by(OtpCode.created_at.desc())
        .first()
    )
    if not otp:
        raise ValueError("کد وارد شده صحیح نیست")
    if otp.expires_at < datetime.utcnow():
        raise ValueError("کد وارد شده منقضی شده است")

    if admin_user.activated_at is None:
        if not registration_key:
            raise ValueError("برای اولین ورود، کد ثبت‌نام لازم است")
        if admin_user.registration_key != registration_key.strip().upper():
            raise ValueError("کد ثبت‌نام صحیح نیست")
        if admin_user.registration_key_expires_at and admin_user.registration_key_expires_at < datetime.utcnow():
            raise ValueError("کد ثبت‌نام منقضی شده است")
        admin_user.activated_at = datetime.utcnow()

    otp.is_used = True
    admin_user.last_login_at = datetime.utcnow()
    db.commit()
    db.refresh(admin_user)
    return admin_user


def log_activity(db: Session, actor_username: str, is_super: bool, action: str, detail: str = ""):
    entry = AdminActivityLog(
        actor_username=actor_username,
        is_super=is_super,
        action=action,
        detail=detail,
    )
    db.add(entry)
    db.commit()


def list_activity(db: Session, limit: int = 200) -> list[AdminActivityLog]:
    return (
        db.query(AdminActivityLog)
        .order_by(AdminActivityLog.created_at.desc())
        .limit(limit)
        .all()
    )
