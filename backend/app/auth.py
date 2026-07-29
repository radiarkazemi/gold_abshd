"""
Phone + OTP authentication - invite-only, multi-device (capped).

Flow for a BRAND NEW user (never activated):
  1. POST /api/auth/request-otp {phone_number, device_id, registration_key}
     -> validates the registration key belongs to this phone's user
        and hasn't been used/expired/banned, then sends an OTP
  2. POST /api/auth/verify-otp {phone_number, code, device_id, registration_key}
     -> on success, activates the key and registers this device,
        returns a JWT token

Flow for an ALREADY-ACTIVATED user:
  1. POST /api/auth/request-otp {phone_number, device_id}
     -> allowed if device is already registered OR the user still has
        an open device slot (count < max_devices)
  2. POST /api/auth/verify-otp {phone_number, code, device_id}
     -> registers/touches the device (enforcing max_devices), issues token

There is NO self-signup: request-otp/verify-otp both 404 if no user
with that phone number was created by an admin first.
"""
import random
import string
from datetime import datetime, timedelta

import jwt
from fastapi import Depends, HTTPException, Header
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.models_db import User, OtpCode
from app.services.registration import validate_key_for_activation, activate_key
from app.services.devices import (
    user_is_activated,
    ensure_device_allowed,
    register_or_touch_device,
)

OTP_LENGTH = 6
OTP_TTL_MINUTES = 5


def _normalize_phone(phone: str) -> str:
    return phone.strip().replace(" ", "")


def generate_otp_code() -> str:
    return "".join(random.choices(string.digits, k=OTP_LENGTH))


def send_sms(phone_number: str, message: str):
    """
    Placeholder SMS sender. Swap this out for a real provider
    (Kavenegar, Ghasedak, etc.) when ready to go live.
    """
    print(f"[SMS -> {phone_number}] {message}")


def get_user_for_login(db: Session, phone_number: str) -> User:
    """
    Looks up a user for login purposes. Raises 404 if no admin-created
    account exists for this phone - there is no self-signup.
    """
    phone_number = _normalize_phone(phone_number)
    user = db.query(User).filter(User.phone_number == phone_number).first()
    if not user:
        raise HTTPException(
            status_code=404,
            detail="حسابی با این شماره یافت نشد. لطفا با مدیریت هماهنگ کنید.",
        )
    if user.is_blocked:
        raise HTTPException(status_code=403, detail="حساب کاربری شما مسدود شده است")
    return user


def check_device_or_require_key(user: User, device_id: str, registration_key: str | None, db: Session):
    """
    If the user has never activated, a valid registration_key must be
    supplied (validated here, bound only after OTP succeeds).
    If already activated, the device must be known or under max_devices.
    """
    if not device_id:
        raise HTTPException(status_code=400, detail="شناسه دستگاه ارسال نشده است")

    if not user_is_activated(db, user):
        if not registration_key:
            raise HTTPException(
                status_code=400,
                detail="برای اولین ورود، کد ثبت‌نام لازم است",
            )
        validate_key_for_activation(db, user, registration_key)
    else:
        ensure_device_allowed(db, user, device_id)


def create_otp_for_phone(db: Session, phone_number: str) -> str:
    phone_number = _normalize_phone(phone_number)
    code = generate_otp_code()
    otp = OtpCode(
        phone_number=phone_number,
        code=code,
        expires_at=datetime.utcnow() + timedelta(minutes=OTP_TTL_MINUTES),
    )
    db.add(otp)
    db.commit()

    send_sms(phone_number, f"کد ورود شما به آبشده قصر طلا: {code}")
    return code


def verify_otp_and_get_user(
    db: Session,
    phone_number: str,
    code: str,
    device_id: str,
    registration_key: str | None,
    device_info: str = "",
) -> User:
    phone_number = _normalize_phone(phone_number)

    otp = (
        db.query(OtpCode)
        .filter(
            OtpCode.phone_number == phone_number,
            OtpCode.code == code,
            OtpCode.is_used.is_(False),
        )
        .order_by(OtpCode.created_at.desc())
        .first()
    )
    if not otp:
        raise HTTPException(status_code=400, detail="کد وارد شده صحیح نیست")
    if otp.expires_at < datetime.utcnow():
        raise HTTPException(status_code=400, detail="کد وارد شده منقضی شده است")

    otp.is_used = True
    db.commit()

    user = get_user_for_login(db, phone_number)

    if not user_is_activated(db, user):
        reg_key = validate_key_for_activation(db, user, registration_key)
        activate_key(db, reg_key, device_id, device_info)
        register_or_touch_device(db, user, device_id, device_info, allow_new=True)
    else:
        register_or_touch_device(db, user, device_id, device_info, allow_new=True)

    user.last_seen_at = datetime.utcnow()
    db.commit()
    db.refresh(user)
    return user


def create_access_token(user: User, device_id: str = "") -> str:
    payload = {
        "sub": user.id,
        "phone_number": user.phone_number,
        "device_id": device_id,
        "exp": datetime.utcnow() + timedelta(minutes=settings.JWT_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm="HS256")


def decode_access_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.JWT_SECRET, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="نشست شما منقضی شده، دوباره وارد شوید")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="توکن نامعتبر است")


def get_current_user(
    authorization: str | None = Header(default=None),
    x_device_id: str | None = Header(default=None, alias="X-Device-Id"),
    db: Session = Depends(get_db),
) -> User:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="ابتدا وارد شوید")

    token = authorization.removeprefix("Bearer ").strip()
    payload = decode_access_token(token)

    user = db.query(User).filter(User.id == payload["sub"]).first()
    if not user:
        raise HTTPException(status_code=401, detail="کاربر پیدا نشد")
    if user.is_blocked:
        raise HTTPException(status_code=403, detail="حساب کاربری شما مسدود شده است")

    device_id = x_device_id or payload.get("device_id", "")
    if device_id:
        from app.services.devices import find_user_device
        if not find_user_device(db, user, device_id):
            if not (user.device_id and user.device_id == device_id):
                raise HTTPException(
                    status_code=401,
                    detail="این نشست منقضی شده است. لطفا دوباره وارد شوید.",
                )

    return user
