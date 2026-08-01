"""
Expert desk: live open-order board + Tehran melted-gold dealer hedges.

Balance model (گرم۱۸):
  - Customer BUY  (خرید مشتری از ما)  → we sell gold → cover by buying from Tehran
  - Customer SELL (فروش مشتری به ما) → we buy gold  → cover by selling to Tehran
  net = sell_weight - buy_weight
"""
from datetime import datetime, timedelta

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models_db import (
    Order,
    OrderStatusEnum,
    OrderSideEnum,
    TehranDealer,
    ExpertHedge,
    ExpertHedgeSideEnum,
)
from app.services.orders import (
    order_to_dict,
    weight_equivalent,
    order_total_toman,
)


def list_dealers(db: Session, active_only: bool = False) -> list[TehranDealer]:
    q = db.query(TehranDealer)
    if active_only:
        q = q.filter(TehranDealer.is_active == True)  # noqa: E712
    return q.order_by(TehranDealer.sort_order, TehranDealer.name).all()


def create_dealer(db: Session, name: str, phone: str | None, notes: str | None, sort_order: int = 0) -> TehranDealer:
    name = (name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="نام آبشده‌فروش الزامی است")
    exists = db.query(TehranDealer).filter(TehranDealer.name == name).first()
    if exists:
        raise HTTPException(status_code=400, detail="این نام قبلا ثبت شده است")
    row = TehranDealer(name=name, phone=phone or None, notes=notes or None, sort_order=sort_order or 0)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def update_dealer(
    db: Session,
    dealer_id: str,
    *,
    name: str | None = None,
    phone: str | None = None,
    notes: str | None = None,
    is_active: bool | None = None,
    sort_order: int | None = None,
) -> TehranDealer:
    row = db.query(TehranDealer).filter(TehranDealer.id == dealer_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="آبشده‌فروش پیدا نشد")
    if name is not None:
        name = name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="نام نمی‌تواند خالی باشد")
        clash = (
            db.query(TehranDealer)
            .filter(TehranDealer.name == name, TehranDealer.id != dealer_id)
            .first()
        )
        if clash:
            raise HTTPException(status_code=400, detail="این نام قبلا ثبت شده است")
        row.name = name
    if phone is not None:
        row.phone = phone or None
    if notes is not None:
        row.notes = notes or None
    if is_active is not None:
        row.is_active = bool(is_active)
    if sort_order is not None:
        row.sort_order = int(sort_order)
    db.commit()
    db.refresh(row)
    return row


def _open_orders(db: Session) -> list[Order]:
    """Pending orders still inside the admin countdown window."""
    now = datetime.utcnow()
    return (
        db.query(Order)
        .filter(
            Order.status == OrderStatusEnum.pending,
            Order.pending_deadline_at.isnot(None),
            Order.pending_deadline_at > now,
        )
        .order_by(Order.pending_deadline_at.asc())
        .all()
    )


def _hedges_since(db: Session, since: datetime) -> list[ExpertHedge]:
    return (
        db.query(ExpertHedge)
        .filter(ExpertHedge.created_at >= since)
        .order_by(ExpertHedge.created_at.desc())
        .all()
    )


def _hedge_out(h: ExpertHedge) -> dict:
    return {
        "id": h.id,
        "dealer_id": h.dealer_id,
        "dealer_name": h.dealer.name if h.dealer else "—",
        "side": h.side.value if hasattr(h.side, "value") else h.side,
        "weight_gram18": float(h.weight_gram18),
        "related_order_id": h.related_order_id,
        "note": h.note,
        "created_by": h.created_by,
        "created_at": h.created_at,
    }


def _order_hedged_weight(db: Session, order_id: str) -> float:
    rows = db.query(ExpertHedge).filter(ExpertHedge.related_order_id == order_id).all()
    return sum(float(r.weight_gram18) for r in rows)


