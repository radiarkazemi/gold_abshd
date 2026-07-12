import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.price_service import price_service
from app.ws_manager import manager
from app.config import settings
from app.schemas.order import OrderLimitsOut

router = APIRouter(tags=["price"])


@router.get("/api/price")
async def get_price():
    return price_service.get_price()


@router.get("/api/order-limits", response_model=OrderLimitsOut)
async def get_order_limits():
    return OrderLimitsOut(min_weight=settings.MIN_ORDER_WEIGHT, max_weight=settings.MAX_ORDER_WEIGHT)


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