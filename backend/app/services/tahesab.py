"""
Tahesab (ته‌حساب) accounting API client.

Recommended (Tahesab support): direct mode
  - Shop PC: API on port 8081, static public IP, modem port-forward, firewall open
  - VPS always queues jobs in tahesab_outbox, then a background worker POSTs to
    GOLDAPP_TAHESAB_BASE_URL. When the Windows PC is offline, jobs wait and
    drain automatically once it comes back online — no pull agent required.

Optional: bridge mode (Windows agent pulls jobs) if port-forward is not possible.

Auth:
  Authorization: Bearer <token>
  DBName: <env>
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime, timedelta
from typing import Any
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

import httpx
import jdatetime
from sqlalchemy.orm import Session

from app.config import settings

logger = logging.getLogger(__name__)

_PERSIAN_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")

# Docs: {"getmandehesabbycode":["1","2"]} → {MandeHesab:[{Code, MandeyeVazni, MandeyeMali, ...}]}
MANDE_METHOD = "getmandehesabbycode"
MANDE_BATCH_SIZE = 80
AGENT_ONLINE_GAP_SECONDS = 30 * 60
SETTING_AGENT_LAST_SEEN = "tahesab_agent_last_seen"
SETTING_MANDE_REFRESH_DAY = "tahesab_mande_refresh_day"
TEHRAN_TZ = ZoneInfo("Asia/Tehran")


def _to_jalali(dt: datetime) -> jdatetime.date:
    return jdatetime.date.fromgregorian(date=dt.date())


def is_configured() -> bool:
    return bool(settings.TAHESAB_ENABLED and settings.TAHESAB_TOKEN)


def is_bridge_mode() -> bool:
    return (settings.TAHESAB_MODE or "direct").strip().lower() == "bridge"


def is_direct_target_ready() -> bool:
    """True when BASE_URL looks like a reachable non-loopback host."""
    url = (settings.TAHESAB_BASE_URL or "").strip()
    if not url:
        return False
    try:
        host = (urlparse(url).hostname or "").lower()
    except Exception:
        return False
    if not host or host in {"127.0.0.1", "localhost", "::1"}:
        return False
    return True


def _headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {settings.TAHESAB_TOKEN}",
        "DBName": settings.TAHESAB_DBNAME,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def _scale_amount(toman: float) -> float:
    return float(toman) * float(settings.TAHESAB_AMOUNT_SCALE)


def _unscale_amount(mali: float) -> float:
    """Tahesab MandeyeMali (rial-scale) → app تومان."""
    scale = float(settings.TAHESAB_AMOUNT_SCALE or 1) or 1.0
    return float(mali) / scale


def _to_float(value: Any) -> float:
    if value is None or value == "":
        return 0.0
    if isinstance(value, bool):
        return float(int(value))
    if isinstance(value, (int, float)):
        return float(value)
    text = (
        str(value)
        .translate(_PERSIAN_DIGITS)
        .replace(",", "")
        .replace(" ", "")
        .replace("\u200c", "")
        .strip()
    )
    try:
        return float(text)
    except ValueError:
        return 0.0


def _tehran_today_iso() -> str:
    return datetime.now(TEHRAN_TZ).date().isoformat()


def _get_app_setting(db: Session, key: str) -> str | None:
    from app.models_db import AppSetting

    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    return row.value if row else None


def _set_app_setting(db: Session, key: str, value: str) -> None:
    from app.models_db import AppSetting

    now = datetime.utcnow()
    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    if row:
        row.value = value
        row.updated_at = now
        db.add(row)
    else:
        db.add(AppSetting(key=key, value=value, updated_at=now))
    db.flush()


def parse_mande_rows(payload: Any) -> list[dict[str, Any]]:
    """Normalize getmandehesabbycode JSON into [{code, vazni, mali}, ...]."""
    rows: list[Any] = []
    if payload is None:
        return []
    if isinstance(payload, list):
        rows = payload
    elif isinstance(payload, dict):
        found = False
        for key, val in payload.items():
            if str(key).lower().replace("_", "") in {"mandehesab"}:
                found = True
                if isinstance(val, list):
                    rows = val
                elif isinstance(val, dict):
                    rows = [val]
                break
        if not found:
            lowered = {str(k).lower(): k for k in payload}
            if "code" in lowered or "mandeyevazni" in lowered or "mandeyemali" in lowered:
                rows = [payload]
    out: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        code_raw = row.get("Code", row.get("code"))
        if code_raw is None:
            continue
        try:
            code = int(str(code_raw).translate(_PERSIAN_DIGITS).strip())
        except (TypeError, ValueError):
            continue
        vazni = _mande_gold_from_row(row)
        mali = _to_float(
            row.get("MandeyeMali", row.get("mandeyemali", row.get("Mandeye_Mali")))
        )
        out.append({"code": code, "vazni": vazni, "mali": mali})
    return out


def _mande_gold_from_row(row: dict[str, Any]) -> float:
    """Final مانده طلا as Tahesab reports it (already grams, not مثقال)."""
    details = row.get("details") or row.get("Details")
    if isinstance(details, list):
        for item in details:
            if not isinstance(item, dict):
                continue
            name = str(item.get("Name") or item.get("name") or "")
            name_n = (
                name.replace("\u064a", "\u06cc")
                .replace("\u0643", "\u06a9")
                .replace("\u200c", "")
                .strip()
            )
            if name_n == "مانده طلا":
                raw = item.get("Value", item.get("Value1"))
                if raw not in (None, ""):
                    return _to_float(raw)
    return _to_float(
        row.get("MandeyeVazni", row.get("mandeyevazni", row.get("Mandeye_Vazni")))
    )


def payload_is_mande_success(data: Any) -> bool:
    if not isinstance(data, dict):
        return False
    for key in data:
        if str(key).lower().replace("_", "") == "mandehesab":
            return True
    return (data.get("method") or "").lower() == MANDE_METHOD


def apply_mande_rows(db: Session, rows: list[dict[str, Any]]) -> int:
    """Write Tahesab مانده طلا / مانده مالی onto matching User rows.

    MandeyeVazni / details.مانده طلا is already the final gold remaining
    in grams. Do not multiply by 4.3318 (that is a price divisor).
    MandeyeMali is rial-scale and is divided by TAHESAB_AMOUNT_SCALE.
    """
    from app.models_db import User

    now = datetime.utcnow()
    applied = 0
    for row in rows:
        user = (
            db.query(User)
            .filter(User.tahesab_moshtari_id == int(row["code"]))
            .first()
        )
        if not user:
            logger.info("[tahesab] mande skip unknown moshtari %s", row["code"])
            continue
        user.tahesab_gold_balance = float(row["vazni"])
        user.tahesab_cash_balance = _unscale_amount(row["mali"])
        user.tahesab_balance_at = now
        db.add(user)
        applied += 1
        logger.info(
            "[tahesab] mande user=%s moshtari=%s gold_g18=%.4f cash_toman=%.0f",
            user.user_code,
            row["code"],
            user.tahesab_gold_balance,
            user.tahesab_cash_balance,
        )
    return applied


def enqueue_mande_for_user(db: Session, user, *, ref_suffix: str | None = None) -> str | None:
    if not is_configured():
        return None
    moshtari = getattr(user, "tahesab_moshtari_id", None)
    if moshtari is None:
        return None
    ref_id = str(user.id)
    if ref_suffix:
        ref_id = f"{user.id}:{ref_suffix}"
    return enqueue_method(
        db,
        MANDE_METHOD,
        [str(int(moshtari))],
        ref_type="mande",
        ref_id=ref_id,
    )


def enqueue_mande_for_all_users(db: Session) -> int:
    """Queue getmandehesabbycode for every user that already has a moshtari code."""
    from app.models_db import User

    if not is_configured():
        return 0
    users = (
        db.query(User)
        .filter(User.tahesab_moshtari_id.isnot(None))
        .order_by(User.tahesab_moshtari_id.asc())
        .all()
    )
    codes = []
    seen: set[str] = set()
    for user in users:
        try:
            code = str(int(user.tahesab_moshtari_id))
        except (TypeError, ValueError):
            continue
        if code in seen:
            continue
        seen.add(code)
        codes.append(code)
    if not codes:
        return 0
    day = _tehran_today_iso()
    queued = 0
    for i in range(0, len(codes), MANDE_BATCH_SIZE):
        chunk = codes[i : i + MANDE_BATCH_SIZE]
        oid = enqueue_method(
            db,
            MANDE_METHOD,
            chunk,
            ref_type="mande-day",
            ref_id=f"{day}:{i // MANDE_BATCH_SIZE}",
        )
        if oid:
            queued += 1
    logger.info("[tahesab] queued mande refresh jobs=%s users=%s", queued, len(codes))
    return queued


def maybe_enqueue_online_mande_refresh(db: Session) -> int:
    """Pull all user remainings on first Tehran-day poll or after a 30min agent gap."""
    if not is_configured():
        return 0
    now = datetime.utcnow()
    last_seen_raw = _get_app_setting(db, SETTING_AGENT_LAST_SEEN)
    last_day = _get_app_setting(db, SETTING_MANDE_REFRESH_DAY)
    today = _tehran_today_iso()

    last_seen_dt: datetime | None = None
    if last_seen_raw:
        try:
            last_seen_dt = datetime.fromisoformat(last_seen_raw)
        except ValueError:
            last_seen_dt = None

    gap = last_seen_dt is None or (now - last_seen_dt).total_seconds() >= AGENT_ONLINE_GAP_SECONDS
    new_day = last_day != today
    queued = 0
    if gap or new_day:
        queued = enqueue_mande_for_all_users(db)
        _set_app_setting(db, SETTING_MANDE_REFRESH_DAY, today)
        logger.info(
            "[tahesab] online/daily mande refresh jobs=%s gap=%s new_day=%s",
            queued,
            gap,
            new_day,
        )

    stale_seen = last_seen_dt is None or (now - last_seen_dt).total_seconds() >= 60
    if stale_seen or queued:
        _set_app_setting(db, SETTING_AGENT_LAST_SEEN, now.isoformat())
    return queued


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

    # Dedupe pending/claimed identical ref jobs
    if ref_type and ref_id:
        existing = (
            db.query(TahesabOutbox)
            .filter(
                TahesabOutbox.ref_type == ref_type,
                TahesabOutbox.ref_id == ref_id,
                TahesabOutbox.method == method,
                TahesabOutbox.status.in_(("pending", "claimed")),
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
    db.flush()
    logger.info("[tahesab] queued %s ref=%s/%s id=%s", method, ref_type, ref_id, row.id)
    return row.id


def _persian_for_tahesab(text: Any) -> Any:
    """
    Access/Windows-1256 has no Iranian Yeh (U+06CC) or Keheh (U+06A9).
    Map them to Arabic Yeh/Kaf; strip ZWNJ used in فارسی typography.
    """
    if not isinstance(text, str):
        return text
    return (
        text.replace("\u200c", "")  # ZWNJ
        .replace("\u06cc", "\u064a")
        .replace("\u06a9", "\u0643")
    )


def _encode_tahesab_body(body: dict[str, Any]) -> bytes:
    mapped = {
        method: [_persian_for_tahesab(p) for p in params]
        for method, params in body.items()
    }
    # ASCII JSON with \\uXXXX escapes — encoding-proof for Windows locale APIs.
    return json.dumps(mapped, ensure_ascii=True, separators=(",", ":")).encode("ascii")


def call_method_direct(method: str, params: list[Any]) -> dict[str, Any] | None:
    """
    POST one method to TAHESAB_BASE_URL.
    Returns parsed JSON dict (may include ERROR), or None if unreachable/invalid.
    """
    if not is_configured() or not (settings.TAHESAB_BASE_URL or "").strip():
        return None
    url = settings.TAHESAB_BASE_URL
    body = {method: params}
    try:
        with httpx.Client(
            timeout=settings.TAHESAB_TIMEOUT,
            verify=settings.TAHESAB_VERIFY_SSL,
            follow_redirects=True,
        ) as client:
            # Access desktop API stores Persian as Windows-1256 (code page 1256).
            payload = _encode_tahesab_body(body)
            headers = {
                **_headers(),
                "Content-Type": "application/json; charset=utf-8",
            }
            resp = client.post(url, headers=headers, content=payload)
    except Exception as exc:
        logger.warning("[tahesab] %s unreachable: %s", method, exc)
        return None

    try:
        data = resp.json()
    except Exception:
        logger.error(
            "[tahesab] %s HTTP %s non-JSON: %s",
            method,
            resp.status_code,
            (resp.text or "")[:500],
        )
        return None

    if not isinstance(data, dict):
        logger.error("[tahesab] %s unexpected payload type: %r", method, type(data))
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
    Always enqueue to outbox (so offline Windows does not lose events).
    In direct mode the VPS worker drains the queue when the API is reachable.
    In bridge mode the Windows agent pulls the same queue.
    """
    if not is_configured():
        return None
    if db is None:
        logger.error("[tahesab] db session required to queue %s", method)
        return None
    oid = enqueue_method(db, method, params, ref_type=ref_type, ref_id=ref_id)
    return {"queued": True, "outbox_id": oid} if oid else None


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
    # Direct mode: if preferred code was rejected upstream, retry auto-code.
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

    # Bridge (and queued direct): wait for outbox ack before trusting the code.
    # Otherwise sanads can race ahead with a wrong/optimistic moshtari id.
    if is_bridge_mode():
        logger.info(
            "[tahesab] queued DoNewMoshtari for user %s preferred=%s; sanads wait for ack",
            user.user_code,
            preferred_code,
        )
        return None

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


