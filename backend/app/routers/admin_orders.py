from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect, Query, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.ws_manager import manager
from app.admin_auth import get_current_admin, verify_admin_ws_token, require_permission
from app.models_db import Order, OrderStatusEnum
from app.schemas.order import OrderOut, OrderDecisionIn
from app.schemas.admin import PhoneOrderCreateIn
from app.services.orders import (
    decide_order as decide_order_db,
    create_phone_order as create_phone_order_db,
    order_to_dict,
    order_to_admin_out,
)

router = APIRouter(prefix="/api/admin/orders", tags=["admin-orders"])


@router.get("", response_model=list[OrderOut])
async def list_orders(status: str | None = None, db: Session = Depends(get_db), _admin=Depends(require_permission("orders"))):
    query = db.query(Order)
    if status:
        query = query.filter(Order.status == OrderStatusEnum(status))
    orders = query.order_by(Order.created_at.desc()).all()
    return [order_to_admin_out(db, o) for o in orders]


@router.post("/{order_id}/decide", response_model=OrderOut)
async def decide_order(order_id: str, decision: OrderDecisionIn, db: Session = Depends(get_db), _admin=Depends(require_permission("orders"))):
    order = decide_order_db(db, order_id, decision.status)
    await manager.broadcast_to_admins({"type": "order_updated", "order": order_to_dict(db, order)})
    return order_to_admin_out(db, order)


@router.post("/phone", response_model=OrderOut)
async def create_phone_order_endpoint(payload: PhoneOrderCreateIn, db: Session = Depends(get_db), _admin=Depends(require_permission("phone-order"))):
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


# The admin WebSocket lives here too since it's tightly coupled to order
# notifications (new_order / order_updated events), even though the URL
# itself is /ws/admin, not under /api/admin/orders.
ws_router = APIRouter(tags=["admin-orders"])


@ws_router.websocket("/ws/admin")
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
