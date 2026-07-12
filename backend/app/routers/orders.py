from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.price_service import price_service
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

    current_price = price_service.get_price()
    order = create_order_db(
        db, current_user, order_in.side, order_in.amount_type,
        order_in.value, order_in.description, current_price,
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