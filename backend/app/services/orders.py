"""
Order + balance business logic.

Two kinds of instrument now:
  - Gold items (type=1, گرم/عیار): tracked in گرم ۱۸ against the single
    universal gold balance ledger (BalanceTransaction.goldbridge_item_id
    IS NULL), exactly as before - every gold card shares this one
    balance, since they're all just different quotes on the same
    physical unit (a gram of 18k gold).
  - Coin items (type=2): tracked by COUNT against their OWN separate
    ledger, keyed by BalanceTransaction.goldbridge_item_id = that
    coin's id. A سکه تمام count is never mixed with a ربع سکه count or
    with the گرم۱۸ gold balance - they're different things.

Key rule: a user's balance is never stored directly - it's always the sum
of their balance_transactions rows (filtered to the right ledger). This
keeps a full audit trail (every gold/cash/coin movement has a reason and
a timestamp).

When an order is accepted:
  - buy  -> gold/coin balance increases; the toman value of the order is
            recorded as a NEGATIVE cash change (the customer now owes
            the shop that amount, since they received it without an
            in-app cash payment).
  - sell -> gold/coin balance decreases; the toman value is recorded as a
            POSITIVE cash change (the shop now owes the customer that
            amount for what they handed over).
  For gold orders placed in "amount" (تومان) rather than "weight"
  (گرم ۱۸), the weight is derived using the گرم۱۸ price active when the
  order was submitted. Coin orders are always by count directly - no
  weight/amount toggle exists for them.
"""
import json
from datetime import datetime

from sqlalchemy.orm import Session
from sqlalchemy import func
from fastapi import HTTPException

from app.models_db import (
    Order,
    User,
    Role,
    BalanceTransaction,
    OrderStatusEnum,
    TransactionReasonEnum,
)
from app.config import settings
from app.gold_conversion import mesghal17_to_gram18
from app.schemas.order import OrderOut
from app.services.order_limits import get_effective_limits
from app.services import price_cards


def weight_equivalent(order: Order) -> float:
    """Converts a GOLD order's value to گرم ۱۸, regardless of how it was entered.
    Not meaningful for coin (amount_type="count") orders - see order_quantity."""
    if order.amount_type.value == "weight":
        return order.value
    # amount_type == "amount" (تومان) -> convert using the گرم۱۸ price at submit time
    return order.value / order.price_at_submit


def order_quantity(order: Order) -> float:
    """The quantity to apply to the balance ledger for this order -
    گرم۱۸ for gold orders, count of coins for coin orders (amount_type
    == "count", where value already IS the count directly, no
    weight/amount conversion involved)."""
    if order.amount_type.value == "count":
        return order.value
    return weight_equivalent(order)


def order_total_toman(order: Order) -> float:
    """The total تومان value of an order, regardless of how it was entered."""
    if order.amount_type.value == "amount":
        return order.value
    return order.value * order.price_at_submit


def _user_commission(user: User, base_price: float) -> float:
    """
    Per-user commission, sourced from the user's role (دسته‌بندی) - set
    server-side in the admin روles tab, either as a flat Toman amount or
    a percentage of the raw مثقال۱۷ price. No role assigned -> zero
    commission.
    """
    if not user.role:
        return 0.0
    if user.role.commission_type.value == "fixed":
        return user.role.commission_value
    return base_price * (user.role.commission_value / 100)


def apply_pricing_formula(mesghal17_buy: float, mesghal17_sell: float, side: str, user: User) -> float:
    """
    The final مثقال۱۷ price for a specific order side and a specific
    user: the raw price from the source, plus (buy) or minus (sell)
    this user's own commission. No spread widening beyond the source's
    own buy/sell numbers - commission is the only markup applied.

        final_buy  = raw_buy  + commission
        final_sell = raw_sell - commission

    Commission is per-user (from their role), not global - two users
    with different roles placing the same-side order right now get
    different final prices.
    """
    if side == "buy":
        return mesghal17_buy + _user_commission(user, mesghal17_buy)
    return mesghal17_sell - _user_commission(user, mesghal17_sell)