def _gold_sanad_specs(order) -> tuple[float, float, int, int]:
    """vazn, ayar, is_abshode, mazaneh_is_gram for DoNewSanadBuySaleGOLD.

    آبشده (default): vazn = app گرم ۱۸, ayar 750, is_abshode=1,
    mazaneh per مثقال (mazaneh_is_gram=0).

    فروش متفرقه: shop buy of 740-ayar scrap. Tahesab form is
    خرید متفرقه(بدون تسویه): is_abshode=0, ayar=740, empty zaman_tasvie.
    Vazn stays the physical grams (do not ÷4.39). The 4.39 conversion
    belongs on the price: mazaneh_is_gram=1 and mazaneh = گرم price.
    """
    from app.services.price_cards import is_motaferaghe_card

    qty = _order_quantity(order)
    if is_motaferaghe_card(getattr(order, "goldbridge_item_id", None)):
        return qty, 740.0, 0, 1
    return qty, 750.0, int(settings.TAHESAB_IS_ABSHODE), 0


def _order_total_toman(order) -> float:
    if order.amount_type.value == "amount":
        return float(order.value)
    return float(order.value) * float(order.price_at_submit or 0)


def _queue_pending_order_sanads(db: Session, user) -> None:
    """After moshtari is confirmed, queue gold/money sanads for accepted orders."""
    from app.models_db import Order, OrderStatusEnum

    orders = (
        db.query(Order)
        .filter(
            Order.user_id == user.id,
            Order.status == OrderStatusEnum.accepted,
            Order.tahesab_factor_code.is_(None),
            Order.tahesab_sync_needed.is_(True),
        )
        .order_by(Order.created_at.asc())
        .all()
    )
    for order in orders:
        try:
            sync_accepted_order_to_tahesab(db, order)
        except Exception:
            logger.exception(
                "[tahesab] failed queuing sanad after moshtari for order %s",
                getattr(order, "id", "?"),
            )


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
        # Queue DoNewMoshtari first; sanad is enqueued from apply_bridge_result.
        sync_user_to_tahesab(db, user)
        db.refresh(user)
        moshtari = getattr(user, "tahesab_moshtari_id", None)
    if moshtari is None:
        logger.info(
            "[tahesab] defer sanad for order %s until moshtari ack (user %s)",
            order.id,
            user.user_code,
        )
        return None

    when = order.updated_at or order.created_at or datetime.utcnow()
    j = _to_jalali(when)
    # Tahesab Buy_or_Sale is shop-centric: 0 = shop buys FROM customer
    # (app sell), 1 = shop sells TO customer (app buy). Sending the app
    # side raw swapped بدهکار/بستانکار on the customer card.
    buy_or_sale = 1 if order.side.value == "buy" else 0
    qty = _order_quantity(order)
    total = _scale_amount(_order_total_toman(order))
    factor_code = _factor_code_for_order(order.id)
    is_coin = order.amount_type.value == "count"
    side_fa = "خرید" if order.side.value == "buy" else "فروش"
    sharh = (
        f"اپ {side_fa} {'سکه' if is_coin else 'طلا'} "
        f"کد مشتری {user.user_code} سفارش {order.id[:8]}"
    )

    if is_coin:
        mazaneh_mesghal = order.mesghal17_price_at_submit
        if mazaneh_mesghal is None:
            mazaneh_mesghal = order.price_at_submit or 0
        mazaneh = _scale_amount(float(mazaneh_mesghal))
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
        vazn, ayar, is_abshode, mazaneh_is_gram = _gold_sanad_specs(order)
        if mazaneh_is_gram:
            mazaneh = _scale_amount(float(order.price_at_submit or 0))
        else:
            mazaneh_mesghal = order.mesghal17_price_at_submit
            if mazaneh_mesghal is None:
                mazaneh_mesghal = order.price_at_submit or 0
            mazaneh = _scale_amount(float(mazaneh_mesghal))
        if is_abshode == 0:
            sharh = (
                f"اپ خريد متفرقه(بدون تسويه) عيار 740 "
                f"کد مشتري {user.user_code} سفارش {order.id[:8]}"
            )
        ok = create_sanad_buy_sale_gold(
            moshtari_code=int(moshtari),
            shamsi_year=j.year,
            shamsi_month=j.month,
            shamsi_day=j.day,
            vazn=vazn,
            ayar=ayar,
            buy_or_sale=buy_or_sale,
            mazaneh=mazaneh,
            mazaneh_is_gram=mazaneh_is_gram,
            is_abshode=is_abshode,
            mablagh_kol=total,
            sharh=sharh,
            factor_code=factor_code,
            zaman_tasvie="",
            db=db,
            ref_id=order.id,
        )

    if not ok:
        return None

    # Do not set order.tahesab_factor_code until outbox ack (apply_bridge_result).
    # That lets failed sanads retry and keeps moshtari→sanad ordering correct.
    logger.info(
        "[tahesab] queued sanad order=%s factor=%s moshtari=%s qty=%s mablagh=%s side=%s coin=%s",
        order.id,
        ok,
        moshtari,
        qty if is_coin else vazn,
        total,
        order.side.value,
        is_coin,
    )
    return str(ok)


