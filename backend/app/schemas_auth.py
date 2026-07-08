from pydantic import BaseModel, Field


class RequestOtpIn(BaseModel):
    phone_number: str = Field(..., examples=["09121234567"])


class RequestOtpOut(BaseModel):
    message: str
    # Only populated when DEBUG_OTP=true (see .env) - lets you test without
    # a real SMS provider. Turn DEBUG_OTP off before going live.
    debug_code: str | None = None


class VerifyOtpIn(BaseModel):
    phone_number: str
    code: str


class UserOut(BaseModel):
    id: str
    phone_number: str
    full_name: str | None = None
    is_blocked: bool

    class Config:
        from_attributes = True


class VerifyOtpOut(BaseModel):
    token: str
    user: UserOut