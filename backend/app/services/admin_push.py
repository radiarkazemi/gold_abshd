"""
Web Push for admin devices (mobile PWA + desktop Action Center).

When an admin installs the PWA / grants notification permission, the
browser stores a push subscription. On new_order / new_kyc we fan out
a push so the phone can show a banner + play the OS notification sound
even if the admin tab is backgrounded or the screen is locked.

VAPID keys are auto-generated once and persisted in app_settings
(override via GOLDAPP_VAPID_* env vars when desired).
"""
from __future__ import annotations

import base64
import json
import logging
import os
from datetime import datetime

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

VAPID_PRIVATE_KEY_SETTING = "vapid_private_key"
VAPID_PUBLIC_KEY_SETTING = "vapid_public_key"


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _setting_get(db: Session, key: str) -> str | None:
    from app.models_db import AppSetting

    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    return row.value if row and row.value else None


def _setting_set(db: Session, key: str, value: str) -> None:
    from app.models_db import AppSetting

    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    if not row:
        row = AppSetting(key=key, value=value)
        db.add(row)
    else:
        row.value = value
        row.updated_at = datetime.utcnow()
    db.commit()


def _generate_vapid_keypair() -> tuple[str, str]:
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives import serialization

    private_key = ec.generate_private_key(ec.SECP256R1())
    priv_bytes = private_key.private_numbers().private_value.to_bytes(32, "big")
    pub_bytes = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.X962,
        format=serialization.PublicFormat.UncompressedPoint,
    )
    return _b64url(priv_bytes), _b64url(pub_bytes)


def get_vapid_keys(db: Session) -> tuple[str, str]:
    """Return (private_key, public_key) as URL-safe base64 strings."""
    priv = os.getenv("GOLDAPP_VAPID_PRIVATE_KEY") or _setting_get(db, VAPID_PRIVATE_KEY_SETTING)
    pub = os.getenv("GOLDAPP_VAPID_PUBLIC_KEY") or _setting_get(db, VAPID_PUBLIC_KEY_SETTING)
    if priv and pub:
        return priv, pub

    priv, pub = _generate_vapid_keypair()
    if not os.getenv("GOLDAPP_VAPID_PRIVATE_KEY"):
        _setting_set(db, VAPID_PRIVATE_KEY_SETTING, priv)
        _setting_set(db, VAPID_PUBLIC_KEY_SETTING, pub)
        logger.info("[push] generated and stored VAPID keypair in app_settings")
    return priv, pub


def get_vapid_public_key(db: Session) -> str:
    _, pub = get_vapid_keys(db)
    return pub


def _vapid_claims() -> dict:
    mailto = os.getenv("GOLDAPP_VAPID_MAILTO", "mailto:admin@ghasrtala.ir")
    if not mailto.startswith("mailto:"):
        mailto = f"mailto:{mailto}"
    return {"sub": mailto}


def upsert_subscription(
    db: Session,
    *,
    admin_username: str,
    endpoint: str,
    p256dh: str,
    auth: str,
    user_agent: str | None = None,
) -> None:
    from app.models_db import AdminPushSubscription

    if not endpoint or not p256dh or not auth:
        raise ValueError("incomplete push subscription")

    row = db.query(AdminPushSubscription).filter(AdminPushSubscription.endpoint == endpoint).first()
    if not row:
        row = AdminPushSubscription(endpoint=endpoint)
        db.add(row)
    row.admin_username = admin_username
    row.p256dh = p256dh
    row.auth = auth
    row.user_agent = (user_agent or "")[:500] or None
    row.last_seen_at = datetime.utcnow()
    db.commit()


def remove_subscription(db: Session, *, endpoint: str, admin_username: str | None = None) -> None:
    from app.models_db import AdminPushSubscription

    q = db.query(AdminPushSubscription).filter(AdminPushSubscription.endpoint == endpoint)
    if admin_username:
        q = q.filter(AdminPushSubscription.admin_username == admin_username)
    q.delete(synchronize_session=False)
    db.commit()


