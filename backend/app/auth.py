"""
Phone + OTP authentication.

Flow:
  1. POST /api/auth/request-otp {phone_number}
     -> generates a 6-digit code, stores it (expires in 5 min), "sends" it
  2. POST /api/auth/verify-otp {phone_number, code}
     -> checks the code, creates the user if this is their first login,
        returns a JWT token
  3. Every protected endpoint requires "Authorization: Bearer <token>"
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


def verify_otp_and_get_user(db: Session, phone_number: str, code: str) -> User:
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

    user = db.query(User).filter(User.phone_number == phone_number).first()
    if not user:
        user = User(phone_number=phone_number)
        db.add(user)
        db.commit()
        db.refresh(user)

    if user.is_blocked:
        raise HTTPException(status_code=403, detail="حساب کاربری شما مسدود شده است")

    return user


def create_access_token(user: User) -> str:
    payload = {
        "sub": user.id,
        "phone_number": user.phone_number,
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

    return user