def apply_bridge_result(db: Session, job, result: dict[str, Any]) -> None:
    """Apply successful response onto User / Order rows."""
    from app.models_db import Order, User

    method = (getattr(job, "method", None) or "").lower()
    if method == MANDE_METHOD or job.ref_type in ("mande", "mande-day"):
        apply_mande_rows(db, parse_mande_rows(result or {}))
        return

    ok = result.get("OK")
    if job.ref_type == "user" and job.ref_id and ok is not None:
        user = db.query(User).filter(User.id == job.ref_id).first()
        if user:
            try:
                user.tahesab_moshtari_id = int(ok)
                db.add(user)
                db.flush()
                _queue_pending_order_sanads(db, user)
                enqueue_mande_for_user(db, user)
            except (TypeError, ValueError):
                pass
    if job.ref_type == "order" and job.ref_id and ok is not None:
        order = db.query(Order).filter(Order.id == job.ref_id).first()
        if order:
            order.tahesab_factor_code = str(ok)
            order.tahesab_sync_needed = False
            db.add(order)
            user_id = getattr(order, "user_id", None)
            if user_id:
                user = db.query(User).filter(User.id == user_id).first()
                if user:
                    enqueue_mande_for_user(db, user, ref_suffix=str(order.id))


def _error_text(data: dict[str, Any] | None) -> str:
    if not data:
        return ""
    return str(data.get("ERROR") or data.get("Error") or data.get("error") or "")


