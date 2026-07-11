"""
اپ آبشده قصر طلا - سمت سرور
اجرا: uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
"""
import asyncio
import json
import logging
import os
from datetime import datetime

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    datefmt="%H:%M:%S",
)

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Depends, Query, UploadFile, File
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from app.price_service import price_service
from app.ws_manager import manager
from app.db import init_db, get_db
from app.config import settings
from app.schemas_auth import RequestOtpIn, RequestOtpOut, VerifyOtpIn, VerifyOtpOut, UserOut
from app.auth import (
    create_otp_for_phone,
    verify_otp_and_get_user,
    create_access_token,
    get_current_user,
    get_user_for_login,
    check_device_or_require_key,
)
from app.models_db import User, Order, OrderStatusEnum, Role
from app.schemas_order import OrderCreateIn, OrderOut, OrderDecisionIn, BalanceOut, OrderLimitsOut
from app.schemas_admin import (
    UserSummaryOut, UserDetailOut, TransactionOut, BalanceAdjustIn, BlockUserIn,
    AdminLoginIn, AdminLoginOut, RoleOut, RoleCreateIn, RoleUpdateIn,
    AdminCreateUserIn, AdminCreateUserOut, AdminUpdateUserIn, RegistrationKeyOut, PhoneOrderCreateIn,
)
from app.admin_auth import verify_admin_credentials, create_admin_token, get_current_admin, verify_admin_ws_token
from app.receipts_service import save_receipt, get_receipt_path_for_viewer
from app.schemas_notice import NoticeOut, NoticeUpdateIn
from app.notice_service import get_notice, set_notice
from app.schemas_calendar import SettlementLabelOut, HolidayIn, HolidayOut
from app.calendar_service import get_settlement_label
from app.models_db import Holiday
from app.registration_service import create_user_with_key
from app.roles_service import list_roles, create_role, update_role_commission
from app.orders_service import (
    create_order as create_order_db,
    decide_order as decide_order_db,
    get_user_balance,
    get_user_transactions as get_user_transactions_db,
    list_users_with_balance,
    get_user_or_404,
    adjust_balance as adjust_balance_db,
    set_user_blocked,
    update_user as update_user_db,
    order_customer_fields,
    create_phone_order as create_phone_order_db,
)
from app.models_db import BalanceTransaction

app = FastAPI(title="آبشده قصر طلا - Gold Trading Server")

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
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
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


def order_to_dict(db: Session, order: Order) -> dict:
    data = json.loads(OrderOut.model_validate(order).model_dump_json())
    data.update(order_customer_fields(db, order))
    return data


def order_to_admin_out(db: Session, order: Order) -> OrderOut:
    data = OrderOut.model_validate(order).model_dump()
    data.update(order_customer_fields(db, order))
    return OrderOut(**data)


# ---------------- احراز هویت (OTP) ----------------

@app.post("/api/auth/request-otp", response_model=RequestOtpOut)
async def request_otp(payload: RequestOtpIn, db: Session = Depends(get_db)):
    user = get_user_for_login(db, payload.phone_number)
    check_device_or_require_key(user, payload.device_id, payload.registration_key, db)

    code = create_otp_for_phone(db, payload.phone_number)
    return RequestOtpOut(
        message="کد تایید ارسال شد",
        debug_code=code if settings.DEBUG_OTP else None,
    )


@app.post("/api/auth/verify-otp", response_model=VerifyOtpOut)
async def verify_otp(payload: VerifyOtpIn, db: Session = Depends(get_db)):
    user = verify_otp_and_get_user(
        db,
        payload.phone_number,
        payload.code,
        payload.device_id,
        payload.registration_key,
        payload.device_info or "",
    )
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


@app.get("/api/notice", response_model=NoticeOut)
async def get_site_notice(db: Session = Depends(get_db)):
    return NoticeOut(text=get_notice(db))


@app.get("/api/settlement-label", response_model=SettlementLabelOut)
async def get_settlement(db: Session = Depends(get_db)):
    return get_settlement_label(db)