def create_order(db: Session, user: User, side: str, amount_type: str, value: float,
                  description: str, goldbridge_item_id: int, raw_item: dict) -> Order:
    is_coin = raw_item.get("type") == price_cards.COIN_ITEM_TYPE

    if is_coin:
        if amount_type != "count":
            raise HTTPException(status_code=400, detail="سفارش سکه فقط بر اساس تعداد ثبت می‌شود")
        if value <= 0 or value != int(value):
            raise HTTPException(status_code=400, detail="تعداد باید عددی صحیح و بزرگتر از صفر باشد")

        mesghal17_raw_price = raw_item["buy"] if side == "buy" else raw_item["sell"]
        final_price = apply_pricing_formula(raw_item["buy"], raw_item["sell"], side, user)
        price_at_submit = final_price  # coins: no گرم۱۸ conversion, this IS the final per-coin price

        # No min/max quantity enforcement for coins yet (the existing
        # per-role limits are گرم۱۸/تومان-specific) - a reasonable sanity
        # cap prevents obviously-wrong input while a proper per-coin
        # limits setting doesn't exist yet.
        if value > 50:
            raise HTTPException(status_code=400, detail="حداکثر تعداد سفارش سکه در هر درخواست ۵۰ عدد است")
    else:
        if amount_type == "count":
            raise HTTPException(status_code=400, detail="این کارت بر اساس وزن یا مبلغ سفارش داده می‌شود، نه تعداد")

        mesghal17_raw_price = raw_item["buy"] if side == "buy" else raw_item["sell"]
        mesghal17_price = apply_pricing_formula(raw_item["buy"], raw_item["sell"], side, user)
        price_at_submit = mesghal17_to_gram18(mesghal17_price)
        final_price = mesghal17_price

        limits = get_effective_limits(db, user)
        weight = value if amount_type == "weight" else value / price_at_submit

        if amount_type == "weight":
            if weight < limits["min_weight"]:
                raise HTTPException(
                    status_code=400,
                    detail=f"حداقل مقدار سفارش {limits['min_weight']} گرم ۱۸ است",
                )
            if weight > limits["max_weight"]:
                raise HTTPException(
                    status_code=400,
                    detail=f"حداکثر مقدار سفارش {limits['max_weight']} گرم ۱۸ است",
                )
        else:
            if limits["min_amount"] and value < limits["min_amount"]:
                raise HTTPException(
                    status_code=400,
                    detail=f"حداقل مبلغ سفارش {limits['min_amount']} تومان است",
                )
            if limits["max_amount"] and value > limits["max_amount"]:
                raise HTTPException(
                    status_code=400,
                    detail=f"حداکثر مبلغ سفارش {limits['max_amount']} تومان است",
                )

    order = Order(
        user_id=user.id,
        side=side,
        amount_type=amount_type,
        value=value,
        description=description or "",
        price_at_submit=price_at_submit,
        mesghal17_price_at_submit=final_price,
        mesghal17_raw_price_at_submit=mesghal17_raw_price,
        goldbridge_item_id=goldbridge_item_id,
    )
    db.add(order)
    db.commit()
    db.refresh(order)
    return order


def create_phone_order(
    db: Session,
    user_id: str,
    side: str,
    amount_type: str,
    value: float,
    mesghal17_price: float,
    description: str,
) -> Order:
    """
    Admin manually enters an order taken over the phone. The admin
    supplies the مثقال۱۷ price themselves (already negotiated with the
    customer during the call), so no role commission is layered on top -
    the entered price IS the final price. The order is created already
    ACCEPTED (it's already a confirmed trade, not something pending
    review), and the matching balance transaction is created immediately,
    same as a normal admin-accepted order.
    """
    user = get_user_or_404(db, user_id)

    gram18_price = mesghal17_to_gram18(mesghal17_price)

    weight = value if amount_type == "weight" else value / gram18_price
    if weight < settings.MIN_ORDER_WEIGHT or weight > settings.MAX_ORDER_WEIGHT:
        raise HTTPException(
            status_code=400,
            detail=f"مقدار باید بین {settings.MIN_ORDER_WEIGHT} و {settings.MAX_ORDER_WEIGHT} گرم ۱۸ باشد",
        )

    order = Order(
        user_id=user.id,
        side=side,
        amount_type=amount_type,
        value=value,
        description=description or "ثبت‌شده توسط ادمین (حواله تلفنی)",
        price_at_submit=gram18_price,
        mesghal17_price_at_submit=mesghal17_price,
        status=OrderStatusEnum.pending,
        is_manual=True,
    )
    db.add(order)
    db.commit()
    db.refresh(order)

    # immediately accept it - a phone order is already a confirmed trade
    return decide_order(db, order.id, "accepted")