def get_desk(db: Session) -> dict:
    orders = _open_orders(db)
    buy_orders = []
    sell_orders = []
    buy_w = buy_m = 0.0
    sell_w = sell_m = 0.0

    for o in orders:
        d = order_to_dict(db, o)
        w = weight_equivalent(o)
        m = order_total_toman(o)
        hedged = _order_hedged_weight(db, o.id)
        d["hedged_weight"] = hedged
        d["open_hedge_weight"] = max(0.0, w - hedged)
        if o.side == OrderSideEnum.buy:
            buy_orders.append(d)
            buy_w += w
            buy_m += m
        else:
            sell_orders.append(d)
            sell_w += w
            sell_m += m

    since = datetime.utcnow() - timedelta(hours=24)
    hedges = _hedges_since(db, since)
    hedged_buy = sum(float(h.weight_gram18) for h in hedges if h.side == ExpertHedgeSideEnum.buy_from_dealer)
    hedged_sell = sum(float(h.weight_gram18) for h in hedges if h.side == ExpertHedgeSideEnum.sell_to_dealer)

    net = sell_w - buy_w
    if abs(net) < 1e-9:
        direction = "balanced"
    elif net > 0:
        direction = "sell_to_tehran"
    else:
        direction = "buy_from_tehran"

    dealers = list_dealers(db, active_only=False)

    return {
        "buy_orders": buy_orders,
        "sell_orders": sell_orders,
        "totals": {
            "buy": {"count": len(buy_orders), "weight": buy_w, "money": buy_m},
            "sell": {"count": len(sell_orders), "weight": sell_w, "money": sell_m},
            "net_weight": net,
            "net_direction": direction,
            "hedged_buy_weight": hedged_buy,
            "hedged_sell_weight": hedged_sell,
            "open_buy_weight": max(0.0, buy_w - sum(o.get("hedged_weight", 0) for o in buy_orders)),
            "open_sell_weight": max(0.0, sell_w - sum(o.get("hedged_weight", 0) for o in sell_orders)),
        },
        "dealers": dealers,
        "hedges": [_hedge_out(h) for h in hedges],
    }


def create_hedge(
    db: Session,
    *,
    dealer_id: str,
    related_order_id: str | None,
    side: str | None,
    weight_gram18: float | None,
    note: str | None,
    created_by: str | None,
) -> dict:
    dealer = db.query(TehranDealer).filter(TehranDealer.id == dealer_id).first()
    if not dealer or not dealer.is_active:
        raise HTTPException(status_code=404, detail="آبشده‌فروش فعال پیدا نشد")

    order = None
    if related_order_id:
        order = db.query(Order).filter(Order.id == related_order_id).first()
        if not order:
            raise HTTPException(status_code=404, detail="سفارش پیدا نشد")
        # Infer hedge side from customer order side
        inferred = (
            ExpertHedgeSideEnum.buy_from_dealer
            if order.side == OrderSideEnum.buy
            else ExpertHedgeSideEnum.sell_to_dealer
        )
        hedge_side = inferred
        order_w = weight_equivalent(order)
        already = _order_hedged_weight(db, order.id)
        remaining = max(0.0, order_w - already)
        w = float(weight_gram18) if weight_gram18 is not None else remaining
        if w <= 0:
            raise HTTPException(status_code=400, detail="وزن باید بزرگتر از صفر باشد")
        if w > remaining + 1e-6:
            raise HTTPException(
                status_code=400,
                detail=f"حداکثر وزن قابل تخصیص برای این سفارش {remaining:.3f} گرم ۱۸ است",
            )
    else:
        if side not in ("buy_from_dealer", "sell_to_dealer"):
            raise HTTPException(status_code=400, detail="نوع معامله با آبشده‌فروش نامعتبر است")
        if weight_gram18 is None or float(weight_gram18) <= 0:
            raise HTTPException(status_code=400, detail="وزن باید بزرگتر از صفر باشد")
        hedge_side = ExpertHedgeSideEnum(side)
        w = float(weight_gram18)

    row = ExpertHedge(
        dealer_id=dealer_id,
        side=hedge_side,
        weight_gram18=w,
        related_order_id=related_order_id,
        note=note or None,
        created_by=created_by,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    # ensure relationship loaded
    _ = row.dealer
    return _hedge_out(row)


def delete_hedge(db: Session, hedge_id: str) -> None:
    row = db.query(ExpertHedge).filter(ExpertHedge.id == hedge_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="تراکنش پیدا نشد")
    db.delete(row)
    db.commit()
