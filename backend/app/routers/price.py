import json

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from app.price_service import price_service
from app.ws_manager import manager
from app.config import settings
from app.db import get_db
from app.admin_auth import get_current_admin, require_permission
from app.schemas.order import OrderLimitsOut, OrderLimitsUpdateIn
from app.services.order_limits import get_order_limits, set_order_limits

router = APIRouter(tags=["price"])


@router.get("/api/price")
async def get_price():
    return price_service.get_price()


@router.get("/api/order-limits", response_model=OrderLimitsOut)
async def get_order_limits_endpoint(db: Session = Depends(get_db)):
    return OrderLimitsOut(**get_order_limits(db))


@router.put("/api/admin/order-limits", response_model=OrderLimitsOut)
async def update_order_limits(
    payload: OrderLimitsUpdateIn,
    db: Session = Depends(get_db),
    _admin=Depends(require_permission("dashboard")),
):
    return OrderLimitsOut(**set_order_limits(db, **payload.model_dump()))


@router.websocket("/ws/price")
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