def lookup_moshtari_by_phone(tel: str) -> int | None:
    """DoListMoshtari filtered by phone; returns first Code or None."""
    digits = _digits(tel)
    if not digits:
        return None
    candidates: list[Any] = []
    try:
        candidates.append(int(digits))
    except ValueError:
        candidates.append(digits)
    if digits.startswith("0") and len(digits) > 1:
        try:
            candidates.append(int(digits[1:]))
        except ValueError:
            candidates.append(digits[1:])
    else:
        try:
            candidates.append(int("0" + digits))
        except ValueError:
            candidates.append("0" + digits)

    for cand in candidates:
        data = call_method_direct("DoListMoshtari", [cand])
        if not data or _error_text(data):
            continue
        for _key, row in data.items():
            if not isinstance(row, dict):
                continue
            code = row.get("Code", row.get("code"))
            if code is None:
                continue
            try:
                return int(code)
            except (TypeError, ValueError):
                continue
    return None


def process_outbox_job(db: Session, job) -> str:
    """
    Push one outbox job to Tahesab (direct). Returns done|pending|error.
    Unreachable API → pending (retry when Windows comes online).
    """
    try:
        params = json.loads(job.params_json or "[]")
    except json.JSONDecodeError:
        params = []

    job.attempts = (job.attempts or 0) + 1
    job.updated_at = datetime.utcnow()

    data = call_method_direct(job.method, params)
    if data is None:
        job.last_error = "unreachable (Windows offline or BASE_URL not ready)"
        job.status = "pending"
        db.add(job)
        db.commit()
        return "pending"

    err = _error_text(data)
    if err:
        if job.method == "DoNewMoshtari" and ("تلفن تکراری" in err or "تکراری" in err):
            tel = params[2] if len(params) > 2 else ""
            linked = lookup_moshtari_by_phone(str(tel))
            if linked is not None:
                result = {"OK": linked, "linked": True, "note": err}
                job.status = "done"
                job.result_json = json.dumps(result, ensure_ascii=False)
                job.last_error = None
                apply_bridge_result(db, job, result)
                db.add(job)
                db.commit()
                logger.info("[tahesab] linked duplicate phone → moshtari %s", linked)
                return "done"

        # Already posted — treat duplicate Factor_Code as success, do not retry.
        if "Factor_Code" in err or "کد فاکتور" in err:
            factor = None
            if job.method == "DoNewSanadBuySaleGOLD" and len(params) > 17:
                factor = str(params[17])
            elif job.method == "DoNewSanadBuySaleSEKEH" and len(params) > 15:
                factor = str(params[15])
            result = {"OK": factor or "duplicate", "linked": True, "note": err}
            job.status = "done"
            job.result_json = json.dumps(result, ensure_ascii=False)
            job.last_error = None
            apply_bridge_result(db, job, result)
            db.add(job)
            db.commit()
            logger.info("[tahesab] Factor_Code already exists → %s", factor)
            return "done"

        job.last_error = err[:2000]
        # Permanent business errors stop retrying; transient keep pending.
        if any(x in err for x in ("تکراری", "نامعتبر", "مجاز نیست")) and job.attempts >= 3:
            job.status = "error"
        elif job.attempts >= 50:
            job.status = "error"
        else:
            job.status = "pending"
        db.add(job)
        db.commit()
        return job.status

    # Success shapes: {"OK": ...}, CheckHealth {"Api_Status": "OK"},
    # or getmandehesabbycode {"MandeHesab": [...]}.
    if (
        "OK" not in data
        and "Api_Status" not in data
        and not payload_is_mande_success(data)
        and (job.method or "").lower() != MANDE_METHOD
    ):
        job.last_error = f"unexpected response: {str(data)[:500]}"
        job.status = "pending"
        db.add(job)
        db.commit()
        return "pending"

    job.status = "done"
    job.result_json = json.dumps(data, ensure_ascii=False)
    job.last_error = None
    apply_bridge_result(db, job, data)
    db.add(job)
    db.commit()
    logger.info("[tahesab] outbox %s %s done", job.id, job.method)
    return "done"