def get_user_balance(db: Session, user_id: str) -> dict:
    """گرم۱۸ gold + cash only - excludes coin-ledger transactions
    entirely (see get_user_coin_balances for those)."""
    result = (
        db.query(
            func.coalesce(func.sum(BalanceTransaction.gold_change), 0.0),
            func.coalesce(func.sum(BalanceTransaction.cash_change), 0.0),
        )
        .filter(BalanceTransaction.user_id == user_id)
        .filter(BalanceTransaction.goldbridge_item_id.is_(None))
        .first()
    )
    gold_balance, cash_balance = result
    return {"gold_balance": float(gold_balance), "cash_balance": float(cash_balance)}


def get_user_coin_balances(db: Session, user_id: str) -> dict[int, float]:
    """{goldbridge_item_id: count} for every coin type this user has
    ever traded - each coin type is its own separate ledger, never
    mixed with another or with گرم۱۸ gold."""
    rows = (
        db.query(BalanceTransaction.goldbridge_item_id, func.coalesce(func.sum(BalanceTransaction.gold_change), 0.0))
        .filter(BalanceTransaction.user_id == user_id)
        .filter(BalanceTransaction.goldbridge_item_id.isnot(None))
        .group_by(BalanceTransaction.goldbridge_item_id)
        .all()
    )
    return {item_id: float(count) for item_id, count in rows}


def get_user_transactions(db: Session, user_id: str, limit: int = 20) -> list[BalanceTransaction]:
    return (
        db.query(BalanceTransaction)
        .filter(BalanceTransaction.user_id == user_id)
        .order_by(BalanceTransaction.created_at.desc())
        .limit(limit)
        .all()
    )


def cancel_order(db: Session, order_id: str, user_id: str) -> Order:
    """
    A customer cancelling their own order, while it's still pending (no
    admin decision yet). No balance transaction to undo since a pending
    order never affected the balance in the first place.
    """
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="سفارش پیدا نشد")
    if order.user_id != user_id:
        raise HTTPException(status_code=403, detail="این سفارش متعلق به شما نیست")
    if order.status != OrderStatusEnum.pending:
        raise HTTPException(status_code=400, detail="فقط سفارش‌های در انتظار را می‌توان لغو کرد")

    order.status = OrderStatusEnum.cancelled
    db.commit()
    db.refresh(order)
    return order


def decide_order(db: Session, order_id: str, status: str) -> Order:
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="سفارش پیدا نشد")
    if order.status != OrderStatusEnum.pending:
        raise HTTPException(status_code=400, detail="این سفارش قبلا تصمیم‌گیری شده")
    if status not in ("accepted", "rejected"):
        raise HTTPException(status_code=400, detail="وضعیت نامعتبر است")

    order.status = OrderStatusEnum(status)
    order.updated_at = datetime.utcnow()

    if status == "accepted" and order.user_id:
        is_coin = order.amount_type.value == "count"
        quantity = order_quantity(order)
        gold_change = quantity if order.side.value == "buy" else -quantity

        total_toman = order_total_toman(order)
        # buy: customer received it, now owes the shop -> negative
        # sell: shop received it, now owes the customer cash -> positive
        cash_change = -total_toman if order.side.value == "buy" else total_toman

        unit_label = "عدد سکه" if is_coin else "گرم ۱۸"
        txn = BalanceTransaction(
            user_id=order.user_id,
            gold_change=gold_change,
            cash_change=cash_change,
            reason=TransactionReasonEnum.order_accepted,
            note=(
                f"سفارش {order.side.value} به مقدار {quantity:.4f} {unit_label} "
                f"به ارزش {total_toman:,.0f} تومان"
            ),
            related_order_id=order.id,
            # Coin trades get their OWN ledger (goldbridge_item_id set);
            # gold trades always go into the single universal گرم۱۸
            # ledger regardless of which gold card priced them.
            goldbridge_item_id=order.goldbridge_item_id if is_coin else None,
        )
        db.add(txn)

    db.commit()
    db.refresh(order)
    return order