@app.get("/api/admin/holidays", response_model=list[HolidayOut])
async def list_holidays(db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    return db.query(Holiday).order_by(Holiday.date.asc()).all()


@app.post("/api/admin/holidays", response_model=HolidayOut)
async def add_holiday(payload: HolidayIn, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    day = datetime.strptime(payload.date, "%Y-%m-%d")
    existing = db.query(Holiday).filter(Holiday.date == day).first()
    if existing:
        raise HTTPException(status_code=400, detail="این تاریخ قبلا به عنوان تعطیل ثبت شده")
    holiday = Holiday(date=day, description=payload.description)
    db.add(holiday)
    db.commit()
    db.refresh(holiday)
    return holiday


@app.delete("/api/admin/holidays/{holiday_id}")
async def remove_holiday(holiday_id: str, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    holiday = db.query(Holiday).filter(Holiday.id == holiday_id).first()
    if not holiday:
        raise HTTPException(status_code=404, detail="تعطیلی پیدا نشد")
    db.delete(holiday)
    db.commit()
    return {"deleted": True}


@app.put("/api/admin/notice", response_model=NoticeOut)
async def update_site_notice(payload: NoticeUpdateIn, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    return NoticeOut(text=set_notice(db, payload.text))


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

    await manager.broadcast_to_admins({"type": "new_order", "order": order_to_dict(db, order)})

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


@app.get("/api/my/orders/{order_id}", response_model=OrderOut)
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


@app.post("/api/orders/{order_id}/receipt", response_model=OrderOut)
async def upload_receipt(
    order_id: str,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    content = await file.read()
    order = save_receipt(db, order_id, current_user.id, file, content)
    return order


@app.get("/api/orders/{order_id}/receipt")
async def view_own_receipt(
    order_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    path = get_receipt_path_for_viewer(db, order_id, current_user.id, is_admin=False)
    return FileResponse(path)


@app.get("/api/my/balance", response_model=BalanceOut)
async def my_balance(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return get_user_balance(db, current_user.id)


@app.get("/api/my/transactions", response_model=list[TransactionOut])
async def my_transactions(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return get_user_transactions_db(db, current_user.id)


# ---------------- پنل ادمین (سرور) ----------------

@app.post("/api/admin/auth/login", response_model=AdminLoginOut)
async def admin_login(payload: AdminLoginIn):
    if not verify_admin_credentials(payload.username, payload.password):
        raise HTTPException(status_code=401, detail="نام کاربری یا رمز عبور اشتباه است")
    return AdminLoginOut(token=create_admin_token())


@app.get("/api/admin/orders", response_model=list[OrderOut])
async def list_orders(status: str | None = None, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    query = db.query(Order)
    if status:
        query = query.filter(Order.status == OrderStatusEnum(status))
    orders = query.order_by(Order.created_at.desc()).all()
    return [order_to_admin_out(db, o) for o in orders]


@app.post("/api/admin/orders/{order_id}/decide", response_model=OrderOut)
async def decide_order(order_id: str, decision: OrderDecisionIn, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    order = decide_order_db(db, order_id, decision.status)
    await manager.broadcast_to_admins({"type": "order_updated", "order": order_to_dict(db, order)})
    return order_to_admin_out(db, order)


@app.post("/api/admin/orders/phone", response_model=OrderOut)
async def create_phone_order_endpoint(payload: PhoneOrderCreateIn, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    order = create_phone_order_db(
        db,
        user_id=payload.user_id,
        side=payload.side,
        amount_type=payload.amount_type,
        value=payload.value,
        mesghal17_price=payload.mesghal17_price,
        description=payload.description,
    )
    await manager.broadcast_to_admins({"type": "order_updated", "order": order_to_dict(db, order)})
    return order_to_admin_out(db, order)


@app.get("/api/admin/orders/{order_id}/receipt")
async def view_receipt_as_admin(order_id: str, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    path = get_receipt_path_for_viewer(db, order_id, viewer_user_id=None, is_admin=True)
    return FileResponse(path)


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


# ---------------- دسته‌بندی‌ها و کمیسیون (ادمین) ----------------

@app.get("/api/admin/roles", response_model=list[RoleOut])
async def get_roles(db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    return list_roles(db)


@app.post("/api/admin/roles", response_model=RoleOut)
async def add_role(payload: RoleCreateIn, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    return create_role(db, payload.name, payload.commission_type, payload.commission_value)


@app.patch("/api/admin/roles/{role_id}", response_model=RoleOut)
async def edit_role_commission(role_id: str, payload: RoleUpdateIn, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    return update_role_commission(db, role_id, payload.commission_type, payload.commission_value)


# ---------------- مدیریت کاربران (ادمین) ----------------

@app.post("/api/admin/users", response_model=AdminCreateUserOut)
async def create_user(payload: AdminCreateUserIn, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    user, reg_key = create_user_with_key(
        db,
        phone_number=payload.phone_number,
        full_name=payload.full_name,
        role_id=payload.role_id,
        national_id=payload.national_id,
        notes=payload.notes,
        key_ttl_days=payload.key_ttl_days,
    )
    return AdminCreateUserOut(
        user_id=user.id,
        user_code=user.user_code,
        phone_number=user.phone_number,
        registration_key=reg_key.key,
        expires_at=reg_key.expires_at,
    )


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
        user_code=user.user_code,
        phone_number=user.phone_number,
        full_name=user.full_name,
        national_id=user.national_id,
        notes=user.notes,
        is_blocked=user.is_blocked,
        created_at=user.created_at,
        gold_balance=balance["gold_balance"],
        cash_balance=balance["cash_balance"],
        role=user.role,
        is_online=user.is_online,
        device_info=user.device_info,
        registration_key=user.registration_key,
        orders=orders,
        transactions=transactions,
    )


@app.post("/api/admin/users/{user_id}/adjust-balance", response_model=TransactionOut)
async def adjust_user_balance(user_id: str, payload: BalanceAdjustIn, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    txn = adjust_balance_db(db, user_id, payload.gold_change, payload.cash_change, payload.note)
    return txn


@app.post("/api/admin/users/{user_id}/block", response_model=UserSummaryOut)
async def block_user(user_id: str, payload: BlockUserIn, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    user = set_user_blocked(db, user_id, payload.is_blocked)
    balance = get_user_balance(db, user_id)
    reg_key = user.registration_key
    return UserSummaryOut(
        id=user.id,
        user_code=user.user_code,
        phone_number=user.phone_number,
        full_name=user.full_name,
        is_blocked=user.is_blocked,
        created_at=user.created_at,
        gold_balance=balance["gold_balance"],
        cash_balance=balance["cash_balance"],
        role=user.role,
        is_online=user.is_online,
        registration_status=reg_key.status.value if reg_key else None,
    )


@app.patch("/api/admin/users/{user_id}", response_model=UserSummaryOut)
async def edit_user(user_id: str, payload: AdminUpdateUserIn, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    user = update_user_db(db, user_id, payload.full_name, payload.role_id, payload.national_id, payload.notes)
    balance = get_user_balance(db, user_id)
    reg_key = user.registration_key
    return UserSummaryOut(
        id=user.id,
        user_code=user.user_code,
        phone_number=user.phone_number,
        full_name=user.full_name,
        is_blocked=user.is_blocked,
        created_at=user.created_at,
        gold_balance=balance["gold_balance"],
        cash_balance=balance["cash_balance"],
        role=user.role,
        is_online=user.is_online,
        registration_status=reg_key.status.value if reg_key else None,
    )