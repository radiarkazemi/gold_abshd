from pydantic import BaseModel
from datetime import datetime
from typing import Optional


class OrderCreateIn(BaseModel):
    side: str            # "buy" | "sell"
    amount_type: str     # "weight" | "amount"
    value: float
    description: Optional[str] = ""


class OrderOut(BaseModel):
    id: str
    user_id: Optional[str] = None
    side: str
    amount_type: str
    value: float
    description: Optional[str] = ""
    status: str
    price_at_submit: float
    has_receipt: bool = False
    created_at: datetime
    updated_at: datetime

    # Only populated on admin-facing endpoints - who actually placed this
    # order. Left null on the user's own /api/my/orders response since
    # they already know it's their own order.
    customer_name: Optional[str] = None
    customer_code: Optional[str] = None
    customer_phone: Optional[str] = None

    class Config:
        from_attributes = True


class OrderDecisionIn(BaseModel):
    status: str   # "accepted" | "rejected"


class BalanceOut(BaseModel):
    gold_balance: float   # مثقال
    cash_balance: float   # تومان


class OrderLimitsOut(BaseModel):
    min_weight: float   # مثقال
    max_weight: float   # مثقال