"""
Registration keys: issued by the admin when creating a new user,
required (along with the user's phone number) for that user's first
login. Once a key is used to activate an account on a device, it's
bound to that device_id and can't be used to activate anywhere else.

Key format: XXXX-XXXX-XXXX (uppercase letters + digits, no ambiguous
characters like 0/O or 1/I) - easy to read aloud or write down when
handing it to someone in person.
"""
import random
import string
from datetime import datetime, timedelta

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models_db import RegistrationKey, RegistrationKeyStatusEnum, User, Role

SAFE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O, 1/I
KEY_DEFAULT_TTL_DAYS = 14


def _generate_key() -> str:
    def chunk():
        return "".join(random.choices(SAFE_ALPHABET, k=4))
    return f"{chunk()}-{chunk()}-{chunk()}"


def issue_registration_key(db: Session, user: User, ttl_days: int = KEY_DEFAULT_TTL_DAYS) -> RegistrationKey:
    reg_key = RegistrationKey(
        key=_generate_key(),
        user_id=user.id,
        expires_at=datetime.utcnow() + timedelta(days=ttl_days),
    )
    db.add(reg_key)
    db.commit()
    db.refresh(reg_key)
    return reg_key


def validate_key_for_activation(db: Session, user: User, key_str: str) -> RegistrationKey:
    """
    Checks a registration key is valid for activating this specific user
    (but does NOT bind it to a device yet - that only happens after the
    OTP is actually verified, so a wrong/guessed key can't lock a device
    to someone else's account).
    """
    reg_key = (
        db.query(RegistrationKey)
        .filter(RegistrationKey.key == key_str.strip().upper(), RegistrationKey.user_id == user.id)
        .first()
    )
    if not reg_key:
        raise HTTPException(status_code=400, detail="کد ثبت‌نام نامعتبر است")
    if reg_key.status == RegistrationKeyStatusEnum.banned:
        raise HTTPException(status_code=403, detail="این کد مسدود شده است")
    if reg_key.expires_at < datetime.utcnow():
        raise HTTPException(status_code=400, detail="کد ثبت‌نام منقضی شده است")
    if reg_key.status == RegistrationKeyStatusEnum.active:
        raise HTTPException(
            status_code=400, detail="این کد قبلا استفاده شده است")
    return reg_key


def activate_key(db: Session, reg_key: RegistrationKey, device_id: str, device_info: str = ""):
    reg_key.status = RegistrationKeyStatusEnum.active
    reg_key.activated_at = datetime.utcnow()
    reg_key.device_id = device_id

    user = reg_key.user
    user.device_id = device_id
    user.device_info = device_info or ""

    db.commit()


def ban_registration_key(db: Session, user: User):
    """Bans the user's key (if any) alongside blocking the user themself."""
    if user.registration_key:
        user.registration_key.status = RegistrationKeyStatusEnum.banned
    db.commit()


def _generate_user_code(db: Session) -> str:
    """
    Short, human-readable customer code (like "کد ۱۰۴۳" in the reference
    app) - sequential starting at 1000, so codes stay short even with
    many users. Loops past any (rare) collision from a deleted user.
    """
    count = db.query(User).count()
    candidate = 1000 + count + 1
    while db.query(User).filter(User.user_code == str(candidate)).first():
        candidate += 1
    return str(candidate)


def create_user_with_key(
    db: Session,
    phone_number: str,
    full_name: str,
    role_id: str,
    national_id: str | None = None,
    notes: str | None = None,
    key_ttl_days: int = KEY_DEFAULT_TTL_DAYS,
) -> tuple[User, RegistrationKey]:
    """
    Admin-only user provisioning: creates the account and issues its
    registration key in one step. The key is shown to the admin ONCE -
    it's their job to hand it to the actual person.
    """
    phone_number = phone_number.strip().replace(" ", "")

    existing = db.query(User).filter(User.phone_number == phone_number).first()
    if existing:
        raise HTTPException(
            status_code=400, detail="کاربری با این شماره قبلا ثبت شده است")

    role = db.query(Role).filter(Role.id == role_id).first()
    if not role:
        raise HTTPException(
            status_code=400, detail="دسته‌بندی انتخاب‌شده پیدا نشد")

    user = User(
        user_code=_generate_user_code(db),
        phone_number=phone_number,
        full_name=full_name,
        role_id=role_id,
        national_id=national_id,
        notes=notes,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    reg_key = issue_registration_key(db, user, key_ttl_days)
    return user, reg_key