def process_outbox_batch(db: Session, limit: int = 20) -> dict[str, int]:
    from app.models_db import TahesabOutbox

    counts = {"done": 0, "pending": 0, "error": 0, "skipped": 0}
    if not is_configured():
        return counts
    if is_bridge_mode():
        # Windows agent owns delivery in bridge mode.
        counts["skipped"] = 1
        return counts
    if not is_direct_target_ready():
        counts["skipped"] = 1
        return counts

    maybe_enqueue_online_mande_refresh(db)

    # Refuse to push if the live API opened the wrong (main) database.
    health = call_method_direct("CheckHealth", [])
    if not health:
        counts["skipped"] = 1
        return counts
    ok, reason = assert_target_db_allowed(str(health.get("DBName") or health.get("dbname") or ""))
    if not ok:
        logger.error("[tahesab] DB guard blocked outbox drain: %s", reason)
        counts["skipped"] = 1
        return counts

    jobs = (
        db.query(TahesabOutbox)
        .filter(TahesabOutbox.status == "pending")
        .order_by(TahesabOutbox.created_at.asc())
        .limit(limit)
        .all()
    )
    for job in jobs:
        status = process_outbox_job(db, job)
        counts[status] = counts.get(status, 0) + 1
        # If unreachable, don't hammer the rest this tick.
        if status == "pending" and (job.last_error or "").startswith("unreachable"):
            break
    return counts


