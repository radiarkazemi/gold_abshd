"""
Tahesab (ته‌حساب) accounting API client.

Two modes (GOLDAPP_TAHESAB_MODE):
  - bridge (default): VPS cannot reach the Windows PC's 127.0.0.1 API.
    Jobs go into tahesab_outbox; a tiny agent on that PC pulls and POSTs
    them to local Tahesab.
  - direct: VPS HTTP-posts to GOLDAPP_TAHESAB_BASE_URL (needs reachable host).

Auth for direct / agent posts:
  Authorization: Bearer <token>
  DBName: <env>
"""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime
from typing import Any

import httpx
import jdatetime
from sqlalchemy.orm import Session

from app.config import settings

logger = logging.getLogger(__name__)

_PERSIAN_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")


def _to_jalali(dt: datetime) -> jdatetime.date:
    return jdatetime.date.fromgregorian(date=dt.date())


def is_configured() -> bool:
    return bool(settings.TAHESAB_ENABLED and settings.TAHESAB_TOKEN)


def is_bridge_mode() -> bool:
    return (settings.TAHESAB_MODE or "bridge").strip().lower() != "direct"


def _headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {settings.TAHESAB_TOKEN}",
        "DBName": settings.TAHESAB_DBNAME,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def _scale_amount(toman: float) -> float:
    return float(toman) * float(settings.TAHESAB_AMOUNT_SCALE)


def _digits(value: str | None) -> str:
    if not value:
        return ""
    return re.sub(r"[^\d]", "", str(value).translate(_PERSIAN_DIGITS))


def _factor_code_for_order(order_id: str) -> str:
    compact = (order_id or "").replace("-", "")
    code = f"GA{compact}"
    if len(code) < 20:
        code = code.ljust(20, "0")
    return code[:40]