# ---------------- مدیریت کاربران (ادمین) ----------------

def list_users_with_balance(db: Session, search: str | None = None) -> list[dict]:
    """Every user, with their current گرم۱۸ gold/cash balance computed
    alongside (coin-ledger transactions excluded - see
    get_user_coin_balances for those, shown separately)."""
    query = db.query(
        User,
        func.coalesce(func.sum(BalanceTransaction.gold_change), 0.0),
        func.coalesce(func.sum(BalanceTransaction.cash_change), 0.0),
    ).outerjoin(
        BalanceTransaction,
        (BalanceTransaction.user_id == User.id) & (BalanceTransaction.goldbridge_item_id.is_(None)),
    )

    if search:
        like = f"%{search}%"
        query = query.filter(
            (User.phone_number.ilike(like))
            | (User.full_name.ilike(like))
            | (User.user_code.ilike(like))
        )

    query = query.group_by(User.id).order_by(User.created_at.desc())

    results = []
    for user, gold, cash in query.all():
        reg_key = user.registration_key
        results.append({
            "id": user.id,
            "user_code": user.user_code,
            "phone_number": user.phone_number,
            "full_name": user.full_name,
            "is_blocked": user.is_blocked,
            "created_at": user.created_at,
            "gold_balance": float(gold),
            "cash_balance": float(cash),
            "role": user.role,
            "is_online": user.is_online,
            "registration_status": reg_key.status.value if reg_key else None,
        })
    return results


def update_user(db: Session, user_id: str, full_name: str | None, role_id: str | None,
                 national_id: str | None, notes: str | None) -> User:
    user = get_user_or_404(db, user_id)

    if full_name is not None:
        user.full_name = full_name
    if role_id is not None:
        role = db.query(Role).filter(Role.id == role_id).first()
        if not role:
            raise HTTPException(status_code=400, detail="دسته‌بندی انتخاب‌شده پیدا نشد")
        user.role_id = role_id
    if national_id is not None:
        user.national_id = national_id
    if notes is not None:
        user.notes = notes

    db.commit()
    db.refresh(user)
    return user


def order_customer_fields(db: Session, order: Order) -> dict:
    """
    Extra fields (customer name/code/phone + their CURRENT balance) to
    merge into an order's admin-facing JSON representation. The balance
    is a live snapshot at read time, not stored on the order itself.
    """
    if not order.user:
        return {
            "customer_name": None, "customer_code": None, "customer_phone": None,
            "customer_gold_balance": None, "customer_cash_balance": None,
        }
    balance = get_user_balance(db, order.user_id)
    return {
        "customer_name": order.user.full_name,
        "customer_code": order.user.user_code,
        "customer_phone": order.user.phone_number,
        "customer_gold_balance": balance["gold_balance"],
        "customer_cash_balance": balance["cash_balance"],
    }


def order_to_dict(db: Session, order: Order) -> dict:
    """Full JSON-ready representation of an order, admin-enriched. Used
    for WebSocket broadcasts (new_order / order_updated events)."""
    data = json.loads(OrderOut.model_validate(order).model_dump_json())
    data.update(order_customer_fields(db, order))
    return data


def order_to_admin_out(db: Session, order: Order) -> OrderOut:
    """Same as order_to_dict but returns the Pydantic model directly,
    for use as a FastAPI response_model return value."""
    data = OrderOut.model_validate(order).model_dump()
    data.update(order_customer_fields(db, order))
    return OrderOut(**data)


def get_user_or_404(db: Session, user_id: str) -> User:
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="کاربر پیدا نشد")
    return user


def adjust_balance(db: Session, user_id: str, gold_change: float, cash_change: float, note: str) -> BalanceTransaction:
    get_user_or_404(db, user_id)  # 404s if missing

    if not gold_change and not cash_change:
        raise HTTPException(status_code=400, detail="حداقل یکی از مقادیر طلا یا نقدی باید غیرصفر باشد")

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
    if is_blocked and user.registration_key:
        from app.models_db import RegistrationKeyStatusEnum
        user.registration_key.status = RegistrationKeyStatusEnum.banned
    db.commit()
    db.refresh(user)
    return user