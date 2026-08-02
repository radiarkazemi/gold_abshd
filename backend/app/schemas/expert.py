from pydantic import BaseModel
from datetime import datetime
from typing import Optional


class TehranDealerOut(BaseModel):
    id: str
    name: str
    phone: Optional[str] = None
    notes: Optional[str] = None
    is_active: bool = True
    sort_order: int = 0
    created_at: datetime

    class Config:
        from_attributes = True


class TehranDealerCreateIn(BaseModel):
    name: str
    phone: Optional[str] = None
    notes: Optional[str] = None
    sort_order: int = 0


class TehranDealerUpdateIn(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None
    sort_order: Optional[int] = None


class ExpertHedgeRelatedOrder(BaseModel):
    id: str
    side: str
    status: str
    customer_name: Optional[str] = None
    customer_code: Optional[str] = None
    weight_gram18: float = 0.0
    mesghal17_price_at_submit: Optional[float] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class ExpertHedgeOut(BaseModel):
    id: str
    dealer_id: str
    dealer_name: str
    side: str  # buy_from_dealer | sell_to_dealer
    weight_gram18: float
    price_mesghal17: Optional[float] = None  # فی معامله با تهران (مثقال ۱۷)
    related_order_id: Optional[str] = None
    related_order: Optional[ExpertHedgeRelatedOrder] = None
    note: Optional[str] = None
    created_by: Optional[str] = None
    created_at: datetime


class ExpertHedgeCreateIn(BaseModel):
    dealer_id: str
    # Optional: if set, side is inferred from the order (sell→sell_to_dealer, buy→buy_from_dealer)
    related_order_id: Optional[str] = None
    # Required when related_order_id is null; ignored (overridden) when order is set unless provided as override
    side: Optional[str] = None  # buy_from_dealer | sell_to_dealer
    weight_gram18: Optional[float] = None  # defaults to full order weight when order-linked
    price_mesghal17: Optional[float] = None  # فی مثقال معامله با تهران
    note: Optional[str] = None


class ExpertSideTotals(BaseModel):
    count: int = 0
    weight: float = 0.0
    money: float = 0.0
    pending_count: int = 0
    accepted_count: int = 0


class ExpertSuggestedCover(BaseModel):
    side: str  # buy_from_dealer | sell_to_dealer
    weight_gram18: float
    net_direction: str  # sell_to_tehran | buy_from_tehran


class ExpertUncoveredPending(BaseModel):
    buy_weight: float = 0.0
    sell_weight: float = 0.0
    buy_count: int = 0
    sell_count: int = 0


class ExpertDeskTotals(BaseModel):
    buy: ExpertSideTotals  # کارت خرید — فقط در انتظار
    sell: ExpertSideTotals  # کارت فروش — فقط در انتظار
    pending_count: int = 0
    accepted_count: int = 0  # accepted in session (used for Tehran net, not buy/sell cards)
    # مانده تهران: pending + accepted session, after hedges.
    # sell open - buy open. >0 → sell to Tehran; <0 → buy from Tehran.
    net_weight: float = 0.0
    net_direction: str = "balanced"  # balanced | sell_to_tehran | buy_from_tehran
    hedged_buy_weight: float = 0.0
    hedged_sell_weight: float = 0.0
    open_buy_weight: float = 0.0
    open_sell_weight: float = 0.0
    matched_weight: float = 0.0  # internal buy/sell offset in the session
    suggested_cover: Optional[ExpertSuggestedCover] = None
    uncovered_pending: ExpertUncoveredPending = ExpertUncoveredPending()


class ExpertDeskOut(BaseModel):
    buy_orders: list[dict]  # pending only — board left column
    sell_orders: list[dict]  # pending only — board right column
    accepted_buy_orders: list[dict] = []
    accepted_sell_orders: list[dict] = []
    totals: ExpertDeskTotals
    dealers: list[TehranDealerOut]
    hedges: list[ExpertHedgeOut]
    session_hours: int = 36