def enqueue_method(
    db: Session,
    method: str,
    params: list[Any],
    *,
    ref_type: str | None = None,
    ref_id: str | None = None,
) -> str | None:
    """Queue a Tahesab method for the Windows bridge. Returns outbox id."""
    from app.models_db import TahesabOutbox, gen_uuid

    # Dedupe pending identical ref jobs
    if ref_type and ref_id:
        existing = (
            db.query(TahesabOutbox)
            .filter(
                TahesabOutbox.ref_type == ref_type,
                TahesabOutbox.ref_id == ref_id,
                TahesabOutbox.method == method,
                TahesabOutbox.status == "pending",
            )
            .first()
        )
        if existing:
            return existing.id

    row = TahesabOutbox(
        id=gen_uuid(),
        method=method,
        params_json=json.dumps(params, ensure_ascii=False),
        ref_type=ref_type,
        ref_id=ref_id,
        status="pending",
        attempts=0,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    logger.info("[tahesab] queued %s ref=%s/%s id=%s", method, ref_type, ref_id, row.id)
    return row.id


def call_method_direct(method: str, params: list[Any]) -> dict[str, Any] | None:
    if not is_configured():
        return None
    url = settings.TAHESAB_BASE_URL
    body = {method: params}
    try:
        with httpx.Client(
            timeout=settings.TAHESAB_TIMEOUT,
            verify=settings.TAHESAB_VERIFY_SSL,
            follow_redirects=True,
        ) as client:
            resp = client.post(url, headers=_headers(), json=body)
    except Exception:
        logger.exception("[tahesab] %s request failed", method)
        return None

    if resp.status_code >= 400:
        logger.error(
            "[tahesab] %s HTTP %s: %s",
            method,
            resp.status_code,
            (resp.text or "")[:500],
        )
        return None

    try:
        data = resp.json()
    except Exception:
        logger.error("[tahesab] %s non-JSON response: %s", method, (resp.text or "")[:500])
        return None

    if not isinstance(data, dict):
        logger.error("[tahesab] %s unexpected payload type: %r", method, type(data))
        return None

    err = data.get("Error") or data.get("error") or data.get("Message")
    if err and "OK" not in data and "Api_Status" not in data:
        logger.error("[tahesab] %s error payload: %s", method, data)
        return None

    return data


def call_method(
    method: str,
    params: list[Any],
    *,
    db: Session | None = None,
    ref_type: str | None = None,
    ref_id: str | None = None,
) -> dict[str, Any] | None:
    """
    Execute (direct) or enqueue (bridge) a Tahesab method.
    Bridge mode returns {"queued": true, "outbox_id": "..."} on success.
    """
    if not is_configured():
        return None

    if is_bridge_mode():
        if db is None:
            logger.error("[tahesab] bridge mode requires db session for %s", method)
            return None
        oid = enqueue_method(db, method, params, ref_type=ref_type, ref_id=ref_id)
        return {"queued": True, "outbox_id": oid} if oid else None

    return call_method_direct(method, params)


def check_health() -> dict[str, Any] | None:
    return call_method_direct("CheckHealth", [])


def create_moshtari(
    *,
    name: str,
    tel: str,
    code_meli: str,
    group_name: str | None = None,
    address: str = "",
    birth_date: str = "",
    moaref: str = "",
    code_moaref: str | int = -1,
    moshtari_code: int = -1,
    jens_felez: int = 0,
    db: Session | None = None,
    ref_id: str | None = None,
) -> int | None:
    params = [
        name or "",
        group_name if group_name is not None else settings.TAHESAB_DEFAULT_GROUP,
        _digits(tel) or (tel or ""),
        address or "",
        _digits(code_meli) or (code_meli or ""),
        birth_date or "",
        moaref or "",
        code_moaref if code_moaref is not None else -1,
        int(moshtari_code),
        int(jens_felez),
    ]
    payload = call_method(
        "DoNewMoshtari",
        params,
        db=db,
        ref_type="user" if ref_id else None,
        ref_id=ref_id,
    )
    if not payload:
        return None
    if payload.get("queued"):
        # Prefer known code so sanads can use it before bridge ack.
        return int(moshtari_code) if int(moshtari_code) != -1 else None
    ok = payload.get("OK")
    try:
        return int(ok)
    except (TypeError, ValueError):
        logger.error("[tahesab] DoNewMoshtari missing OK code: %s", payload)
        return None


def create_sanad_buy_sale_gold(
    *,
    moshtari_code: int,
    shamsi_year: int,
    shamsi_month: int,
    shamsi_day: int,
    vazn: float,
    ayar: float,
    buy_or_sale: int,
    mazaneh: float,
    mazaneh_is_gram: int,
    is_abshode: int,
    mablagh_kol: float,
    sharh: str,
    factor_code: str,
    factor_number: int = -1,
    radif_number: int = 1,
    havaleh_be: int = -1,
    multi_radif: int = -1,
    jens_felez: int = 0,
    zaman_tasvie: str = "",
    arz_name: str = "",
    db: Session | None = None,
    ref_id: str | None = None,
) -> str | None:
    params = [
        int(settings.TAHESAB_SABTE_KOL),
        int(moshtari_code),
        int(factor_number),
        int(radif_number),
        int(shamsi_year),
        int(shamsi_month),
        int(shamsi_day),
        float(vazn),
        float(ayar),
        0,
        "",
        int(buy_or_sale),
        float(mazaneh),
        int(mazaneh_is_gram),
        int(is_abshode),
        float(mablagh_kol),
        sharh or "",
        factor_code,
        int(havaleh_be),
        int(multi_radif),
        int(jens_felez),
        zaman_tasvie or "",
        arz_name or "",
    ]
    payload = call_method(
        "DoNewSanadBuySaleGOLD",
        params,
        db=db,
        ref_type="order" if ref_id else None,
        ref_id=ref_id,
    )
    if not payload:
        return None
    if payload.get("queued"):
        return factor_code
    ok = payload.get("OK")
    if ok is None:
        logger.error("[tahesab] DoNewSanadBuySaleGOLD missing OK: %s", payload)
        return None
    return str(ok)


def create_sanad_buy_sale_sekeh(
    *,
    moshtari_code: int,
    shamsi_year: int,
    shamsi_month: int,
    shamsi_day: int,
    count: float,
    name_sekeh: str,
    buy_or_sale: int,
    mazaneh: float,
    mablagh_kol: float,
    sharh: str,
    factor_code: str,
    vazn: float = 0,
    ayar: float = 0,
    factor_number: int = -1,
    radif_number: int = 1,
    multi_radif: int = -1,
    jens_felez: int = 0,
    arz_name: str = "",
    db: Session | None = None,
    ref_id: str | None = None,
) -> str | None:
    params = [
        int(settings.TAHESAB_SABTE_KOL),
        int(moshtari_code),
        int(factor_number),
        int(radif_number),
        int(shamsi_year),
        int(shamsi_month),
        int(shamsi_day),
        float(vazn),
        float(ayar),
        float(count),
        name_sekeh or "سکه",
        int(buy_or_sale),
        float(mazaneh),
        float(mablagh_kol),
        sharh or "",
        factor_code,
        -1,
        int(multi_radif),
        int(jens_felez),
        arz_name or "",
    ]
    payload = call_method(
        "DoNewSanadBuySaleSEKEH",
        params,
        db=db,
        ref_type="order" if ref_id else None,
        ref_id=ref_id,
    )
    if not payload:
        return None
    if payload.get("queued"):
        return factor_code
    ok = payload.get("OK")
    if ok is None:
        logger.error("[tahesab] DoNewSanadBuySaleSEKEH missing OK: %s", payload)
        return None
    return str(ok)


def sync_user_to_tahesab(db: Session, user) -> int | None:
    if not is_configured():
        return None
    existing = getattr(user, "tahesab_moshtari_id", None)
    if existing is not None:
        return int(existing)

    preferred_code = -1
    try:
        preferred_code = int(str(user.user_code).strip())
    except (TypeError, ValueError):
        preferred_code = -1

    code = create_moshtari(
        name=(user.full_name or user.phone_number or f"کاربر {user.user_code}"),
        tel=user.phone_number or "",
        code_meli=user.national_id or "",
        moaref=user.referrer or "",
        moshtari_code=preferred_code,
        db=db,
        ref_id=user.id,
    )
    if code is None and preferred_code != -1 and not is_bridge_mode():
        code = create_moshtari(
            name=(user.full_name or user.phone_number or f"کاربر {user.user_code}"),
            tel=user.phone_number or "",
            code_meli=user.national_id or "",
            moaref=user.referrer or "",
            moshtari_code=-1,
            db=db,
            ref_id=user.id,
        )
    if code is None:
        return None

    user.tahesab_moshtari_id = int(code)
    db.add(user)
    db.commit()
    db.refresh(user)
    logger.info("[tahesab] synced user %s → moshtari %s", user.user_code, code)
    return int(code)


def _order_quantity(order) -> float:
    if order.amount_type.value == "count":
        return float(order.value)
    if order.amount_type.value == "weight":
        return float(order.value)
    price = float(order.price_at_submit or 0)
    return float(order.value) / price if price else 0.0


def _order_total_toman(order) -> float:
    if order.amount_type.value == "amount":
        return float(order.value)
    return float(order.value) * float(order.price_at_submit or 0)


def sync_accepted_order_to_tahesab(db: Session, order) -> str | None:
    if not is_configured():
        return None
    existing = getattr(order, "tahesab_factor_code", None)
    if existing:
        return str(existing)
    if not order.user_id:
        return None

    from app.models_db import User

    user = db.query(User).filter(User.id == order.user_id).first()
    if not user:
        logger.error("[tahesab] order %s has no user", order.id)
        return None

    moshtari = getattr(user, "tahesab_moshtari_id", None)
    if moshtari is None:
        moshtari = sync_user_to_tahesab(db, user)
    if moshtari is None:
        logger.error("[tahesab] cannot resolve moshtari for order %s", order.id)
        return None

    when = order.updated_at or order.created_at or datetime.utcnow()
    j = _to_jalali(when)
    buy_or_sale = 0 if order.side.value == "buy" else 1
    qty = _order_quantity(order)
    total = _scale_amount(_order_total_toman(order))
    mazaneh_mesghal = order.mesghal17_price_at_submit
    if mazaneh_mesghal is None:
        mazaneh_mesghal = order.price_at_submit or 0
    mazaneh = _scale_amount(float(mazaneh_mesghal))
    factor_code = _factor_code_for_order(order.id)
    is_coin = order.amount_type.value == "count"
    side_fa = "خرید" if order.side.value == "buy" else "فروش"
    sharh = (
        f"اپ {side_fa} {'سکه' if is_coin else 'طلا'} "
        f"کد مشتری {user.user_code} سفارش {order.id[:8]}"
    )

    if is_coin:
        name = (order.description or "").strip() or "سکه"
        ok = create_sanad_buy_sale_sekeh(
            moshtari_code=int(moshtari),
            shamsi_year=j.year,
            shamsi_month=j.month,
            shamsi_day=j.day,
            count=qty,
            name_sekeh=name[:80],
            buy_or_sale=buy_or_sale,
            mazaneh=mazaneh,
            mablagh_kol=total,
            sharh=sharh,
            factor_code=factor_code,
            db=db,
            ref_id=order.id,
        )
    else:
        ok = create_sanad_buy_sale_gold(
            moshtari_code=int(moshtari),
            shamsi_year=j.year,
            shamsi_month=j.month,
            shamsi_day=j.day,
            vazn=qty,
            ayar=750,
            buy_or_sale=buy_or_sale,
            mazaneh=mazaneh,
            mazaneh_is_gram=0,
            is_abshode=int(settings.TAHESAB_IS_ABSHODE),
            mablagh_kol=total,
            sharh=sharh,
            factor_code=factor_code,
            db=db,
            ref_id=order.id,
        )

    if not ok:
        return None

    order.tahesab_factor_code = str(ok)
    db.add(order)
    db.commit()
    db.refresh(order)
    logger.info("[tahesab] order %s → factor %s", order.id, ok)
    return str(ok)


def apply_bridge_result(db: Session, job, result: dict[str, Any]) -> None:
    """Apply successful bridge response onto User / Order rows."""
    from app.models_db import Order, User

    ok = result.get("OK")
    if job.ref_type == "user" and job.ref_id and ok is not None:
        user = db.query(User).filter(User.id == job.ref_id).first()
        if user:
            try:
                user.tahesab_moshtari_id = int(ok)
                db.add(user)
            except (TypeError, ValueError):
                pass
    if job.ref_type == "order" and job.ref_id and ok is not None:
        order = db.query(Order).filter(Order.id == job.ref_id).first()
        if order:
            order.tahesab_factor_code = str(ok)
            db.add(order)


def sync_user_isolated(user_id: str) -> None:
    from app.db import SessionLocal
    from app.models_db import User

    if not is_configured():
        return
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            return
        sync_user_to_tahesab(db, user)
    except Exception:
        logger.exception("[tahesab] isolated user sync failed for %s", user_id)
    finally:
        db.close()


def sync_accepted_order_isolated(order_id: str) -> None:
    from app.db import SessionLocal
    from app.models_db import Order

    if not is_configured():
        return
    db = SessionLocal()
    try:
        order = db.query(Order).filter(Order.id == order_id).first()
        if not order:
            return
        sync_accepted_order_to_tahesab(db, order)
    except Exception:
        logger.exception("[tahesab] isolated order sync failed for %s", order_id)
    finally:
        db.close()


def bridge_agent_config() -> dict[str, Any]:
    """Config the Windows agent needs (no bridge secret)."""
    return {
        "tahesab_base_url": settings.TAHESAB_BASE_URL,
        "tahesab_token": settings.TAHESAB_TOKEN,
        "tahesab_dbname": settings.TAHESAB_DBNAME,
        "tahesab_verify_ssl": settings.TAHESAB_VERIFY_SSL,
        "poll_seconds": 2,
    }
