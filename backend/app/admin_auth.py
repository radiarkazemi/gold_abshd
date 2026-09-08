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
from fastapi import Depends, HTTPException, Header, Request, Response
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.permissions import PERMISSION_SCOPES
from app.services.admin_accounts import get_sub_admin
from app.services.admin_devices import find_admin_device, touch_admin_device, register_or_touch_admin_device

# 7 days — iPhone PWA / home-screen admins were getting kicked out
# every launch because the old 12-hour JWT + isolated Safari storage
# expired (or failed a device-id check) before they reopened the panel.
ADMIN_TOKEN_EXPIRE_MINUTES = 7 * 24 * 60
ADMIN_TOKEN_COOKIE = "goldapp_admin_token"
ADMIN_DEVICE_COOKIE = "goldapp_admin_device"
ADMIN_COOKIE_MAX_AGE = ADMIN_TOKEN_EXPIRE_MINUTES * 60


def _cookie_secure() -> bool:
    return not bool(getattr(settings, "DEBUG", False))


def attach_admin_session(response: Response, token: str, device_id: str = "") -> None:
    """Persist JWT + device id as cookies so iOS standalone PWA and Safari
    share the same session when the cookie jar is shared."""
    secure = _cookie_secure()
    response.set_cookie(
        ADMIN_TOKEN_COOKIE,
        token,
        max_age=ADMIN_COOKIE_MAX_AGE,
        httponly=True,
        samesite="lax",
        path="/",
        secure=secure,
    )
    if device_id:
        response.set_cookie(
            ADMIN_DEVICE_COOKIE,
            device_id,
            max_age=ADMIN_COOKIE_MAX_AGE,
            httponly=False,
            samesite="lax",
            path="/",
            secure=secure,
        )


def clear_admin_session(response: Response) -> None:
    response.delete_cookie(ADMIN_TOKEN_COOKIE, path="/")
    response.delete_cookie(ADMIN_DEVICE_COOKIE, path="/")


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
    device_id: str = "",
) -> str:
    payload = {
        "role": "admin",
        "username": username,
        "is_super": is_super,
        "admin_user_id": admin_user_id,
        "permissions": permissions or [],
        "device_id": device_id,
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


def _ensure_admin_device_allowed(db: Session, payload: dict, device_id: str) -> None:
    admin_user_id = payload.get("admin_user_id")
    if not admin_user_id or not device_id:
        return
    admin = get_sub_admin(db, admin_user_id)
    if not admin:
        raise HTTPException(status_code=401, detail="نشست ادمین نامعتبر است")
    if find_admin_device(db, admin, device_id):
        touch_admin_device(db, admin, device_id)
        return
    # Safari vs iOS home-screen PWA often mint two device ids for the
    # same person. Bind this one (evict oldest if over the limit)
    # instead of forcing a full re-login.
    register_or_touch_admin_device(db, admin, device_id)


def get_current_admin(
    request: Request,
    authorization: str | None = Header(default=None),
    x_admin_device_id: str | None = Header(default=None, alias="X-Admin-Device-Id"),
    db: Session = Depends(get_db),
) -> dict:
    """Use as a FastAPI dependency on every admin HTTP endpoint. Returns
    the decoded token payload - {"username", "is_super", "admin_user_id",
    "permissions", ...} - so callers can check scope themselves, or use
    require_permission() below to enforce it declaratively."""
    token = ""
    if authorization and authorization.startswith("Bearer "):
        token = authorization.removeprefix("Bearer ").strip()
    if not token:
        token = (request.cookies.get(ADMIN_TOKEN_COOKIE) or "").strip()
    if not token:
        raise HTTPException(
            status_code=401, detail="ابتدا به عنوان ادمین وارد شوید")
    payload = _decode_admin_token(token)
    device_id = (
        (x_admin_device_id or "").strip()
        or (request.cookies.get(ADMIN_DEVICE_COOKIE) or "").strip()
        or (payload.get("device_id") or "")
    ).strip()
    _ensure_admin_device_allowed(db, payload, device_id)
    return payload


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


def verify_admin_ws_token(
    token: str | None,
    device_id: str | None = None,
    db: Session | None = None,
) -> dict:
    """Use inside the admin WebSocket endpoint (token passed as ?token=...)."""
    if not token:
        raise HTTPException(
            status_code=401, detail="ابتدا به عنوان ادمین وارد شوید")
    payload = _decode_admin_token(token)
    if db is not None:
        resolved_device = (device_id or payload.get("device_id") or "").strip()
        _ensure_admin_device_allowed(db, payload, resolved_device)
    return payload
