"""
Expert desk: live open-order board + Tehran melted-gold dealer hedges.

Desk session balance (گرم۱۸) persists across accepts:
  - Includes PENDING (countdown still open) + ACCEPTED in the session window
  - Customer BUY  (خرید مشتری از ما)  → we sell gold → cover by buying from Tehran
  - Customer SELL (فروش مشتری به ما) → we buy gold  → cover by selling to Tehran
  - net = sell_weight - buy_weight (after subtracting Tehran hedges)
  - Accepting an order moves it from the pending board into the accepted table
    without zeroing the running totals.
"""
from datetime import datetime, timedelta

from fastapi import HTTPException
from sqlalchemy.orm import Session, joinedload

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

# How far back accepted orders stay on the expert desk table / balance.
SESSION_HOURS = 36


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


def _session_since() -> datetime:
    return datetime.utcnow() - timedelta(hours=SESSION_HOURS)


def _pending_orders(db: Session) -> list[Order]:
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


def _accepted_session_orders(db: Session) -> list[Order]:
    """Accepted orders that still belong to the running desk session."""
    since = _session_since()
    return (
        db.query(Order)
        .filter(
            Order.status == OrderStatusEnum.accepted,
            Order.updated_at >= since,
        )
        .order_by(Order.updated_at.desc())
        .all()
    )


def _hedges_since(db: Session, since: datetime) -> list[ExpertHedge]:
    return (
        db.query(ExpertHedge)
        .options(joinedload(ExpertHedge.dealer))
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


def _order_hedged_weight(db: Session, order_id: str, cache: dict[str, float] | None = None) -> float:
    if cache is not None and order_id in cache:
        return cache[order_id]
    rows = db.query(ExpertHedge).filter(ExpertHedge.related_order_id == order_id).all()
    total = sum(float(r.weight_gram18) for r in rows)
    if cache is not None:
        cache[order_id] = total
    return total


def _enrich_order(db: Session, order: Order, hedge_cache: dict[str, float]) -> dict:
    d = order_to_dict(db, order)
    w = weight_equivalent(order)
    hedged = _order_hedged_weight(db, order.id, hedge_cache)
    d["weight_gram18"] = w
    d["money_toman"] = order_total_toman(order)
    d["hedged_weight"] = hedged
    d["open_hedge_weight"] = max(0.0, w - hedged)
    d["is_fully_hedged"] = hedged >= w - 1e-6
    return d


def _side_bucket(orders: list[dict]) -> dict:
    return {
        "count": len(orders),
        "weight": sum(float(o.get("weight_gram18") or 0) for o in orders),
        "money": sum(float(o.get("money_toman") or 0) for o in orders),
        "open_weight": sum(float(o.get("open_hedge_weight") or 0) for o in orders),
    }


def get_desk(db: Session) -> dict:
    hedge_cache: dict[str, float] = {}
    pending = [_enrich_order(db, o, hedge_cache) for o in _pending_orders(db)]
    accepted = [_enrich_order(db, o, hedge_cache) for o in _accepted_session_orders(db)]

    pending_buy = [o for o in pending if o.get("side") == "buy"]
    pending_sell = [o for o in pending if o.get("side") == "sell"]
    accepted_buy = [o for o in accepted if o.get("side") == "buy"]
    accepted_sell = [o for o in accepted if o.get("side") == "sell"]

    # Running desk position = pending + accepted in session (does not reset on accept).
    desk_buy = pending_buy + accepted_buy
    desk_sell = pending_sell + accepted_sell
    buy_bucket = _side_bucket(desk_buy)
    sell_bucket = _side_bucket(desk_sell)

    since = _session_since()
    hedges = _hedges_since(db, since)
    # Free-standing hedges (no order) also reduce net exposure by side.
    free_buy = sum(
        float(h.weight_gram18)
        for h in hedges
        if h.side == ExpertHedgeSideEnum.buy_from_dealer and not h.related_order_id
    )
    free_sell = sum(
        float(h.weight_gram18)
        for h in hedges
        if h.side == ExpertHedgeSideEnum.sell_to_dealer and not h.related_order_id
    )

    # Unhedged remaining after per-order hedges + free desk trades.
    open_buy = max(0.0, buy_bucket["open_weight"] - free_buy)
    open_sell = max(0.0, sell_bucket["open_weight"] - free_sell)
    net = open_sell - open_buy
    if abs(net) < 1e-6:
        direction = "balanced"
    elif net > 0:
        direction = "sell_to_tehran"
    else:
        direction = "buy_from_tehran"

    hedged_buy = sum(float(h.weight_gram18) for h in hedges if h.side == ExpertHedgeSideEnum.buy_from_dealer)
    hedged_sell = sum(float(h.weight_gram18) for h in hedges if h.side == ExpertHedgeSideEnum.sell_to_dealer)

    return {
        "buy_orders": pending_buy,
        "sell_orders": pending_sell,
        "accepted_buy_orders": accepted_buy,
        "accepted_sell_orders": accepted_sell,
        "totals": {
            "buy": {
                "count": buy_bucket["count"],
                "weight": buy_bucket["weight"],
                "money": buy_bucket["money"],
                "pending_count": len(pending_buy),
                "accepted_count": len(accepted_buy),
            },
            "sell": {
                "count": sell_bucket["count"],
                "weight": sell_bucket["weight"],
                "money": sell_bucket["money"],
                "pending_count": len(pending_sell),
                "accepted_count": len(accepted_sell),
            },
            "pending_count": len(pending),
            "accepted_count": len(accepted),
            "net_weight": net,
            "net_direction": direction,
            "hedged_buy_weight": hedged_buy,
            "hedged_sell_weight": hedged_sell,
            "open_buy_weight": open_buy,
            "open_sell_weight": open_sell,
            "matched_weight": min(buy_bucket["weight"], sell_bucket["weight"]),
        },
        "dealers": list_dealers(db, active_only=False),
        "hedges": [_hedge_out(h) for h in hedges],
        "session_hours": SESSION_HOURS,
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

    if related_order_id:
        order = db.query(Order).filter(Order.id == related_order_id).first()
        if not order:
            raise HTTPException(status_code=404, detail="سفارش پیدا نشد")
        if order.status not in (OrderStatusEnum.pending, OrderStatusEnum.accepted):
            raise HTTPException(status_code=400, detail="فقط سفارش‌های در انتظار یا تاییدشده قابل تخصیص هستند")
        hedge_side = (
            ExpertHedgeSideEnum.buy_from_dealer
            if order.side == OrderSideEnum.buy
            else ExpertHedgeSideEnum.sell_to_dealer
        )
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
    _ = row.dealer
    return _hedge_out(row)


def delete_hedge(db: Session, hedge_id: str) -> None:
    row = db.query(ExpertHedge).filter(ExpertHedge.id == hedge_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="تراکنش پیدا نشد")
    db.delete(row)
    db.commit()
