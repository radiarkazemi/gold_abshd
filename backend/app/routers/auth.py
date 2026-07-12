from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.db import get_db
from app.config import settings
from app.rate_limit import limiter
from app.schemas.auth import RequestOtpIn, RequestOtpOut, VerifyOtpIn, VerifyOtpOut, UserOut
from app.auth import (
    create_otp_for_phone,
    verify_otp_and_get_user,
    create_access_token,
    get_current_user,
    get_user_for_login,
    check_device_or_require_key,
)
from app.models_db import User

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/request-otp", response_model=RequestOtpOut)
@limiter.limit("5/minute")
async def request_otp(request: Request, payload: RequestOtpIn, db: Session = Depends(get_db)):
    user = get_user_for_login(db, payload.phone_number)
    check_device_or_require_key(user, payload.device_id, payload.registration_key, db)

    code = create_otp_for_phone(db, payload.phone_number)
    return RequestOtpOut(
        message="کد تایید ارسال شد",
        debug_code=code if settings.DEBUG_OTP else None,
    )


@router.post("/verify-otp", response_model=VerifyOtpOut)
@limiter.limit("10/5minute")
async def verify_otp(request: Request, payload: VerifyOtpIn, db: Session = Depends(get_db)):
    user = verify_otp_and_get_user(
        db,
        payload.phone_number,
        payload.code,
        payload.device_id,
        payload.registration_key,
        payload.device_info or "",
    )
    token = create_access_token(user)
    return VerifyOtpOut(token=token, user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut)
async def get_me(current_user: User = Depends(get_current_user)):
    return UserOut.model_validate(current_user)