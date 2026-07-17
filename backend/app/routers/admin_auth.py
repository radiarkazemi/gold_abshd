from fastapi import APIRouter, HTTPException, Request, Depends
from sqlalchemy.orm import Session

from app.rate_limit import limiter
from app.db import get_db
from app.config import settings
from app.schemas.admin import AdminLoginIn, AdminLoginOut, AdminVerifyIn
from app.admin_auth import verify_super_admin_credentials, create_admin_token
from app.permissions import PERMISSION_SCOPES
from app.services.admin_accounts import (
    verify_sub_admin_password,
    send_login_otp,
    verify_login_otp,
    get_sub_admin,
    admin_user_permissions,
    log_activity,
)

router = APIRouter(prefix="/api/admin/auth", tags=["admin-auth"])


@router.post("/login", response_model=AdminLoginOut)
@limiter.limit("5/15minute")
async def admin_login(request: Request, payload: AdminLoginIn, db: Session = Depends(get_db)):
    # Try the super-admin (env-based) credentials first - unchanged,
    # single-step, no OTP.
    if verify_super_admin_credentials(payload.username, payload.password):
        log_activity(db, settings.ADMIN_USERNAME, True, "login")
        return AdminLoginOut(
            token=create_admin_token(settings.ADMIN_USERNAME, is_super=True),
            requires_verification=False,
            is_super=True,
            display_name="مدیر اصلی",
            permissions=list(PERMISSION_SCOPES.keys()),
        )

    # Sub-admin: password is step 1 only. On success, send an OTP and
    # tell the frontend to go to the verification page instead of
    # issuing a token yet.
    sub_admin = verify_sub_admin_password(
        db, payload.username, payload.password)
    if sub_admin:
        try:
            code = send_login_otp(db, sub_admin)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

        return AdminLoginOut(
            token=None,
            requires_verification=True,
            admin_user_id=sub_admin.id,
            is_first_activation=sub_admin.activated_at is None,
            is_super=False,
            display_name=sub_admin.full_name or sub_admin.username,
            permissions=admin_user_permissions(sub_admin),
            debug_code=code if settings.DEBUG_OTP else None,
        )

    raise HTTPException(
        status_code=401, detail="نام کاربری یا رمز عبور اشتباه است")


@router.post("/verify", response_model=AdminLoginOut)
@limiter.limit("5/15minute")
async def admin_verify(request: Request, payload: AdminVerifyIn, db: Session = Depends(get_db)):
    """Step 2 for a sub-admin: SMS code (and, on first login, the
    registration key handed out at account creation)."""
    sub_admin = get_sub_admin(db, payload.admin_user_id)
    if not sub_admin or not sub_admin.is_active:
        raise HTTPException(status_code=404, detail="حساب پیدا نشد")

    try:
        sub_admin = verify_login_otp(
            db, sub_admin, payload.code, payload.registration_key)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    perms = admin_user_permissions(sub_admin)
    log_activity(db, sub_admin.username, False, "login")

    return AdminLoginOut(
        token=create_admin_token(
            sub_admin.username, is_super=False, admin_user_id=sub_admin.id, permissions=perms),
        requires_verification=False,
        is_super=False,
        display_name=sub_admin.full_name or sub_admin.username,
        permissions=perms,
    )
