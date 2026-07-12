from fastapi import APIRouter, HTTPException, Request

from app.rate_limit import limiter
from app.schemas.admin import AdminLoginIn, AdminLoginOut
from app.admin_auth import verify_admin_credentials, create_admin_token

router = APIRouter(prefix="/api/admin/auth", tags=["admin-auth"])


@router.post("/login", response_model=AdminLoginOut)
@limiter.limit("5/15minute")
async def admin_login(request: Request, payload: AdminLoginIn):
    if not verify_admin_credentials(payload.username, payload.password):
        raise HTTPException(status_code=401, detail="نام کاربری یا رمز عبور اشتباه است")
    return AdminLoginOut(token=create_admin_token())