async def outbox_worker_loop() -> None:
    """Background: drain tahesab_outbox to the public Windows API."""
    from app.db import SessionLocal

    poll = max(5.0, float(getattr(settings, "TAHESAB_OUTBOX_POLL_SECONDS", 15) or 15))
    logger.info(
        "[tahesab] outbox worker started mode=%s base=%s ready=%s poll=%ss",
        settings.TAHESAB_MODE,
        settings.TAHESAB_BASE_URL or "(unset)",
        is_direct_target_ready(),
        poll,
    )
    while True:
        try:
            if is_configured() and not is_bridge_mode():
                db = SessionLocal()
                try:
                    stats = process_outbox_batch(db)
                    if stats.get("done") or stats.get("error"):
                        logger.info("[tahesab] outbox tick %s", stats)
                finally:
                    db.close()
        except Exception:
            logger.exception("[tahesab] outbox worker tick failed")
        await asyncio.sleep(poll)


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
        db.commit()
    except Exception:
        logger.exception("[tahesab] isolated user sync failed for %s", user_id)
        db.rollback()
    finally:
        db.close()


def sync_accepted_order_isolated(order_id: str) -> None:
    from app.db import SessionLocal
    from app.models_db import Order

    if not is_configured():
        logger.warning("[tahesab] skip order %s — not configured", order_id)
        return
    db = SessionLocal()
    try:
        order = db.query(Order).filter(Order.id == order_id).first()
        if not order:
            logger.warning("[tahesab] skip order %s — not found", order_id)
            return
        logger.info(
            "[tahesab] sync accepted order=%s status=%s factor=%s",
            order.id,
            getattr(order.status, "value", order.status),
            order.tahesab_factor_code,
        )
        sync_accepted_order_to_tahesab(db, order)
        db.commit()
    except Exception:
        logger.exception("[tahesab] isolated order sync failed for %s", order_id)
        db.rollback()
    finally:
        db.close()


