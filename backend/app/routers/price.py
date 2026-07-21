import json

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from app.price_service import price_service
from app.services import price_cards
from app.ws_manager import manager
from app.config import settings
from app.db import get_db
from app.admin_auth import get_current_admin, require_permission
from app.schemas.order import OrderLimitsOut, OrderLimitsUpdateIn
from app.services.order_limits import get_order_limits, set_order_limits, get_effective_limits
from app.obfuscation import encode_payload
from app.auth import get_current_user
from app.models_db import User

router = APIRouter(tags=["price"])


def _current_payload(db: Session) -> dict:
    """Same {"cards": [...]} shape as the live broadcast - see
    services/price_cards.build_broadcast_payload. Falls back to the
    legacy single-price service for non-"api" sources (simulator,
    telegram), which don't have a concept of multiple cards."""
    if settings.PRICE_SOURCE.lower() == "api":
        return price_cards.build_broadcast_payload(db)
    p = price_service.get_price().model_dump()
    card = {
        "goldbridge_item_id": None,
        "name": "قیمت",
        "type": 1,
        "unit": "gram18",
        "item_weight": None,
        "is_primary": True,
        "orderable_buy": True,
        "orderable_sell": True,
        "buy_price": p["buy_price"],
        "sell_price": p["sell_price"],
        "gram18_buy_price": p.get("gram18_buy_price"),
        "gram18_sell_price": p.get("gram18_sell_price"),
    }
    return {"cards": [card], "updated_at": p.get("updated_at")}


@router.get("/api/price")
async def get_price(db: Session = Depends(get_db)):
    """
    Response shape: {"payload": "<obfuscated blob>"}. Frontend decodes
    with the matching XOR+base64 scheme in src/utils/payloadCodec.js -
    see app/obfuscation.py for exactly what this is/isn't protecting
    against.
    """
    return {"payload": encode_payload(_current_payload(db))}


@router.get("/api/order-limits", response_model=OrderLimitsOut)
async def get_order_limits_endpoint(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Personalized by the logged-in user's role - see
    services/order_limits.get_effective_limits for how role overrides
    layer on top of the app-wide defaults."""
    return OrderLimitsOut(**get_effective_limits(db, current_user))


@router.put("/api/admin/order-limits", response_model=OrderLimitsOut)
async def update_order_limits(
    payload: OrderLimitsUpdateIn,
    db: Session = Depends(get_db),
    _admin=Depends(require_permission("dashboard")),
):
    return OrderLimitsOut(**set_order_limits(db, **payload.model_dump()))


@router.websocket("/ws/price")
async def ws_price(websocket: WebSocket, db: Session = Depends(get_db)):
    await manager.connect_price(websocket)
    try:
        # اولین پیام: قیمت فعلی رو بلافاصله بفرست (obfuscated - see manager.broadcast_price)
        await websocket.send_text(
            json.dumps({"payload": encode_payload(_current_payload(db))})
        )
        while True:
            await websocket.receive_text()  # فقط برای نگه‌داشتن اتصال زنده
    except WebSocketDisconnect:
        manager.disconnect_price(websocket)