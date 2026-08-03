from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.admin_auth import get_current_admin
from app.services import admin_push

router = APIRouter(prefix="/api/admin/push", tags=["admin-push"])


class PushSubscribeIn(BaseModel):
    endpoint: str
    keys: dict  # { p256dh, auth }


class PushUnsubscribeIn(BaseModel):
    endpoint: str


@router.get("/vapid-public-key")
async def vapid_public_key(db: Session = Depends(get_db), admin: dict = Depends(get_current_admin)):
    try:
        return {"public_key": admin_push.get_vapid_public_key(db)}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"VAPID unavailable: {e}") from e


@router.post("/subscribe")
async def subscribe_push(
    payload: PushSubscribeIn,
    request: Request,
    db: Session = Depends(get_db),
    admin: dict = Depends(get_current_admin),
):
    keys = payload.keys or {}
    p256dh = keys.get("p256dh")
    auth = keys.get("auth")
    if not payload.endpoint or not p256dh or not auth:
        raise HTTPException(status_code=400, detail="incomplete subscription")
    try:
        admin_push.upsert_subscription(
            db,
            admin_username=admin.get("username") or "admin",
            endpoint=payload.endpoint,
            p256dh=p256dh,
            auth=auth,
            user_agent=request.headers.get("user-agent"),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"ok": True}


@router.post("/unsubscribe")
async def unsubscribe_push(
    payload: PushUnsubscribeIn,
    db: Session = Depends(get_db),
    admin: dict = Depends(get_current_admin),
):
    admin_push.remove_subscription(
        db,
        endpoint=payload.endpoint,
        admin_username=admin.get("username"),
    )
    return {"ok": True}