def sync_unsynced_accepted_orders(db: Session, limit: int = 50) -> int:
    """Retry accepted orders flagged for Tahesab until Windows acks them.

    Uses `tahesab_sync_needed` (set in the same DB commit as accept) so
    jobs wait indefinitely while the shop PC / agent is offline, without
    replaying the shop's pre-integration history.
    """
    from app.models_db import Order, OrderStatusEnum

    if not is_configured():
        return 0
    orders = (
        db.query(Order)
        .filter(
            Order.tahesab_sync_needed.is_(True),
            Order.status == OrderStatusEnum.accepted,
            Order.tahesab_factor_code.is_(None),
            Order.user_id.isnot(None),
        )
        .order_by(Order.updated_at.asc())
        .limit(limit)
        .all()
    )
    n = 0
    for order in orders:
        try:
            sync_accepted_order_to_tahesab(db, order)
            n += 1
        except Exception:
            logger.exception("[tahesab] catch-up failed for order %s", order.id)
    if n:
        db.commit()
        logger.info("[tahesab] catch-up queued/synced %s accepted orders", n)
    return n


async def catchup_worker_loop() -> None:
    """Bridge + direct: retry accepted orders missing a Tahesab sanad."""
    from app.db import SessionLocal

    poll = 20.0
    logger.info("[tahesab] catch-up worker started poll=%ss", poll)
    while True:
        try:
            if is_configured():
                db = SessionLocal()
                try:
                    sync_unsynced_accepted_orders(db)
                finally:
                    db.close()
        except Exception:
            logger.exception("[tahesab] catch-up worker tick failed")
        await asyncio.sleep(poll)


