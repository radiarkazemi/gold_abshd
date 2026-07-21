from pydantic import BaseModel
from datetime import datetime
from typing import Optional

from app.schemas.order import OrderOut


class RoleOut(BaseModel):
    id: str
    name: str
    commission_type: str
    commission_value: float
    min_weight: Optional[float] = None
    max_weight: Optional[float] = None
    min_amount: Optional[float] = None
    max_amount: Optional[float] = None
    price_label_mode: str = "mesghal_and_gram18"  # "mesghal_and_gram18" | "gram18_only"
    created_at: datetime

    class Config:
        from_attributes = True


class RoleCreateIn(BaseModel):
    name: str
    commission_type: str  # "fixed" | "percentage"
    commission_value: float
    min_weight: Optional[float] = None
    max_weight: Optional[float] = None
    min_amount: Optional[float] = None
    max_amount: Optional[float] = None
    price_label_mode: str = "mesghal_and_gram18"


class RoleUpdateIn(BaseModel):
    commission_type: str
    commission_value: float
    min_weight: Optional[float] = None
    max_weight: Optional[float] = None
    min_amount: Optional[float] = None
    max_amount: Optional[float] = None
    price_label_mode: Optional[str] = None  # None = leave unchanged - see services/roles.py


class RegistrationKeyOut(BaseModel):
    key: str
    status: str
    expires_at: datetime
    activated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class AdminCreateUserIn(BaseModel):
    phone_number: str
    full_name: str
    role_id: str
    national_id: str
    notes: Optional[str] = None
    key_ttl_days: int = 14


class AdminCreateUserOut(BaseModel):
    user_id: str
    user_code: str
    phone_number: str
    registration_key: str  # shown ONCE at creation time - hand this to the user
    expires_at: datetime


class AdminUpdateUserIn(BaseModel):
    full_name: Optional[str] = None
    role_id: Optional[str] = None
    national_id: Optional[str] = None
    notes: Optional[str] = None


class PhoneOrderCreateIn(BaseModel):
    user_id: str
    side: str                  # "buy" | "sell"
    amount_type: str           # "weight" | "amount"
    value: float
    mesghal17_price: float     # admin-entered, already-negotiated price
    description: Optional[str] = ""


class UserSummaryOut(BaseModel):
    id: str
    user_code: str
    phone_number: str
    full_name: Optional[str] = None
    is_blocked: bool
    created_at: datetime
    gold_balance: float
    cash_balance: float
    role: Optional[RoleOut] = None
    is_online: bool = False
    registration_status: Optional[str] = None  # pending | active | banned | None (no key issued)


class TransactionOut(BaseModel):
    id: str
    gold_change: float
    cash_change: float
    reason: str
    note: str
    related_order_id: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class UserDetailOut(BaseModel):
    id: str
    user_code: str
    phone_number: str
    full_name: Optional[str] = None
    national_id: Optional[str] = None
    notes: Optional[str] = None
    is_blocked: bool
    created_at: datetime
    gold_balance: float
    cash_balance: float
    role: Optional[RoleOut] = None
    is_online: bool = False
    device_info: Optional[str] = None
    registration_key: Optional[RegistrationKeyOut] = None
    orders: list[OrderOut]
    transactions: list[TransactionOut]


class BalanceAdjustIn(BaseModel):
    gold_change: float = 0
    cash_change: float = 0
    note: str = ""


class BlockUserIn(BaseModel):
    is_blocked: bool


class AdminLoginIn(BaseModel):
    username: str
    password: str


class AdminLoginOut(BaseModel):
    """
    For the super-admin, or a sub-admin whose OTP step just succeeded:
    token is set, requires_verification is False.

    For a sub-admin right after a correct password (before OTP): token
    is None, requires_verification is True, admin_user_id identifies
    which account to complete verification for at
    POST /api/admin/auth/verify, and is_first_activation tells the
    frontend whether to also ask for the registration key.
    """
    token: str | None = None
    requires_verification: bool = False
    admin_user_id: str | None = None
    is_first_activation: bool = False
    is_super: bool = True
    display_name: str = ""
    permissions: list[str] = []
    debug_code: str | None = None  # only set when GOLDAPP_DEBUG_OTP=true (dev/no real SMS provider)


class AdminVerifyIn(BaseModel):
    admin_user_id: str
    code: str
    registration_key: str | None = None