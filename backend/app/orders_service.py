"""
Order + balance business logic.

Key rule: a user's balance is never stored directly - it's always the sum
of their balance_transactions rows. This keeps a full audit trail (every
gold/cash movement has a reason and a timestamp).

When an order is accepted:
  - buy  -> gold balance increases (cash is assumed handled outside the app)
  - sell -> gold balance decreases (cash is assumed handled outside the app)
  If the order was placed in "amount" (تومان) rather than "weight" (مثقال),
  it's converted to a weight using the price that was active when the
  order was submitted.
"""
from datetime import datetime

from sqlalchemy.orm import Session
from sqlalchemy import func
from fastapi import HTTPException

from app.models_db import (
    Order,
    User,
    BalanceTransaction,
    OrderStatusEnum,
    TransactionReasonEnum,
)
from app.config import settings


def weight_equivalent(order: Order) -> float:
    """Converts an order's value to مثقال, regardless of how it was entered."""
    if order.amount_type.value == "weight":
        return order.value
    # amount_type == "amount" (تومان) -> convert using the price at submit time
    return order.value / order.price_at_submit


def create_order(db: Session, user: User, side: str, amount_type: str, value: float,
                 description: str, current_price) -> Order:
    price_at_submit = (
        current_price.buy_price if side == "buy" else current_price.sell_price
    )

    weight = value if amount_type == "weight" else value / price_at_submit
    if weight < settings.MIN_ORDER_WEIGHT:
        raise HTTPException(
            status_code=400,
            detail=f"حداقل مقدار سفارش {settings.MIN_ORDER_WEIGHT} مثقال است",
        )
    if weight > settings.MAX_ORDER_WEIGHT:
        raise HTTPException(
            status_code=400,
            detail=f"حداکثر مقدار سفارش {settings.MAX_ORDER_WEIGHT} مثقال است",
        )

    order = Order(
        user_id=user.id,
        side=side,
        amount_type=amount_type,
        value=value,
        description=description or "",
        price_at_submit=price_at_submit,
    )
    db.add(order)
    db.commit()
    db.refresh(order)
    return order


def get_user_balance(db: Session, user_id: str) -> dict:
    result = (
        db.query(
            func.coalesce(func.sum(BalanceTransaction.gold_change), 0.0),
            func.coalesce(func.sum(BalanceTransaction.cash_change), 0.0),
        )
        .filter(BalanceTransaction.user_id == user_id)
        .first()
    )
    gold_balance, cash_balance = result
    return {"gold_balance": float(gold_balance), "cash_balance": float(cash_balance)}


def decide_order(db: Session, order_id: str, status: str) -> Order:
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="سفارش پیدا نشد")
    if order.status != OrderStatusEnum.pending:
        raise HTTPException(
            status_code=400, detail="این سفارش قبلا تصمیم‌گیری شده")
    if status not in ("accepted", "rejected"):
        raise HTTPException(status_code=400, detail="وضعیت نامعتبر است")

    order.status = OrderStatusEnum(status)
    order.updated_at = datetime.utcnow()

    if status == "accepted" and order.user_id:
        gold_amount = weight_equivalent(order)
        gold_change = gold_amount if order.side.value == "buy" else -gold_amount

        txn = BalanceTransaction(
            user_id=order.user_id,
            gold_change=gold_change,
            cash_change=0,
            reason=TransactionReasonEnum.order_accepted,
            note=f"سفارش {order.side.value} به مقدار {gold_amount:.4f} مثقال",
            related_order_id=order.id,
        )
        db.add(txn)

    db.commit()
    db.refresh(order)
    return order


# ---------------- مدیریت کاربران (ادمین) ----------------

def list_users_with_balance(db: Session, search: str | None = None) -> list[dict]:
    """Every user, with their current gold/cash balance computed alongside."""
    query = db.query(
        User,
        func.coalesce(func.sum(BalanceTransaction.gold_change), 0.0),
        func.coalesce(func.sum(BalanceTransaction.cash_change), 0.0),
    ).outerjoin(BalanceTransaction, BalanceTransaction.user_id == User.id)

    if search:
        query = query.filter(User.phone_number.ilike(f"%{search}%"))

    query = query.group_by(User.id).order_by(User.created_at.desc())

    results = []
    for user, gold, cash in query.all():
        results.append({
            "id": user.id,
            "phone_number": user.phone_number,
            "full_name": user.full_name,
            "is_blocked": user.is_blocked,
            "created_at": user.created_at,
            "gold_balance": float(gold),
            "cash_balance": float(cash),
        })
    return results


def get_user_or_404(db: Session, user_id: str) -> User:
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="کاربر پیدا نشد")
    return user


def adjust_balance(db: Session, user_id: str, gold_change: float, cash_change: float, note: str) -> BalanceTransaction:
    get_user_or_404(db, user_id)  # 404s if missing

    if not gold_change and not cash_change:
        raise HTTPException(
            status_code=400, detail="حداقل یکی از مقادیر طلا یا نقدی باید غیرصفر باشد")

    txn = BalanceTransaction(
        user_id=user_id,
        gold_change=gold_change or 0,
        cash_change=cash_change or 0,
        reason=TransactionReasonEnum.admin_adjustment,
        note=note or "",
    )
    db.add(txn)
    db.commit()
    db.refresh(txn)
    return txn


def set_user_blocked(db: Session, user_id: str, is_blocked: bool) -> User:
    user = get_user_or_404(db, user_id)
    user.is_blocked = is_blocked
    db.commit()
    db.refresh(user)
    return user