def _send_one(db: Session, row, payload: dict, vapid_private: str) -> bool:
    try:
        from pywebpush import webpush, WebPushException
    except ImportError:
        logger.warning("[push] pywebpush not installed — skipping")
        return False

    subscription_info = {
        "endpoint": row.endpoint,
        "keys": {"p256dh": row.p256dh, "auth": row.auth},
    }
    try:
        webpush(
            subscription_info=subscription_info,
            data=json.dumps(payload, ensure_ascii=False),
            vapid_private_key=vapid_private,
            vapid_claims=_vapid_claims(),
            ttl=120,
            headers={"Urgency": "high", "Topic": str(payload.get("tag") or "admin")[:32]},
        )
        return True
    except WebPushException as e:
        status = getattr(getattr(e, "response", None), "status_code", None)
        if status in (404, 410):
            logger.info("[push] dropping expired subscription for %s", row.admin_username)
            try:
                db.delete(row)
                db.commit()
            except Exception:
                db.rollback()
        else:
            logger.warning("[push] send failed for %s: %s", row.admin_username, e)
        return False
    except Exception as e:
        logger.warning("[push] send failed for %s: %s", row.admin_username, e)
        return False


def broadcast_admin_push(db: Session, payload: dict) -> int:
    """Send a push payload to every stored admin subscription. Returns send count."""
    from app.models_db import AdminPushSubscription

    rows = db.query(AdminPushSubscription).all()
    if not rows:
        return 0
    try:
        priv, _pub = get_vapid_keys(db)
    except Exception as e:
        logger.warning("[push] cannot load VAPID keys: %s", e)
        return 0

    sent = 0
    for row in list(rows):
        if _send_one(db, row, payload, priv):
            sent += 1
    return sent


def _fmt_num(value) -> str:
    try:
        return f"{float(value):,.0f}"
    except Exception:
        return str(value)


def notify_new_order(db: Session, order: dict | None) -> int:
    order = order or {}
    side = "خرید" if order.get("side") == "buy" else "فروش" if order.get("side") == "sell" else "سفارش"
    name = order.get("customer_name") or "مشتری"
    code = order.get("customer_code")
    code_s = f" #{code}" if code is not None else ""
    unit = "گرم ۱۸" if order.get("amount_type") == "weight" else "تومان"
    value = order.get("value")
    value_s = f"\n{_fmt_num(value)} {unit}" if value is not None else ""
    body = f"{side} — {name}{code_s}{value_s}"
    return broadcast_admin_push(
        db,
        {
            "title": "سفارش جدید — آبشده قصر طلا",
            "body": body,
            "tag": f"order-{order.get('id')}" if order.get("id") else "new-order",
            "type": "new_order",
            "icon": "/gt-icon-192.png",
            "badge": "/gt-icon-192.png",
            "vibrate": [220, 100, 220, 100, 320],
            "data": {"type": "new_order", "orderId": order.get("id"), "url": "/admin-hs-panel"},
        },
    )


def notify_new_kyc(db: Session, user: dict | None) -> int:
    user = user or {}
    name = user.get("full_name") or "مشتری"
    code = user.get("user_code")
    code_s = f" #{code}" if code is not None else ""
    phone = user.get("phone_number")
    phone_s = f"\n{phone}" if phone else ""
    return broadcast_admin_push(
        db,
        {
            "title": "درخواست احراز هویت — آبشده قصر طلا",
            "body": f"{name}{code_s}{phone_s}",
            "tag": f"kyc-{user.get('user_id')}" if user.get("user_id") else "new-kyc",
            "type": "new_kyc",
            "icon": "/gt-icon-192.png",
            "badge": "/gt-icon-192.png",
            "vibrate": [180, 80, 180],
            "data": {"type": "new_kyc", "userId": user.get("user_id"), "url": "/admin-hs-panel"},
        },
    )
