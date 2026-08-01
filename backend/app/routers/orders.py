from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.ws_manager import manager
from app.auth import get_current_user
from app.models_db import User, Order
from app.schemas.order import OrderCreateIn, OrderOut, BalanceOut
from app.schemas.admin import TransactionOut
from app.services.orders import (
    create_order as create_order_db,
    get_user_balance,
    get_user_transactions as get_user_transactions_db,
    order_to_dict,
    order_to_customer_out,
    cancel_order as cancel_order_db,
    retry_pending_order as retry_pending_order_db,
    resubmit_order_at_new_price as resubmit_order_at_new_price_db,
)
from app.services.trading_status import is_trading_online
from app.services import price_cards

router = APIRouter(tags=["orders"])


@router.post("/api/orders", response_model=OrderOut)
async def submit_order(
    order_in: OrderCreateIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not is_trading_online(db):
        raise HTTPException(
            status_code=403,
            detail="در حال حاضر امکان ثبت سفارش وجود ندارد. لطفا بعدا مراجعه کنید.",
        )
    if current_user.is_trading_banned:
        raise HTTPException(
            status_code=403,
            detail="برای این حساب امکان خرید و فروش غیرفعال شده است.",
        )

    card = price_cards.get_card_state(db, order_in.goldbridge_item_id)
    if not card or not card.is_enabled:
        raise HTTPException(status_code=404, detail="این کارت قیمت در دسترس نیست.")

    # Prefer live goldbridge quote; fall back to admin manual prices when
    # the feed is down / card is on manual mode (see resolve_effective_item).
    raw_item = price_cards.resolve_effective_item(
        card, price_cards.get_raw_item(order_in.goldbridge_item_id)
    )
    if not raw_item or raw_item.get("buy") is None or raw_item.get("sell") is None:
        raise HTTPException(status_code=503, detail="قیمت لحظه‌ای در دسترس نیست، لطفا کمی صبر کنید.")

    if not price_cards.resolve_can_order_for_user(db, current_user, card, raw_item):
        raise HTTPException(
            status_code=403,
            detail="دسته‌بندی شما مجاز به ثبت سفارش روی قیمت دستی این کارت نیست.",
        )

    # Two independent layers, combined via effective_orderable: this
    # app's own per-side admin toggle, AND (unless the admin has set
    # override_source_restriction) goldbridge's own allow_buy/allow_sell
    # for the item. Manual prices skip the goldbridge allow flags.
    # Same function used for the customer-facing broadcast.
    buy_ok, sell_ok = price_cards.effective_orderable(card, raw_item)
    if order_in.side == "buy" and not buy_ok:
        raise HTTPException(status_code=403, detail="خرید این کارت در حال حاضر مجاز نیست.")
    if order_in.side == "sell" and not sell_ok:
        raise HTTPException(status_code=403, detail="فروش این کارت در حال حاضر مجاز نیست.")

    order = create_order_db(
        db, current_user, order_in.side, order_in.amount_type,
        order_in.value, order_in.description, order_in.goldbridge_item_id, raw_item,
    )

    await manager.broadcast_to_admins({"type": "new_order", "order": order_to_dict(db, order)})

    return order_to_customer_out(order)


@router.get("/api/my/orders", response_model=list[OrderOut])
async def my_orders(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    orders = (
        db.query(Order)
        .filter(Order.user_id == current_user.id)
        .order_by(Order.created_at.desc())
        .all()
    )
    return [order_to_customer_out(o) for o in orders]


@router.get("/api/my/orders/{order_id}", response_model=OrderOut)
async def my_order_detail(
    order_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    order = (
        db.query(Order)
        .filter(Order.id == order_id, Order.user_id == current_user.id)
        .first()
    )
    if not order:
        raise HTTPException(status_code=404, detail="سفارش پیدا نشد")
    return order_to_customer_out(order)


@router.post("/api/my/orders/{order_id}/cancel", response_model=OrderOut)
async def cancel_my_order(
    order_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    order = cancel_order_db(db, order_id, current_user.id)
    # Let the admin dashboard drop this card immediately instead of
    # waiting for the next poll tick.
    await manager.broadcast_to_admins({"type": "order_updated", "order": order_to_dict(db, order)})
    return order_to_customer_out(order)


@router.post("/api/my/orders/{order_id}/retry", response_model=OrderOut)
async def retry_my_order(
    order_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Customer re-opens the admin-visibility countdown after it expired
    unanswered. Broadcast as new_order so the admin gets the same
    alert/sound as a fresh submission - they need to notice it again.
    """
    order = retry_pending_order_db(db, order_id, current_user.id)
    await manager.broadcast_to_admins({"type": "new_order", "order": order_to_dict(db, order)})
    return order_to_customer_out(order)


@router.post("/api/my/orders/{order_id}/retry-new-price", response_model=OrderOut)
async def retry_my_order_at_new_price(
    order_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    After admin rejected for market-move, customer re-submits the same
    order at the live quote. Broadcast as new_order so admin is alerted.
    """
    if not is_trading_online(db):
        raise HTTPException(
            status_code=403,
            detail="در حال حاضر امکان ثبت سفارش وجود ندارد. لطفا بعدا مراجعه کنید.",
        )
    if current_user.is_trading_banned:
        raise HTTPException(
            status_code=403,
            detail="برای این حساب امکان خرید و فروش غیرفعال شده است.",
        )
    order = resubmit_order_at_new_price_db(db, order_id, current_user)
    await manager.broadcast_to_admins({"type": "new_order", "order": order_to_dict(db, order)})
    return order_to_customer_out(order)


@router.get("/api/my/balance", response_model=BalanceOut)
async def my_balance(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return get_user_balance(db, current_user.id)


@router.get("/api/my/transactions", response_model=list[TransactionOut])
async def my_transactions(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return get_user_transactions_db(db, current_user.id)
