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
    cancel_order as cancel_order_db,
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

    card = price_cards.get_card_state(db, order_in.goldbridge_item_id)
    if not card or not card.is_enabled:
        raise HTTPException(status_code=404, detail="این کارت قیمت در دسترس نیست.")

    raw_item = price_cards.get_raw_item(order_in.goldbridge_item_id)
    if not raw_item or raw_item.get("buy") is None or raw_item.get("sell") is None:
        raise HTTPException(status_code=503, detail="قیمت لحظه‌ای در دسترس نیست، لطفا کمی صبر کنید.")

    # Two independent layers, combined via effective_orderable: this
    # app's own per-side admin toggle, AND (unless the admin has set
    # override_source_restriction) goldbridge's own allow_buy/allow_sell
    # for the item. Same function used for the customer-facing
    # broadcast, so this can never disagree with what's displayed.
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

    return order


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
    return orders


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
    return order


@router.post("/api/my/orders/{order_id}/cancel", response_model=OrderOut)
async def cancel_my_order(
    order_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return cancel_order_db(db, order_id, current_user.id)


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