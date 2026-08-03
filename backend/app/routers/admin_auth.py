from fastapi import APIRouter, HTTPException, Request, Depends
from sqlalchemy.orm import Session

from app.rate_limit import limiter
from app.db import get_db
from app.config import settings
from app.schemas.admin import AdminLoginIn, AdminLoginOut, AdminVerifyIn
from app.admin_auth import create_admin_token, get_current_admin
from app.permissions import PERMISSION_SCOPES
from app.models_db import AdminUser
from app.services.admin_accounts import (
    verify_sub_admin_password,
    send_login_otp,
    verify_login_otp,
    get_sub_admin,
    admin_user_permissions,
    log_activity,
    mark_login,
)
from app.staging_gate import assert_staging_admin_allowed

router = APIRouter(prefix="/api/admin/auth", tags=["admin-auth"])


@router.post("/login", response_model=AdminLoginOut)
@limiter.limit("5/15minute")
async def admin_login(request: Request, payload: AdminLoginIn, db: Session = Depends(get_db)):
    # Single unified check now - the super-admin is just an AdminUser
    # row with is_super=True (auto-seeded once from .env on first
    # startup - see services.admin_accounts.ensure_super_admin_seeded).
    # .env is never read for login itself, only as that one-time seed.
    admin = verify_sub_admin_password(db, payload.username, payload.password)
    if not admin:
        raise HTTPException(status_code=401, detail="نام کاربری یا رمز عبور اشتباه است")

    assert_staging_admin_allowed(admin.username)

    if admin.is_super:
        # Super-admin skips OTP entirely - unchanged behavior from before.
        mark_login(db, admin)
        log_activity(db, admin.username, True, "login")
        return AdminLoginOut(
            token=create_admin_token(admin.username, is_super=True, admin_user_id=admin.id),
            requires_verification=False,
            is_super=True,
            display_name=admin.full_name or "مدیر اصلی",
            permissions=list(PERMISSION_SCOPES.keys()),
        )

    # Sub-admin: password is step 1 only. On success, send an OTP and
    # tell the frontend to go to the verification page instead of
    # issuing a token yet.
    try:
        code = send_login_otp(db, admin)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return AdminLoginOut(
        token=None,
        requires_verification=True,
        admin_user_id=admin.id,
        is_first_activation=admin.activated_at is None,
        is_super=False,
        display_name=admin.full_name or admin.username,
        permissions=admin_user_permissions(admin),
        debug_code=code if settings.DEBUG_OTP else None,
    )


@router.post("/verify", response_model=AdminLoginOut)
@limiter.limit("5/15minute")
async def admin_verify(request: Request, payload: AdminVerifyIn, db: Session = Depends(get_db)):
    """Step 2 for a sub-admin: SMS code (and, on first login, the
    registration key handed out at account creation)."""
    sub_admin = get_sub_admin(db, payload.admin_user_id)
    if not sub_admin or not sub_admin.is_active:
        raise HTTPException(status_code=404, detail="حساب پیدا نشد")

    assert_staging_admin_allowed(sub_admin.username)

    try:
        sub_admin = verify_login_otp(db, sub_admin, payload.code, payload.registration_key)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    perms = admin_user_permissions(sub_admin)
    log_activity(db, sub_admin.username, False, "login")

    return AdminLoginOut(
        token=create_admin_token(sub_admin.username, is_super=False, admin_user_id=sub_admin.id, permissions=perms),
        requires_verification=False,
        is_super=False,
        display_name=sub_admin.full_name or sub_admin.username,
        permissions=perms,
    )


@router.get("/me", response_model=AdminLoginOut)
async def admin_me(db: Session = Depends(get_db), admin: dict = Depends(get_current_admin)):
    """Refresh identity + JWT from the live DB row.

    Newly promoted main admins (or newly granted scopes) pick up access
    on the next soft page load without clearing browser data.
    """
    admin_user_id = admin.get("admin_user_id")
    row = get_sub_admin(db, admin_user_id) if admin_user_id else None
    if not row:
        row = (
            db.query(AdminUser)
            .filter(AdminUser.username == admin.get("username"), AdminUser.is_active == True)  # noqa: E712
            .first()
        )
    if not row or not row.is_active:
        raise HTTPException(status_code=401, detail="نشست ادمین نامعتبر است")

    if row.is_super:
        perms = list(PERMISSION_SCOPES.keys())
        token = create_admin_token(row.username, is_super=True, admin_user_id=row.id, permissions=perms)
        return AdminLoginOut(
            token=token,
            requires_verification=False,
            is_super=True,
            display_name=row.full_name or "مدیر اصلی",
            permissions=perms,
        )

    perms = admin_user_permissions(row)
    token = create_admin_token(row.username, is_super=False, admin_user_id=row.id, permissions=perms)
    return AdminLoginOut(
        token=token,
        requires_verification=False,
        is_super=False,
        display_name=row.full_name or row.username,
        permissions=perms,
    )
