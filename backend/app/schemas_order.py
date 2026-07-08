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
    created_at: datetime
    updated_at: datetime

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
