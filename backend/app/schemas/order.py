from pydantic import BaseModel, field_serializer
from datetime import datetime
from typing import Optional


class OrderCreateIn(BaseModel):
    goldbridge_item_id: int
    side: str            # "buy" | "sell"
    amount_type: str     # "weight" | "amount" (gold items) | "count" (coin items)
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
    mesghal17_price_at_submit: Optional[float] = None
    mesghal17_raw_price_at_submit: Optional[float] = None
    goldbridge_item_id: Optional[int] = None
    # "price_change" when admin rejected specifically because the market
    # moved - drives the customer "تلاش با مظنه جدید" UX. Null otherwise.
    reject_reason: Optional[str] = None
    is_manual: bool = False
    has_receipt: bool = False
    pending_deadline_at: Optional[datetime] = None
    retry_count: int = 0
    # Computed from pending_deadline_at at response time - preferred
    # source for client countdowns so clock/timezone skew on naive
    # ISO timestamps doesn't desync the UI from the server window.
    seconds_remaining: Optional[int] = None
    max_retries: int = 5
    created_at: datetime
    updated_at: datetime

    # Only populated on admin-facing endpoints - who actually placed this
    # order, and their CURRENT balance (a live snapshot, not tied to this
    # specific order). Left null on the user's own /api/my/orders response
    # since they already know it's their own order.
    customer_name: Optional[str] = None
    customer_code: Optional[str] = None
    customer_phone: Optional[str] = None
    customer_gold_balance: Optional[float] = None
    customer_cash_balance: Optional[float] = None

    class Config:
        from_attributes = True

    @field_serializer("pending_deadline_at", "created_at", "updated_at")
    def serialize_dt_utc(self, value: datetime | None) -> str | None:
        """Always emit UTC with a trailing Z so every client parses the
        same absolute instant (avoids admin/client countdown drift)."""
        if value is None:
            return None
        text = value.isoformat()
        if value.tzinfo is None and not text.endswith("Z") and "+" not in text[-6:]:
            return f"{text}Z"
        return text


class OrderDecisionIn(BaseModel):
    # "accepted" | "rejected" | "rejected_price_change"
    status: str


class BalanceOut(BaseModel):
    gold_balance: float   # مثقال
    cash_balance: float   # تومان


class CardCommissionOut(BaseModel):
    goldbridge_item_id: int
    commission_type: str = "fixed"
    commission_value: float = 0.0


class OrderLimitsOut(BaseModel):
    min_weight: float   # گرم ۱۸
    max_weight: float   # گرم ۱۸
    min_amount: float   # تومان
    max_amount: float   # تومان (0 = بدون سقف)
    price_label_mode: str = "mesghal_and_gram18"  # "mesghal_and_gram18" | "gram18_only"
    commission_type: str = "fixed"   # "fixed" | "percentage" - this user's own commission
    commission_value: float = 0.0    # تومان اگر fixed, درصد اگر percentage
    trading_banned: bool = False
    pending_seconds: int = 120
    # Per-card commission overrides for this user's role (fallback = role default above).
    card_commissions: list[CardCommissionOut] = []


class OrderLimitsUpdateIn(BaseModel):
    min_weight: float | None = None
    max_weight: float | None = None
    min_amount: float | None = None
    max_amount: float | None = None