def normalize_dbname(name: str | None) -> str:
    return (name or "").strip().lower()


def assert_target_db_allowed(health_dbname: str | None) -> tuple[bool, str]:
    """
    Guard: only write to the configured TEST database.
    Uses CheckHealth's DBName (what Tahesab actually opened).
    """
    got = normalize_dbname(health_dbname)
    if not got:
        return False, "CheckHealth returned empty DBName"

    if got in settings.TAHESAB_BLOCKED_DBNAMES_SET:
        return False, (
            f"DBName={health_dbname!r} is blocked (main/production). "
            f"Refusing to write. Use the TEST Tahesab API only."
        )

    allowed = settings.TAHESAB_ALLOWED_DBNAMES_SET
    if allowed and got not in allowed:
        return False, (
            f"DBName={health_dbname!r} is not in allow-list "
            f"{sorted(allowed)}. Refusing to write to protect main books."
        )

    # Header DBName should also look like a test target when allow-list is set.
    header = normalize_dbname(settings.TAHESAB_DBNAME)
    if allowed and header and header not in allowed:
        return False, (
            f"Configured GOLDAPP_TAHESAB_DBNAME={settings.TAHESAB_DBNAME!r} "
            f"is not in allow-list {sorted(allowed)}."
        )

    return True, f"OK target={settings.TAHESAB_TARGET_LABEL} db={health_dbname}"


def bridge_agent_config() -> dict[str, Any]:
    """Config the Windows agent needs (no bridge secret)."""
    return {
        "tahesab_base_url": settings.TAHESAB_BASE_URL or "https://127.0.0.1:8081",
        "tahesab_token": settings.TAHESAB_TOKEN,
        "tahesab_dbname": settings.TAHESAB_DBNAME,
        "tahesab_verify_ssl": settings.TAHESAB_VERIFY_SSL,
        "poll_seconds": 2,
        "target_label": settings.TAHESAB_TARGET_LABEL,
        "allowed_dbnames": sorted(settings.TAHESAB_ALLOWED_DBNAMES_SET),
        "blocked_dbnames": sorted(settings.TAHESAB_BLOCKED_DBNAMES_SET),
    }
