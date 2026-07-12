from pydantic import BaseModel, Field


class RequestOtpIn(BaseModel):
    phone_number: str = Field(..., examples=["09121234567"])
    device_id: str
    registration_key: str | None = None  # required only on first-ever login


class RequestOtpOut(BaseModel):
    message: str
    # Only populated when DEBUG_OTP=true (see .env) - lets you test without
    # a real SMS provider. Turn DEBUG_OTP off before going live.
    debug_code: str | None = None


class VerifyOtpIn(BaseModel):
    phone_number: str
    code: str
    device_id: str
    registration_key: str | None = None
    device_info: str | None = ""  # user-agent string, informational only


class RoleOut(BaseModel):
    id: str
    name: str
    commission_type: str
    commission_value: float

    class Config:
        from_attributes = True


class UserOut(BaseModel):
    id: str
    user_code: str
    phone_number: str
    full_name: str | None = None
    is_blocked: bool
    role: RoleOut | None = None

    class Config:
        from_attributes = True


class VerifyOtpOut(BaseModel):
    token: str
    user: UserOut