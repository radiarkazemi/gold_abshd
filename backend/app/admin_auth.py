"""
Admin authentication.

Separate from the user OTP login on purpose - there is exactly one admin
identity (a username + bcrypt password hash in .env), and this issues a
JWT carrying "role": "admin" that get_current_admin checks for. Regular
user tokens (from OTP login) do NOT have this claim and will be rejected
by any admin-only endpoint.
"""
from datetime import datetime, timedelta

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Header, Query

from app.config import settings

# 12 hours - shorter-lived than user tokens
ADMIN_TOKEN_EXPIRE_MINUTES = 12 * 60


def verify_admin_credentials(username: str, password: str) -> bool:
    if not settings.ADMIN_PASSWORD_HASH:
        # No admin password configured yet - refuse rather than silently
        # allowing anything through.
        return False
    if username != settings.ADMIN_USERNAME:
        return False
    return bcrypt.checkpw(password.encode(), settings.ADMIN_PASSWORD_HASH.encode())


def create_admin_token() -> str:
    payload = {
        "role": "admin",
        "username": settings.ADMIN_USERNAME,
        "exp": datetime.utcnow() + timedelta(minutes=ADMIN_TOKEN_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm="HS256")


def _decode_admin_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=401, detail="نشست ادمین منقضی شده، دوباره وارد شوید")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="توکن نامعتبر است")

    if payload.get("role") != "admin":
        raise HTTPException(status_code=403, detail="دسترسی ادمین ندارید")
    return payload


def get_current_admin(authorization: str | None = Header(default=None)) -> dict:
    """Use as a FastAPI dependency on every admin HTTP endpoint."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401, detail="ابتدا به عنوان ادمین وارد شوید")
    token = authorization.removeprefix("Bearer ").strip()
    return _decode_admin_token(token)


def verify_admin_ws_token(token: str | None) -> dict:
    """Use inside the admin WebSocket endpoint (token passed as ?token=...)."""
    if not token:
        raise HTTPException(
            status_code=401, detail="ابتدا به عنوان ادمین وارد شوید")
    return _decode_admin_token(token)
