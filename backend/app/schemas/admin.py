from pydantic import BaseModel
from datetime import datetime
from typing import Optional

from app.schemas.order import OrderOut


class RoleOut(BaseModel):
    id: str
    name: str
    commission_type: str
    commission_value: float
    created_at: datetime

    class Config:
        from_attributes = True


class RoleCreateIn(BaseModel):
    name: str
    commission_type: str  # "fixed" | "percentage"
    commission_value: float


class RoleUpdateIn(BaseModel):
    commission_type: str
    commission_value: float


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
    token: str