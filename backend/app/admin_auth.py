"""
Admin authentication.

Two kinds of admin identity now:
  1. The super-admin - exactly one, username + bcrypt hash in .env,
     unchanged from before. Always has every permission implicitly
     (is_super=True in their JWT).
  2. Sub-admins (accountant, manager, etc) - rows in the admin_users
     table, created BY the super-admin via /api/admin/admins. Each has
     their own username/password and an explicit list of permission
     scopes (see app/permissions.py) limiting which admin tabs they
     can use.

Both log in through the same /api/admin/auth/login endpoint; which
kind a request is authenticates against is tried in order (env
super-admin first, then the admin_users table) - see routers/admin_auth.py.

Regular user tokens (from OTP login) do NOT have "role": "admin" and
will be rejected by any admin-only endpoint, same as before.
"""
from datetime import datetime, timedelta

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Header

from app.config import settings
from app.permissions import PERMISSION_SCOPES

# 12 hours - shorter-lived than user tokens
ADMIN_TOKEN_EXPIRE_MINUTES = 12 * 60


def verify_super_admin_credentials(username: str, password: str) -> bool:
    if not settings.ADMIN_PASSWORD_HASH:
        # No admin password configured yet - refuse rather than silently
        # allowing anything through.
        return False
    if username != settings.ADMIN_USERNAME:
        return False
    return bcrypt.checkpw(password.encode(), settings.ADMIN_PASSWORD_HASH.encode())


# Kept for backwards compatibility with anything still importing the old name.
verify_admin_credentials = verify_super_admin_credentials


def create_admin_token(
    username: str,
    is_super: bool,
    admin_user_id: str | None = None,
    permissions: list[str] | None = None,
) -> str:
    payload = {
        "role": "admin",
        "username": username,
        "is_super": is_super,
        "admin_user_id": admin_user_id,
        "permissions": permissions or [],
        "exp": datetime.utcnow() + timedelta(minutes=ADMIN_TOKEN_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm="HS256")


def create_super_admin_token() -> str:
    """Kept as a separate name for the one call site that logs in the
    super-admin specifically (see routers/admin_auth.py)."""
    return create_admin_token(settings.ADMIN_USERNAME, is_super=True)


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
    """Use as a FastAPI dependency on every admin HTTP endpoint. Returns
    the decoded token payload - {"username", "is_super", "admin_user_id",
    "permissions", ...} - so callers can check scope themselves, or use
    require_permission() below to enforce it declaratively."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401, detail="ابتدا به عنوان ادمین وارد شوید")
    token = authorization.removeprefix("Bearer ").strip()
    return _decode_admin_token(token)


def require_permission(scope: str):
    """
    Dependency factory: Depends(require_permission("roles")) rejects
    with 403 unless the caller is the super-admin or has that scope in
    their token's permissions. Use this instead of bare
    Depends(get_current_admin) on endpoints that should be restricted
    to specific sub-admin scopes.
    """
    if scope not in PERMISSION_SCOPES:
        raise ValueError(f"Unknown permission scope: {scope!r}")

    def _dependency(admin: dict = Depends(get_current_admin)) -> dict:
        if admin.get("is_super"):
            return admin
        if scope in (admin.get("permissions") or []):
            return admin
        raise HTTPException(
            status_code=403, detail="شما به این بخش دسترسی ندارید")

    return _dependency


def require_super_admin(admin: dict = Depends(get_current_admin)) -> dict:
    """For endpoints only the super-admin may use (managing sub-admins)."""
    if not admin.get("is_super"):
        raise HTTPException(
            status_code=403, detail="فقط مدیر اصلی به این بخش دسترسی دارد")
    return admin


def verify_admin_ws_token(token: str | None) -> dict:
    """Use inside the admin WebSocket endpoint (token passed as ?token=...)."""
    if not token:
        raise HTTPException(
            status_code=401, detail="ابتدا به عنوان ادمین وارد شوید")
    return _decode_admin_token(token)
