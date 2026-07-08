from pydantic import BaseModel
from datetime import datetime
from typing import Optional

from app.schemas_order import OrderOut


class UserSummaryOut(BaseModel):
    id: str
    phone_number: str
    full_name: Optional[str] = None
    is_blocked: bool
    created_at: datetime
    gold_balance: float
    cash_balance: float


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
    phone_number: str
    full_name: Optional[str] = None
    is_blocked: bool
    created_at: datetime
    gold_balance: float
    cash_balance: float
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
