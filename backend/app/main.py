"""
اپ آبشده حسین - سمت سرور
اجرا: uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
"""
import asyncio
import json
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from app.price_service import price_service
from app.ws_manager import manager
from app.db import init_db, get_db
from app.config import settings
from app.schemas_auth import RequestOtpIn, RequestOtpOut, VerifyOtpIn, VerifyOtpOut, UserOut
from app.auth import create_otp_for_phone, verify_otp_and_get_user, create_access_token, get_current_user
from app.models_db import User, Order, OrderStatusEnum
from app.schemas_order import OrderCreateIn, OrderOut, OrderDecisionIn, BalanceOut, OrderLimitsOut
from app.schemas_admin import UserSummaryOut, UserDetailOut, TransactionOut, BalanceAdjustIn, BlockUserIn, AdminLoginIn, AdminLoginOut
from app.admin_auth import verify_admin_credentials, create_admin_token, get_current_admin, verify_admin_ws_token
from app.orders_service import (
    create_order as create_order_db,
    decide_order as decide_order_db,
    get_user_balance,
    list_users_with_balance,
    get_user_or_404,
    adjust_balance as adjust_balance_db,
    set_user_blocked,
)
from app.models_db import BalanceTransaction

app = FastAPI(title="آبشده حسین - Gold Trading Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # موقع دیپلوی نهایی باید محدودش کنیم
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup_event():
    init_db()
    asyncio.create_task(price_service.run_simulation())
    asyncio.create_task(price_broadcaster())


async def price_broadcaster():
    """قیمت فعلی رو دائم برای همه کلاینت‌های وصل‌شده پخش می‌کنه"""
    queue = asyncio.Queue()
    price_service.subscribe(queue)
    try:
        while True:
            price = await queue.get()
            await manager.broadcast_price(price.model_dump())
    finally:
        price_service.unsubscribe(queue)


def order_to_dict(order: Order) -> dict:
    return json.loads(OrderOut.model_validate(order).model_dump_json())


# ---------------- احراز هویت (OTP) ----------------

@app.post("/api/auth/request-otp", response_model=RequestOtpOut)
async def request_otp(payload: RequestOtpIn, db: Session = Depends(get_db)):
    code = create_otp_for_phone(db, payload.phone_number)
    return RequestOtpOut(
        message="کد تایید ارسال شد",
        debug_code=code if settings.DEBUG_OTP else None,
    )


@app.post("/api/auth/verify-otp", response_model=VerifyOtpOut)
async def verify_otp(payload: VerifyOtpIn, db: Session = Depends(get_db)):
    user = verify_otp_and_get_user(db, payload.phone_number, payload.code)
    token = create_access_token(user)
    return VerifyOtpOut(token=token, user=UserOut.model_validate(user))


@app.get("/api/auth/me", response_model=UserOut)
async def get_me(current_user: User = Depends(get_current_user)):
    return UserOut.model_validate(current_user)


# ---------------- قیمت ----------------

@app.get("/api/price")
async def get_price():
    return price_service.get_price()


@app.get("/api/order-limits", response_model=OrderLimitsOut)
async def get_order_limits():
    return OrderLimitsOut(min_weight=settings.MIN_ORDER_WEIGHT, max_weight=settings.MAX_ORDER_WEIGHT)


@app.websocket("/ws/price")
async def ws_price(websocket: WebSocket):
    await manager.connect_price(websocket)
    try:
        # اولین پیام: قیمت فعلی رو بلافاصله بفرست
        await websocket.send_text(
            json.dumps(price_service.get_price().model_dump(), default=str)
        )
        while True:
            await websocket.receive_text()  # فقط برای نگه‌داشتن اتصال زنده
    except WebSocketDisconnect:
        manager.disconnect_price(websocket)


# ---------------- سفارش‌ها (کلاینت - نیاز به ورود) ----------------

@app.post("/api/orders", response_model=OrderOut)
async def submit_order(
    order_in: OrderCreateIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    current_price = price_service.get_price()
    order = create_order_db(
        db, current_user, order_in.side, order_in.amount_type,
        order_in.value, order_in.description, current_price,
    )

    await manager.broadcast_to_admins({"type": "new_order", "order": order_to_dict(order)})

    return order


@app.get("/api/my/orders", response_model=list[OrderOut])
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


@app.get("/api/my/balance", response_model=BalanceOut)
async def my_balance(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return get_user_balance(db, current_user.id)


# ---------------- پنل ادمین (سرور) ----------------

@app.post("/api/admin/auth/login", response_model=AdminLoginOut)
async def admin_login(payload: AdminLoginIn):
    if not verify_admin_credentials(payload.username, payload.password):
        raise HTTPException(
            status_code=401, detail="نام کاربری یا رمز عبور اشتباه است")
    return AdminLoginOut(token=create_admin_token())


@app.get("/api/admin/orders", response_model=list[OrderOut])
async def list_orders(status: str | None = None, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    query = db.query(Order)
    if status:
        query = query.filter(Order.status == OrderStatusEnum(status))
    return query.order_by(Order.created_at.desc()).all()


@app.post("/api/admin/orders/{order_id}/decide", response_model=OrderOut)
async def decide_order(order_id: str, decision: OrderDecisionIn, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    order = decide_order_db(db, order_id, decision.status)
    await manager.broadcast_to_admins({"type": "order_updated", "order": order_to_dict(order)})
    return order


@app.websocket("/ws/admin")
async def ws_admin(websocket: WebSocket, token: str | None = Query(default=None)):
    try:
        verify_admin_ws_token(token)
    except HTTPException:
        await websocket.close(code=4401)
        return

    await manager.connect_admin(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect_admin(websocket)


# ---------------- مدیریت کاربران (ادمین) ----------------

@app.get("/api/admin/users", response_model=list[UserSummaryOut])
async def list_users(search: str | None = None, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    return list_users_with_balance(db, search)


@app.get("/api/admin/users/{user_id}", response_model=UserDetailOut)
async def get_user_detail(user_id: str, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    user = get_user_or_404(db, user_id)
    balance = get_user_balance(db, user_id)

    orders = (
        db.query(Order)
        .filter(Order.user_id == user_id)
        .order_by(Order.created_at.desc())
        .all()
    )
    transactions = (
        db.query(BalanceTransaction)
        .filter(BalanceTransaction.user_id == user_id)
        .order_by(BalanceTransaction.created_at.desc())
        .all()
    )

    return UserDetailOut(
        id=user.id,
        phone_number=user.phone_number,
        full_name=user.full_name,
        is_blocked=user.is_blocked,
        created_at=user.created_at,
        gold_balance=balance["gold_balance"],
        cash_balance=balance["cash_balance"],
        orders=orders,
        transactions=transactions,
    )


@app.post("/api/admin/users/{user_id}/adjust-balance", response_model=TransactionOut)
async def adjust_user_balance(user_id: str, payload: BalanceAdjustIn, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    txn = adjust_balance_db(db, user_id, payload.gold_change,
                            payload.cash_change, payload.note)
    return txn


@app.post("/api/admin/users/{user_id}/block", response_model=UserSummaryOut)
async def block_user(user_id: str, payload: BlockUserIn, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    user = set_user_blocked(db, user_id, payload.is_blocked)
    balance = get_user_balance(db, user_id)
    return UserSummaryOut(
        id=user.id,
        phone_number=user.phone_number,
        full_name=user.full_name,
        is_blocked=user.is_blocked,
        created_at=user.created_at,
        gold_balance=balance["gold_balance"],
        cash_balance=balance["cash_balance"],
    )
