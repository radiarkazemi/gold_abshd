"""
اپ آبشده حسین - سمت سرور
اجرا: uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
"""
import asyncio
import json
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from app.models import Order, OrderCreate, OrderDecision, OrderStatus
from app.price_service import price_service
from app.ws_manager import manager
from app.db import init_db, get_db
from app.config import settings
from app.schemas_auth import RequestOtpIn, RequestOtpOut, VerifyOtpIn, VerifyOtpOut, UserOut
from app.auth import create_otp_for_phone, verify_otp_and_get_user, create_access_token, get_current_user
from app.models_db import User

app = FastAPI(title="آبشده حسین - Gold Trading Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # موقع دیپلوی نهایی باید محدودش کنیم
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# حافظه‌ی موقت سفارش‌ها (بعدا با دیتابیس واقعی جایگزین می‌کنیم)
orders_db: dict[str, Order] = {}


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


# ---------------- سفارش‌ها (کلاینت) ----------------

@app.post("/api/orders", response_model=Order)
async def create_order(order_in: OrderCreate):
    current_price = price_service.get_price()
    price_at_submit = (
        current_price.buy_price
        if order_in.side == "buy"
        else current_price.sell_price
    )

    order = Order(
        side=order_in.side,
        amount_type=order_in.amount_type,
        value=order_in.value,
        description=order_in.description,
        price_at_submit=price_at_submit,
    )
    orders_db[order.id] = order

    # به ادمین‌های آنلاین اطلاع بده
    await manager.broadcast_to_admins({"type": "new_order", "order": order.model_dump()})

    return order


@app.get("/api/orders/{order_id}", response_model=Order)
async def get_order(order_id: str):
    order = orders_db.get(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="سفارش پیدا نشد")
    return order


# ---------------- پنل ادمین (سرور) ----------------

@app.get("/api/admin/orders", response_model=list[Order])
async def list_orders(status: OrderStatus | None = None):
    values = list(orders_db.values())
    if status:
        values = [o for o in values if o.status == status]
    return sorted(values, key=lambda o: o.created_at, reverse=True)


@app.post("/api/admin/orders/{order_id}/decide", response_model=Order)
async def decide_order(order_id: str, decision: OrderDecision):
    order = orders_db.get(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="سفارش پیدا نشد")
    if order.status != OrderStatus.PENDING:
        raise HTTPException(status_code=400, detail="این سفارش قبلا تصمیم‌گیری شده")

    order.status = decision.status
    from datetime import datetime
    order.updated_at = datetime.utcnow()
    orders_db[order_id] = order

    await manager.broadcast_to_admins({"type": "order_updated", "order": order.model_dump()})
    return order


@app.websocket("/ws/admin")
async def ws_admin(websocket: WebSocket):
    await manager.connect_admin(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect_admin(websocket)