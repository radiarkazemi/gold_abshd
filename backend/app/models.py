"""
مدل‌های داده برای اپ آبشده قصر طلا
واحد قیمت: مثقال ۱۷ عیار (مظنه)
"""
from pydantic import BaseModel, Field
from enum import Enum
from datetime import datetime
from typing import Optional
import uuid


class OrderSide(str, Enum):
    BUY = "buy"      # کاربر می‌خواد طلا بخره (از دکمه Buy)
    SELL = "sell"    # کاربر می‌خواد طلا بفروشه (از دکمه Sell)


class OrderStatus(str, Enum):
    PENDING = "pending"
    ACCEPTED = "accepted"
    REJECTED = "rejected"


class AmountType(str, Enum):
    WEIGHT = "weight"   # وزن (مثقال / گرم)
    AMOUNT = "amount"   # مبلغ (تومان / ریال)


class GoldPrice(BaseModel):
    buy_price: float          # قیمت خرید (مظنه) - per مثقال ۱۷
    sell_price: float         # قیمت فروش (مظنه) - per مثقال ۱۷
    gram18_buy_price: float | None = None   # همان قیمت‌ها به ازای هر گرم ۱۸
    gram18_sell_price: float | None = None
    unit: str = "مثقال ۱۷"
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class OrderCreate(BaseModel):
    side: OrderSide
    amount_type: AmountType
    value: float               # مقدار وارد شده (وزن یا مبلغ)
    description: Optional[str] = ""


class Order(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    side: OrderSide
    amount_type: AmountType
    value: float
    description: Optional[str] = ""
    status: OrderStatus = OrderStatus.PENDING
    price_at_submit: float          # قیمتی که هنگام ثبت سفارش فعال بوده
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class OrderDecision(BaseModel):
    status: OrderStatus   # فقط ACCEPTED یا REJECTED