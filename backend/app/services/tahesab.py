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
# Docs: {"DoListAsnad":[Count_Last, Moshtari_Code, Az, Ta, FilterNoSanad, Mande_Jens_Felez]}
ASNAD_METHOD = "DoListAsnad"
MANDE_BATCH_SIZE = 80
AGENT_ONLINE_GAP_SECONDS = 30 * 60
ASNAD_STALE_SECONDS = 15 * 60
# Softer age when the customer opens the report (shop may add docs in Tahesab).
ASNAD_VIEW_STALE_SECONDS = 2 * 60
# Cancel bridge asnad jobs stuck pending/claimed so the UI cannot hang forever.
ASNAD_JOB_STALE_SECONDS = 3 * 60
MANDE_STALE_SECONDS = 5 * 60
SETTING_AGENT_LAST_SEEN = "tahesab_agent_last_seen"
SETTING_MANDE_REFRESH_DAY = "tahesab_mande_refresh_day"
SETTING_MANDE_HOLD_DAY = "tahesab_mande_hold_day"
SETTING_BOOKS_RESET_AT = "tahesab_books_reset_at"
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
    if row is None:
        return None
    value = getattr(row, "value", None)
    return value if isinstance(value, str) else None


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


def mande_refresh_is_held(db: Session) -> bool:
    return _get_app_setting(db, SETTING_MANDE_HOLD_DAY) == _tehran_today_iso()


def hold_mande_refresh_today(db: Session) -> None:
    """Legacy one-shot hold. Remaining now refreshes from Tahesab again."""
    today = _tehran_today_iso()
    _set_app_setting(db, SETTING_MANDE_HOLD_DAY, today)
    _set_app_setting(db, SETTING_MANDE_REFRESH_DAY, today)
    _set_app_setting(db, SETTING_AGENT_LAST_SEEN, datetime.utcnow().isoformat())


def clear_mande_hold(db: Session) -> None:
    """Allow مانده pulls after a remaining wipe."""
    _set_app_setting(db, SETTING_MANDE_HOLD_DAY, "")


def parse_setting_datetime(raw: str | None) -> datetime | None:
    if not raw or not str(raw).strip():
        return None
    text = str(raw).strip().replace("Z", "+00:00")
    try:
        value = datetime.fromisoformat(text)
    except ValueError:
        return None
    if value.tzinfo is not None:
        return value.replace(tzinfo=None)
    return value


def books_reset_at(db: Session) -> datetime | None:
    """UTC cutoff after the last remaining wipe. Customer PDF/history hide older rows."""
    return parse_setting_datetime(_get_app_setting(db, SETTING_BOOKS_RESET_AT))


def set_books_reset_at(db: Session, when: datetime | None = None) -> datetime:
    when = when or datetime.utcnow()
    if when.tzinfo is not None:
        when = when.replace(tzinfo=None)
    _set_app_setting(db, SETTING_BOOKS_RESET_AT, when.isoformat())
    return when


def filter_since_books_reset(db: Session, query, column):
    """Keep rows created strictly after the remaining wipe."""
    cutoff = books_reset_at(db)
    if cutoff is None:
        return query
    return query.filter(column > cutoff)


def _nullish(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, str) and value.strip().lower() in {"", "null", "none"}:
        return None
    return value


def _jalali_datetime_to_utc(text: Any) -> datetime | None:
    raw = _nullish(text)
    if raw is None:
        return None
    s = str(raw).translate(_PERSIAN_DIGITS).strip().replace("-", "/")
    for fmt in ("%Y/%m/%d %H:%M:%S", "%Y/%m/%d %H:%M", "%Y/%m/%d"):
        try:
            jdt = jdatetime.datetime.strptime(s, fmt)
            return jdt.togregorian()
        except ValueError:
            continue
    return None


def _shamsi_day_str(dt: datetime) -> str:
    """Shamsi YYYY-MM-DD for a datetime interpreted in Asia/Tehran."""
    if dt.tzinfo is None:
        # App stores naive UTC for books_reset_at / created_at.
        aware = dt.replace(tzinfo=ZoneInfo("UTC")).astimezone(TEHRAN_TZ)
    else:
        aware = dt.astimezone(TEHRAN_TZ)
    j = jdatetime.date.fromgregorian(date=aware.date())
    return f"{j.year:04d}-{j.month:02d}-{j.day:02d}"


def parse_asnad_rows(payload: Any) -> list[dict[str, Any]]:
    """Normalize DoListAsnad JSON into sorted ledger rows for the customer PDF."""
    # Agent / Tahesab may deliver [{id: row, ...}] instead of a bare object.
    if isinstance(payload, list):
        merged: dict[str, Any] = {}
        for item in payload:
            if isinstance(item, dict):
                merged.update(item)
        payload = merged
    if not payload or not isinstance(payload, dict):
        return []
    if _error_text(payload):
        return []

    rows: list[dict[str, Any]] = []
    for key, raw in payload.items():
        if str(key).lower() in {"ok", "error", "api_status", "dbname", "dbtype"}:
            continue
        if not isinstance(raw, dict):
            continue
        no = _nullish(raw.get("NO") or raw.get("No") or raw.get("no"))
        if no is None:
            continue
        zaman = _nullish(raw.get("ZamanSabt") or raw.get("Zaman_Sabt"))
        created = _jalali_datetime_to_utc(zaman) or _jalali_datetime_to_utc(
            f"{raw.get('Tarikh') or ''} {raw.get('Tarikh_Time') or ''}".strip()
        )
        mali_raw = _nullish(raw.get("Mali"))
        mazaneh_raw = _nullish(raw.get("Mazaneh"))
        vazn_raw = _nullish(raw.get("Vazn"))
        tabdil_raw = _nullish(raw.get("TabdilVazn"))
        ayar_raw = _nullish(raw.get("Ayar"))
        gold_bal = _to_float(raw.get("TahesabVazni"))
        cash_bal = _unscale_amount(_to_float(raw.get("TahesabMali")))
        money = _unscale_amount(_to_float(mali_raw)) if mali_raw is not None else 0.0
        weight = _to_float(vazn_raw) if vazn_raw is not None else 0.0
        tabdil = _to_float(tabdil_raw) if tabdil_raw is not None else 0.0
        factor = _nullish(raw.get("Factor_Code")) or str(raw.get("ID") or key)
        sharh = _nullish(raw.get("Sharh1"))
        lab = _nullish(raw.get("Name_az") or raw.get("Name_Az"))
        ang = _nullish(raw.get("Sh_Sharti") or raw.get("ShSharti"))
        is_abshode = bool(raw.get("IsAbshode") or raw.get("IsAbshodeh"))
        api_user = str(_nullish(raw.get("User")) or "")
        # Keep full Sharh1 (app writes detailed شرح; shop-entered docs keep theirs).
        explanation = str(sharh).strip() if sharh else ""
        if api_user.upper() == "API" and not explanation:
            explanation = "اپ"
        mazaneh_val = (
            _unscale_amount(_to_float(mazaneh_raw)) if mazaneh_raw is not None else None
        )
        rows.append(
            {
                "id": str(raw.get("ID") or key),
                "factor_code": str(factor),
                "created_at": created.isoformat() + "Z" if created else None,
                "zaman_sabt": str(zaman) if zaman else None,
                "doc_type": str(no),
                "explanation": explanation,
                "weight": weight,
                "tabdil_vazn": tabdil,
                "ayar": _to_float(ayar_raw) if ayar_raw is not None else None,
                "lab_name": str(lab) if lab else "",
                "ang": str(ang) if ang else "",
                "is_abshode": is_abshode,
                "mazaneh": mazaneh_val,
                "money": money,
                "gold_balance": gold_bal,
                "cash_balance": cash_bal,
                "user": _nullish(raw.get("User")),
                "sh_factor": raw.get("Sh_Factor"),
            }
        )

    def sort_key(row: dict[str, Any]) -> tuple:
        created = row.get("created_at") or ""
        try:
            sid = int(str(row.get("id") or "0"))
        except ValueError:
            sid = 0
        return (created, sid)

    rows.sort(key=sort_key)
    return rows


def apply_asnad_payload(db: Session, user, payload: Any) -> int:
    """Cache normalized DoListAsnad rows on the user for PDF/report."""
    rows = parse_asnad_rows(payload)
    user.tahesab_asnad_json = json.dumps(rows, ensure_ascii=False)
    user.tahesab_asnad_at = datetime.utcnow()
    db.add(user)
    if rows:
        last = rows[-1]
        # Keep header remaining aligned with the last ledger line when present.
        user.tahesab_gold_balance = float(last.get("gold_balance") or 0.0)
        user.tahesab_cash_balance = float(last.get("cash_balance") or 0.0)
        user.tahesab_balance_at = user.tahesab_asnad_at
        db.add(user)
    logger.info(
        "[tahesab] asnad user=%s moshtari=%s rows=%s",
        getattr(user, "user_code", "?"),
        getattr(user, "tahesab_moshtari_id", None),
        len(rows),
    )
    return len(rows)


def get_cached_asnad_rows(user) -> list[dict[str, Any]]:
    raw = getattr(user, "tahesab_asnad_json", None)
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return []
    return data if isinstance(data, list) else []


def asnad_job_pending(db: Session, user) -> bool:
    """True when a DoListAsnad pull is already queued/in-flight for this user."""
    from app.models_db import TahesabOutbox

    uid = getattr(user, "id", None)
    if not uid:
        return False
    return (
        db.query(TahesabOutbox.id)
        .filter(
            TahesabOutbox.method == ASNAD_METHOD,
            TahesabOutbox.ref_type == "asnad",
            TahesabOutbox.ref_id == str(uid),
            TahesabOutbox.status.in_(("pending", "claimed")),
        )
        .first()
        is not None
    )


def release_stale_asnad_jobs(
    db: Session, *, user=None, max_age: int = ASNAD_JOB_STALE_SECONDS
) -> int:
    """Cancel DoListAsnad jobs stuck pending/claimed so pulls can resume."""
    from app.models_db import TahesabOutbox

    cutoff = datetime.utcnow() - timedelta(seconds=max_age)
    q = db.query(TahesabOutbox).filter(
        TahesabOutbox.method == ASNAD_METHOD,
        TahesabOutbox.status.in_(("pending", "claimed")),
        TahesabOutbox.updated_at < cutoff,
    )
    if user is not None and getattr(user, "id", None):
        q = q.filter(
            TahesabOutbox.ref_type == "asnad",
            TahesabOutbox.ref_id == str(user.id),
        )
    n = 0
    now = datetime.utcnow()
    for job in q.all():
        job.status = "cancelled"
        job.last_error = (job.last_error or "")[:180] + " | stale-asnad-timeout"
        job.updated_at = now
        db.add(job)
        n += 1
    return n


def request_asnad_refresh(
    db: Session,
    user,
    *,
    force: bool = False,
    max_age: int | None = None,
) -> bool:
    """Queue DoListAsnad for this user (full جزئیات اسناد, running مانده).

    Returns True when a pull is in flight (newly queued or already pending).
    Soft mode (force=False) skips enqueue when cache is fresh and non-empty.
    force=True is for post-sanad / internal paths only — not the customer API.
    """
    if not is_configured():
        return False
    moshtari = getattr(user, "tahesab_moshtari_id", None)
    if moshtari is None:
        return False

    release_stale_asnad_jobs(db, user=user)

    # One in-flight ledger pull per user — never pile up DoListAsnad.
    if asnad_job_pending(db, user):
        return True

    rows = get_cached_asnad_rows(user)
    stale_after = ASNAD_STALE_SECONDS if max_age is None else max_age
    if not force:
        at = getattr(user, "tahesab_asnad_at", None)
        if at is not None and rows:
            age = (datetime.utcnow() - at).total_seconds()
            if age < stale_after:
                return False

    # Full جزئیات اسناد for this customer — do not date-filter rows.
    # Wide window avoids empty Az/Ta hangs with Count_Last=-1 on some agents.
    az = "1400-01-01"
    ta = _shamsi_day_str(datetime.now(TEHRAN_TZ) + timedelta(days=400))
    # Count_Last=-1 builds TahesabVazni/TahesabMali per row; metal 0 = طلا.
    params = [-1, int(moshtari), az, ta, "", 0]
    enqueue_method(
        db,
        ASNAD_METHOD,
        params,
        ref_type="asnad",
        ref_id=str(user.id),
    )
    return True


def user_ledger_payload(db: Session, user) -> dict[str, Any]:
    """API shape for customer PDF: Tahesab docs + running balances."""
    rows = get_cached_asnad_rows(user)
    gold = float(getattr(user, "tahesab_gold_balance", None) or 0.0)
    cash = float(getattr(user, "tahesab_cash_balance", None) or 0.0)
    if rows:
        gold = float(rows[-1].get("gold_balance") or gold)
        cash = float(rows[-1].get("cash_balance") or cash)
    return {
        "docs": rows,
        "gold_balance": gold,
        "cash_balance": cash,
        "updated_at": getattr(user, "tahesab_asnad_at", None),
        "pending_refresh": False,
    }


def cancel_pending_mande_jobs(db: Session) -> int:
    """Drop queued getmandehesabbycode jobs so they cannot restore old مانده."""
    from app.models_db import TahesabOutbox

    now = datetime.utcnow()
    jobs = (
        db.query(TahesabOutbox)
        .filter(
            TahesabOutbox.status.in_(("pending", "claimed")),
            TahesabOutbox.method == MANDE_METHOD,
        )
        .all()
    )
    extra = (
        db.query(TahesabOutbox)
        .filter(
            TahesabOutbox.status.in_(("pending", "claimed")),
            TahesabOutbox.ref_type.in_(("mande", "mande-day")),
        )
        .all()
    )
    seen: set[str] = set()
    n = 0
    for job in list(jobs) + list(extra):
        jid = getattr(job, "id", None)
        if jid in seen:
            continue
        if jid:
            seen.add(jid)
        job.status = "cancelled"
        job.last_error = "cancelled: remaining reset"
        job.updated_at = now
        db.add(job)
        n += 1
    if n:
        logger.info("[tahesab] cancelled %s pending mande jobs", n)
    return n


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


def request_mande_refresh(db: Session, user, *, force: bool = False) -> str | None:
    """Queue a Tahesab مانده pull for this app user.

    force=True: user opened the app or tapped refresh.
    force=False: only if the last pull is older than 5 minutes.
    """
    if not is_configured():
        return None
    if getattr(user, "tahesab_moshtari_id", None) is None:
        return None
    if not force:
        at = getattr(user, "tahesab_balance_at", None)
        if at is not None:
            try:
                age = (datetime.utcnow() - at).total_seconds()
            except TypeError:
                age = MANDE_STALE_SECONDS
            if age < MANDE_STALE_SECONDS:
                return None
    return enqueue_mande_for_user(db, user)


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


def _order_sharh(order, user) -> str:
    """Full شرح written into Tahesab for accepted app orders."""
    from app.services.price_cards import is_motaferaghe_card, is_naghd_kartkhan_card

    side_fa = "خرید" if getattr(order.side, "value", order.side) == "buy" else "فروش"
    is_coin = getattr(order.amount_type, "value", order.amount_type) == "count"
    code = getattr(user, "user_code", None) or ""
    oid = str(getattr(order, "id", "") or "")[:8]
    item_id = getattr(order, "goldbridge_item_id", None)

    if is_naghd_kartkhan_card(item_id):
        return f"اپ نقد کارتخوان {side_fa} طلا کد مشتری {code} سفارش {oid}".strip()
    if is_motaferaghe_card(item_id):
        return f"اپ خرید متفرقه(بدون تسویه) عیار 740 کد مشتری {code} سفارش {oid}".strip()
    kind = "سکه" if is_coin else "طلا"
    return f"اپ {side_fa} {kind} کد مشتری {code} سفارش {oid}".strip()


def _hedge_sharh(hedge, dealer, *, order=None, user=None) -> str:
    """Full شرح for پوشش تهران sanads on آبشده‌فروش cards."""
    from app.models_db import ExpertHedgeSideEnum

    side = hedge.side
    side_val = side.value if hasattr(side, "value") else str(side)
    dealer_name = (getattr(dealer, "name", None) or "تهران").strip()
    if side_val == ExpertHedgeSideEnum.buy_from_dealer.value:
        action = f"خرید از {dealer_name}"
    else:
        action = f"فروش به {dealer_name}"
    try:
        w = float(hedge.weight_gram18 or 0)
        w_txt = f"{w:g}"
    except (TypeError, ValueError):
        w_txt = str(hedge.weight_gram18 or "")
    parts = [f"پوشش تهران {action} {w_txt} گرم"]
    if order is not None:
        oid = str(getattr(order, "id", "") or "")[:8]
        code = getattr(user, "user_code", None) if user is not None else None
        if code:
            parts.append(f"کد مشتری {code} سفارش {oid}")
        elif oid:
            parts.append(f"سفارش {oid}")
    try:
        price = float(hedge.price_mesghal17 or 0)
    except (TypeError, ValueError):
        price = 0.0
    if price > 0:
        parts.append(f"فی {int(round(price))}")
    return " ".join(parts).strip()


def _factor_code_for_hedge(hedge_id: str) -> str:
    compact = (hedge_id or "").replace("-", "")
    code = f"GH{compact}"
    if len(code) < 20:
        code = code.ljust(20, "0")
    return code[:40]


def parse_gorooh_rows(payload: Any) -> list[dict[str, Any]]:
    """Normalize DoListGorooh into [{gid, name}, ...]."""
    rows: list[Any] = []
    if isinstance(payload, list):
        rows = payload
    elif isinstance(payload, dict):
        if _error_text(payload):
            return []
        for key, val in payload.items():
            if str(key).lower() in {"ok", "error", "api_status", "dbname", "dbtype"}:
                continue
            if isinstance(val, list):
                rows.extend(val)
            elif isinstance(val, dict) and ("GID" in val or "Name" in val):
                rows.append(val)
    out: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        gid_raw = row.get("GID", row.get("gid"))
        name = str(row.get("Name") or row.get("name") or "").strip()
        if gid_raw is None or not name:
            continue
        try:
            gid = int(str(gid_raw).translate(_PERSIAN_DIGITS).strip())
        except (TypeError, ValueError):
            continue
        out.append({"gid": gid, "name": name})
    return out


def parse_moshtari_detail_rows(payload: Any) -> list[dict[str, Any]]:
    """Normalize DoListMoshtari into detail dicts (Code/Name/GID/Tel)."""
    if not payload:
        return []
    rows: list[Any] = []
    if isinstance(payload, list):
        rows = payload
    elif isinstance(payload, dict):
        if _error_text(payload):
            return []
        for key, val in payload.items():
            if str(key).lower() in {"ok", "error", "api_status", "dbname", "dbtype"}:
                continue
            if isinstance(val, list):
                rows.extend(val)
            elif isinstance(val, dict):
                rows.append(val)
    out: list[dict[str, Any]] = []
    seen: set[int] = set()
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
        if code in seen:
            continue
        seen.add(code)
        gid_raw = row.get("GID", row.get("gid"))
        gid = None
        if gid_raw is not None and str(gid_raw).strip().lower() not in {"", "null", "none"}:
            try:
                gid = int(str(gid_raw).translate(_PERSIAN_DIGITS).strip())
            except (TypeError, ValueError):
                gid = None
        group_name = str(
            row.get("GoroupName")
            or row.get("GroupName")
            or row.get("GoroohName")
            or row.get("group_name")
            or ""
        ).strip()
        out.append(
            {
                "code": code,
                "name": str(row.get("Name") or row.get("name") or "").strip(),
                "gid": gid,
                "group_name": group_name,
                "tel": str(row.get("Tel") or row.get("tel") or "").strip(),
            }
        )
    return out


ABSHODE_SELLERS_REF = "abshode-sellers"


def _group_name_matches(row_group: str, target: str) -> bool:
    if not target:
        return False
    g = (row_group or "").strip()
    if not g:
        return False
    if g == target:
        return True
    return target in g or g in target or g.replace(" ", "") == target.replace(" ", "")


def list_gorooh_direct() -> list[dict[str, Any]]:
    """DoListGorooh — live read (direct mode only)."""
    if not is_configured() or is_bridge_mode():
        return []
    data = call_method_direct("DoListGorooh", [])
    return parse_gorooh_rows(data)


def find_gorooh_gid(group_name: str | None = None) -> int | None:
    target = (group_name or settings.TAHESAB_ABSHODE_SELLERS_GROUP or "").strip()
    if not target:
        return None
    groups = list_gorooh_direct()
    for g in groups:
        if g["name"] == target:
            return int(g["gid"])
    compact = target.replace(" ", "")
    for g in groups:
        if g["name"].replace(" ", "") == compact or target in g["name"] or g["name"] in target:
            return int(g["gid"])
    return None


def sellers_from_moshtari_payload(
    payload: Any,
    *,
    group_name: str | None = None,
    gid: int | None = None,
) -> list[dict[str, Any]]:
    """Filter a DoListMoshtari payload down to آبشده فروشان members."""
    target = (group_name or settings.TAHESAB_ABSHODE_SELLERS_GROUP or "").strip()
    by_code: dict[int, dict[str, Any]] = {}
    for row in parse_moshtari_detail_rows(payload):
        match_gid = gid is not None and row.get("gid") == gid
        match_name = _group_name_matches(row.get("group_name") or "", target)
        if not (match_gid or match_name):
            continue
        by_code[row["code"]] = {
            "code": row["code"],
            "name": row.get("name") or f"کد {row['code']}",
            "gid": row.get("gid") if row.get("gid") is not None else gid,
            "group_name": row.get("group_name") or target,
            "tel": row.get("tel") or "",
        }
    return sorted(by_code.values(), key=lambda r: (r.get("name") or "", r["code"]))


def list_moshtari_in_group(group_name: str | None = None) -> list[dict[str, Any]]:
    """Members of a Tahesab group (default: آبشده فروشان) — direct mode.

    Bridge mode cannot call Tahesab from the VPS; use
    request_abshode_sellers_refresh() + apply_abshode_sellers_payload() instead.
    """
    if not is_configured() or is_bridge_mode():
        return []
    target = (group_name or settings.TAHESAB_ABSHODE_SELLERS_GROUP or "").strip()
    gid = find_gorooh_gid(target)
    by_code: dict[int, dict[str, Any]] = {}

    if gid is not None:
        mande = call_method_direct("GetMandeHesabByGID", [str(gid)])
        if isinstance(mande, dict) and not _error_text(mande):
            rows = mande.get("MandeHesab") or mande.get("mandehesab") or []
            if isinstance(rows, list):
                for row in rows:
                    if not isinstance(row, dict):
                        continue
                    code_raw = row.get("Code", row.get("code"))
                    try:
                        code = int(str(code_raw).translate(_PERSIAN_DIGITS).strip())
                    except (TypeError, ValueError):
                        continue
                    by_code[code] = {
                        "code": code,
                        "name": "",
                        "gid": gid,
                        "group_name": target,
                        "tel": "",
                    }

    listed = call_method_direct("DoListMoshtari", [1, 50000])
    for row in sellers_from_moshtari_payload(listed, group_name=target, gid=gid):
        prev = by_code.get(row["code"], {})
        by_code[row["code"]] = {
            "code": row["code"],
            "name": row.get("name") or prev.get("name") or f"کد {row['code']}",
            "gid": row.get("gid") if row.get("gid") is not None else gid,
            "group_name": row.get("group_name") or target,
            "tel": row.get("tel") or prev.get("tel") or "",
        }

    for code, row in list(by_code.items()):
        if row.get("name"):
            continue
        detail = call_method_direct("DoListMoshtari", [code])
        parsed = parse_moshtari_detail_rows(detail)
        if parsed:
            row["name"] = parsed[0].get("name") or f"کد {code}"
            row["tel"] = parsed[0].get("tel") or ""
        else:
            row["name"] = f"کد {code}"

    return sorted(by_code.values(), key=lambda r: (r.get("name") or "", r["code"]))


def _abshode_sellers_job_pending(db: Session) -> bool:
    from app.models_db import TahesabOutbox

    return (
        db.query(TahesabOutbox)
        .filter(
            TahesabOutbox.ref_type == ABSHODE_SELLERS_REF,
            TahesabOutbox.status.in_(("pending", "claimed")),
        )
        .first()
        is not None
    )


def request_abshode_sellers_refresh(db: Session, *, force: bool = False) -> dict[str, Any]:
    """Queue DoListMoshtari for bridge mode (Windows agent pulls & acks)."""
    if not is_configured():
        return {"ok": False, "reason": "tahesab_disabled", "pending_refresh": False}
    if _abshode_sellers_job_pending(db) and not force:
        return {
            "ok": True,
            "reason": "already_queued",
            "pending_refresh": True,
            "group": settings.TAHESAB_ABSHODE_SELLERS_GROUP,
        }
    # Wide list; apply_abshode_sellers_payload filters by group name.
    oid = enqueue_method(
        db,
        "DoListMoshtari",
        [1, 50000],
        ref_type=ABSHODE_SELLERS_REF,
        ref_id="sync",
    )
    # enqueue_method only flushes — commit so the agent /next can see the job.
    if oid:
        db.commit()
    return {
        "ok": bool(oid),
        "reason": "queued" if oid else "enqueue_failed",
        "pending_refresh": bool(oid),
        "outbox_id": oid,
        "group": settings.TAHESAB_ABSHODE_SELLERS_GROUP,
    }


def upsert_abshode_sellers(db: Session, sellers: list[dict[str, Any]]) -> dict[str, Any]:
    """Write parsed sellers into tehran_dealers."""
    from app.models_db import TehranDealer

    now = datetime.utcnow()
    seen_codes: set[int] = set()
    created = updated = 0

    for s in sellers:
        code = int(s["code"])
        seen_codes.add(code)
        name = (s.get("name") or f"کد {code}").strip()
        tel = (s.get("tel") or "").strip() or None
        row = (
            db.query(TehranDealer)
            .filter(TehranDealer.tahesab_moshtari_id == code)
            .first()
        )
        if not row:
            row = db.query(TehranDealer).filter(TehranDealer.name == name).first()
        if row:
            row.name = name
            if tel:
                row.phone = tel
            row.tahesab_moshtari_id = code
            row.is_active = True
            row.tahesab_synced_at = now
            db.add(row)
            updated += 1
        else:
            clash = db.query(TehranDealer).filter(TehranDealer.name == name).first()
            if clash and clash.tahesab_moshtari_id not in (None, code):
                name = f"{name} ({code})"
            db.add(
                TehranDealer(
                    name=name,
                    phone=tel,
                    notes=f"گروه {settings.TAHESAB_ABSHODE_SELLERS_GROUP}",
                    is_active=True,
                    tahesab_moshtari_id=code,
                    tahesab_synced_at=now,
                )
            )
            created += 1

    deactivated = 0
    if seen_codes:
        linked = (
            db.query(TehranDealer)
            .filter(TehranDealer.tahesab_moshtari_id.isnot(None))
            .all()
        )
        for row in linked:
            if int(row.tahesab_moshtari_id) not in seen_codes:
                if row.is_active:
                    row.is_active = False
                    deactivated += 1
                row.tahesab_synced_at = now
                db.add(row)

    # Manual app-only dealers are not allowed — Tahesab group is the sole source.
    manual_off = deactivate_manual_abshode_sellers(db, commit=False)
    deactivated += manual_off

    db.commit()
    logger.info(
        "[tahesab] upserted آبشده فروشان: created=%s updated=%s deactivated=%s total=%s",
        created,
        updated,
        deactivated,
        len(seen_codes),
    )
    return {
        "ok": True,
        "reason": "synced",
        "created": created,
        "updated": updated,
        "deactivated": deactivated,
        "total": len(seen_codes),
        "group": settings.TAHESAB_ABSHODE_SELLERS_GROUP,
    }


def deactivate_manual_abshode_sellers(db: Session, *, commit: bool = True) -> int:
    """Turn off dealers that were added in the app (no Tahesab moshtari code)."""
    from app.models_db import TehranDealer

    rows = (
        db.query(TehranDealer)
        .filter(TehranDealer.tahesab_moshtari_id.is_(None), TehranDealer.is_active == True)  # noqa: E712
        .all()
    )
    for row in rows:
        row.is_active = False
        db.add(row)
    if commit and rows:
        db.commit()
    if rows:
        logger.info("[tahesab] deactivated %s manual آبشده‌فروش (no tahesab code)", len(rows))
    return len(rows)


def apply_abshode_sellers_payload(db: Session, payload: Any) -> dict[str, Any]:
    """Apply a bridged DoListMoshtari ack into tehran_dealers."""
    sellers = sellers_from_moshtari_payload(payload)
    if not sellers:
        logger.warning(
            "[tahesab] abshode-sellers ack had 0 rows matching %r",
            settings.TAHESAB_ABSHODE_SELLERS_GROUP,
        )
        return {
            "ok": False,
            "reason": "no_members",
            "created": 0,
            "updated": 0,
            "deactivated": 0,
            "total": 0,
            "group": settings.TAHESAB_ABSHODE_SELLERS_GROUP,
        }
    return upsert_abshode_sellers(db, sellers)


# Soft-refresh backoff when Tahesab is unreachable (avoid hammering every desk poll).
_abshode_sellers_last_attempt: datetime | None = None
_ABSHODE_SELLERS_FAIL_BACKOFF = 120.0


def sync_abshode_sellers_from_tahesab(db: Session, *, force: bool = False) -> dict[str, Any]:
    """Upsert tehran_dealers from Tahesab group آبشده فروشان.

    Direct mode: call Tahesab API from the VPS.
    Bridge mode: queue DoListMoshtari for the Windows agent; result applied on ack.
    """
    global _abshode_sellers_last_attempt
    from app.models_db import TehranDealer

    if not is_configured():
        return {"ok": False, "reason": "tahesab_disabled", "created": 0, "updated": 0, "deactivated": 0}

    stale = float(settings.TAHESAB_ABSHODE_SELLERS_STALE_SECONDS or 900)
    now = datetime.utcnow()
    if not force:
        latest = (
            db.query(TehranDealer.tahesab_synced_at)
            .filter(TehranDealer.tahesab_moshtari_id.isnot(None))
            .order_by(TehranDealer.tahesab_synced_at.desc())
            .first()
        )
        at = latest[0] if latest else None
        if at is not None:
            age = (now - at).total_seconds()
            if age < stale:
                return {
                    "ok": True,
                    "reason": "fresh",
                    "created": 0,
                    "updated": 0,
                    "deactivated": 0,
                    "age_seconds": age,
                }
        if _abshode_sellers_last_attempt is not None:
            since_attempt = (now - _abshode_sellers_last_attempt).total_seconds()
            if since_attempt < _ABSHODE_SELLERS_FAIL_BACKOFF:
                return {
                    "ok": False,
                    "reason": "backoff",
                    "created": 0,
                    "updated": 0,
                    "deactivated": 0,
                    "age_seconds": since_attempt,
                }

    _abshode_sellers_last_attempt = now

    # Bridge: VPS cannot reach Tahesab loopback — queue for Windows agent.
    if is_bridge_mode():
        queued = request_abshode_sellers_refresh(db, force=force)
        return {
            "ok": bool(queued.get("ok")),
            "reason": queued.get("reason") or "queued",
            "pending_refresh": bool(queued.get("pending_refresh")),
            "created": 0,
            "updated": 0,
            "deactivated": 0,
            "group": settings.TAHESAB_ABSHODE_SELLERS_GROUP,
            "outbox_id": queued.get("outbox_id"),
        }

    try:
        sellers = list_moshtari_in_group()
    except Exception:
        logger.exception("[tahesab] list_moshtari_in_group failed")
        return {"ok": False, "reason": "unreachable", "created": 0, "updated": 0, "deactivated": 0}

    if not sellers:
        gid = find_gorooh_gid()
        if gid is None:
            logger.warning(
                "[tahesab] group %r not found — keep existing dealers",
                settings.TAHESAB_ABSHODE_SELLERS_GROUP,
            )
            return {
                "ok": False,
                "reason": "group_not_found",
                "created": 0,
                "updated": 0,
                "deactivated": 0,
                "group": settings.TAHESAB_ABSHODE_SELLERS_GROUP,
            }
        return {
            "ok": False,
            "reason": "no_members",
            "created": 0,
            "updated": 0,
            "deactivated": 0,
            "group": settings.TAHESAB_ABSHODE_SELLERS_GROUP,
            "gid": gid,
        }

    result = upsert_abshode_sellers(db, sellers)
    result["gid"] = find_gorooh_gid()
    return result


def sync_hedge_to_tahesab(db: Session, hedge) -> str | None:
    """Queue DoNewSanadBuySaleGOLD on the Tehran dealer's moshtari card.

    buy_from_dealer → shop buys FROM dealer (buy_or_sale=0)
    sell_to_dealer  → shop sells TO dealer (buy_or_sale=1)
    """
    from app.gold_conversion import mesghal17_to_gram18
    from app.models_db import ExpertHedgeSideEnum, TehranDealer

    if not is_configured():
        return None
    if getattr(hedge, "tahesab_factor_code", None):
        return str(hedge.tahesab_factor_code)

    dealer = getattr(hedge, "dealer", None)
    if dealer is None and getattr(hedge, "dealer_id", None):
        dealer = db.query(TehranDealer).filter(TehranDealer.id == hedge.dealer_id).first()
    if not dealer:
        logger.error("[tahesab] hedge %s has no dealer", getattr(hedge, "id", "?"))
        return None

    moshtari = getattr(dealer, "tahesab_moshtari_id", None)
    if moshtari is None:
        # Best-effort: refresh group and retry by name.
        try:
            sync_abshode_sellers_from_tahesab(db, force=True)
            db.refresh(dealer)
            moshtari = getattr(dealer, "tahesab_moshtari_id", None)
        except Exception:
            logger.exception("[tahesab] dealer refresh failed for hedge %s", hedge.id)
    if moshtari is None:
        logger.warning(
            "[tahesab] dealer %s has no tahesab_moshtari_id — skip hedge sanad",
            dealer.name,
        )
        hedge.tahesab_sync_needed = True
        db.add(hedge)
        db.commit()
        return None

    side = hedge.side
    side_val = side.value if hasattr(side, "value") else str(side)
    # Shop-centric: 0 = buy from counterparty, 1 = sell to counterparty.
    buy_or_sale = 0 if side_val == ExpertHedgeSideEnum.buy_from_dealer.value else 1

    when = getattr(hedge, "created_at", None) or datetime.utcnow()
    j = _to_jalali(when)
    vazn = float(hedge.weight_gram18 or 0)
    if vazn <= 0:
        return None
    mazaneh_mesghal = float(hedge.price_mesghal17 or 0)
    if mazaneh_mesghal <= 0:
        logger.warning("[tahesab] hedge %s missing price — skip sanad", hedge.id)
        return None
    gram_price = mesghal17_to_gram18(mazaneh_mesghal)
    mablagh = _scale_amount(vazn * gram_price)
    mazaneh = _scale_amount(mazaneh_mesghal)
    factor_code = _factor_code_for_hedge(str(hedge.id))
    related_order = getattr(hedge, "order", None)
    related_user = None
    if related_order is None and getattr(hedge, "related_order_id", None):
        from app.models_db import Order

        related_order = db.query(Order).filter(Order.id == hedge.related_order_id).first()
    if related_order is not None and getattr(related_order, "user_id", None):
        from app.models_db import User

        related_user = (
            getattr(related_order, "user", None)
            or db.query(User).filter(User.id == related_order.user_id).first()
        )
    sharh = _hedge_sharh(hedge, dealer, order=related_order, user=related_user)

    ok = create_sanad_buy_sale_gold(
        moshtari_code=int(moshtari),
        shamsi_year=j.year,
        shamsi_month=j.month,
        shamsi_day=j.day,
        vazn=vazn,
        ayar=750.0,
        buy_or_sale=buy_or_sale,
        mazaneh=mazaneh,
        mazaneh_is_gram=0,
        is_abshode=int(settings.TAHESAB_IS_ABSHODE),
        mablagh_kol=mablagh,
        sharh=sharh,
        factor_code=factor_code,
        zaman_tasvie="",
        db=db,
        ref_id=str(hedge.id),
        ref_type="hedge",
    )
    if not ok:
        hedge.tahesab_sync_needed = True
        db.add(hedge)
        db.commit()
        return None

    hedge.tahesab_sync_needed = True  # cleared on outbox ack
    # Remember the Factor_Code we sent so delete can void even before ack lands.
    if not getattr(hedge, "tahesab_factor_code", None):
        hedge.tahesab_factor_code = str(ok)
    db.add(hedge)
    db.commit()
    logger.info(
        "[tahesab] queued hedge sanad hedge=%s dealer=%s moshtari=%s vazn=%s side=%s factor=%s",
        hedge.id,
        dealer.name,
        moshtari,
        vazn,
        side_val,
        ok,
    )
    return str(ok)


def cancel_pending_hedge_create_jobs(db: Session, hedge_id: str) -> int:
    """Drop unsent DoNewSanadBuySaleGOLD jobs for this hedge so a delete can't race a create."""
    from app.models_db import TahesabOutbox

    rows = (
        db.query(TahesabOutbox)
        .filter(
            TahesabOutbox.ref_type == "hedge",
            TahesabOutbox.ref_id == str(hedge_id),
            TahesabOutbox.method == "DoNewSanadBuySaleGOLD",
            TahesabOutbox.status.in_(("pending", "claimed")),
        )
        .all()
    )
    for row in rows:
        row.status = "cancelled"
        row.last_error = "hedge deleted in app"
        row.updated_at = datetime.utcnow()
        db.add(row)
    if rows:
        db.flush()
        logger.info("[tahesab] cancelled %s pending hedge create job(s) for %s", len(rows), hedge_id)
    return len(rows)


def delete_sanad(
    db: Session,
    factor_code: str,
    *,
    ref_id: str | None = None,
) -> str | None:
    """Queue DoDeleteSanad for a previously posted Factor_Code."""
    code = (factor_code or "").strip()
    if not code:
        return None
    if not is_configured():
        return None
    payload = call_method(
        "DoDeleteSanad",
        [code],
        db=db,
        ref_type="hedge-delete",
        ref_id=ref_id,
    )
    if not payload:
        return None
    if payload.get("queued"):
        return code
    deleted = payload.get("DELETED") or payload.get("OK")
    return str(deleted) if deleted is not None else code


def void_hedge_in_tahesab(db: Session, hedge) -> dict[str, Any]:
    """Cancel unsent create jobs and queue DoDeleteSanad for the dealer factor.

    Always attempts delete when a Factor_Code is known — covers acked sanads and
    in-flight creates the agent may already have posted. Missing-sanad errors on
    delete are treated as success in apply_bridge_result.
    """
    hid = str(getattr(hedge, "id", "") or "")
    cancelled = cancel_pending_hedge_create_jobs(db, hid) if hid else 0
    factor = (getattr(hedge, "tahesab_factor_code", None) or "").strip()
    deleted = delete_sanad(db, factor, ref_id=hid or None) if factor else None
    logger.info(
        "[tahesab] void hedge %s cancelled=%s factor=%s delete_queued=%s",
        hid,
        cancelled,
        factor or "-",
        bool(deleted),
    )
    return {
        "cancelled_jobs": cancelled,
        "factor_code": factor or None,
        "delete_queued": bool(deleted),
    }


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
    ref_type: str | None = None,
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
    resolved_ref = ref_type or ("order" if ref_id else None)
    payload = call_method(
        "DoNewSanadBuySaleGOLD",
        params,
        db=db,
        ref_type=resolved_ref,
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


def _link_user_to_moshtari(db: Session, user, code: int, *, reason: str) -> int:
    """Bind an app user to an existing Tahesab moshtari. Never creates an app user."""
    user.tahesab_moshtari_id = int(code)
    db.add(user)
    db.flush()
    _queue_pending_order_sanads(db, user)
    enqueue_mande_for_user(db, user)
    logger.info(
        "[tahesab] linked user %s → existing moshtari %s (%s)",
        user.user_code,
        code,
        reason,
    )
    return int(code)


def sync_user_to_tahesab(db: Session, user) -> int | None:
    """Ensure this app user exists as a Tahesab moshtari.

    Direction is app → Tahesab only. Tahesab-only customers are never
    imported. If the person already has a card (any group, even created
    by hand), link that Code instead of DoNewMoshtari.
    """
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

    # Direct mode can look up now. Bridge mode queues DoNewMoshtari and
    # links on duplicate via resolve_duplicate_moshtari / the Windows agent.
    if not is_bridge_mode():
        linked = lookup_existing_moshtari(
            tel=user.phone_number,
            preferred_code=preferred_code if preferred_code != -1 else None,
        )
        if linked is not None:
            return _link_user_to_moshtari(db, user, linked, reason="pre-create lookup")

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
    Vazn stays the physical grams. مبلغ کل stays گرم × قیمت گرم.
    مظنه is مثقال ۱۷ (gram price × 4.39) with mazaneh_is_gram=0.
    """
    from app.services.price_cards import is_motaferaghe_card

    qty = _order_quantity(order)
    if is_motaferaghe_card(getattr(order, "goldbridge_item_id", None)):
        return qty, 740.0, 0, 0
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
    # Full شرح: side / kind / customer code / order id (and special cards).
    sharh = _order_sharh(order, user)

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
                from app.gold_conversion import MOTAFEREGHE_TO_GRAM18
                from app.services.price_cards import is_motaferaghe_card

                # متفرقه stores price_at_submit as گرم; مظنه needs مثقال۱۷.
                if is_motaferaghe_card(getattr(order, "goldbridge_item_id", None)):
                    mazaneh_mesghal = float(order.price_at_submit or 0) * MOTAFEREGHE_TO_GRAM18
                else:
                    mazaneh_mesghal = order.price_at_submit or 0
            # نقد کارتخوان: mesghal17_price_at_submit is already final
            # (id:1 + کارمزد + ۱۰۰٬۰۰۰) — that value is what goes in مظنه.
            mazaneh = _scale_amount(float(mazaneh_mesghal))
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
    """Apply successful response onto User / Order / ExpertHedge rows."""
    from app.models_db import ExpertHedge, Order, User

    method = (getattr(job, "method", None) or "").lower()
    if method == MANDE_METHOD or job.ref_type in ("mande", "mande-day"):
        apply_mande_rows(db, parse_mande_rows(result or {}))
        return

    if method == ASNAD_METHOD.lower() or job.ref_type == "asnad":
        if job.ref_id:
            user = db.query(User).filter(User.id == job.ref_id).first()
            if user:
                apply_asnad_payload(db, user, result or {})
        return

    if job.ref_type == ABSHODE_SELLERS_REF:
        apply_abshode_sellers_payload(db, result or {})
        return

    if job.ref_type == "hedge-delete" or (getattr(job, "method", None) == "DoDeleteSanad"):
        logger.info(
            "[tahesab] DoDeleteSanad ok ref=%s deleted=%s",
            job.ref_id,
            result.get("DELETED") or result.get("OK"),
        )
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
                    request_asnad_refresh(db, user, force=True)
    if job.ref_type == "hedge" and job.ref_id and ok is not None:
        hedge = db.query(ExpertHedge).filter(ExpertHedge.id == job.ref_id).first()
        if hedge:
            hedge.tahesab_factor_code = str(ok)
            hedge.tahesab_sync_needed = False
            db.add(hedge)
        else:
            # Hedge was removed in the app while create was in-flight — void the sanad.
            factor = str(ok).strip()
            if factor:
                logger.info(
                    "[tahesab] hedge %s gone after create ack — queueing DoDeleteSanad %s",
                    job.ref_id,
                    factor,
                )
                delete_sanad(db, factor, ref_id=str(job.ref_id))


def _error_text(data: dict[str, Any] | None) -> str:
    if not data:
        return ""
    return str(data.get("ERROR") or data.get("Error") or data.get("error") or "")


def _moshtari_codes_from_payload(data: Any) -> list[int]:
    """Collect Code values from a DoListMoshtari payload (any group)."""
    if not data:
        return []
    rows: list[Any] = []
    if isinstance(data, list):
        rows = data
    elif isinstance(data, dict):
        if _error_text(data):
            return []
        for key, val in data.items():
            if str(key).lower() in {"ok", "error", "api_status", "dbname", "dbtype"}:
                continue
            if isinstance(val, list):
                rows.extend(val)
            elif isinstance(val, dict):
                rows.append(val)
    codes: list[int] = []
    seen: set[int] = set()
    for row in rows:
        if not isinstance(row, dict):
            continue
        code = row.get("Code", row.get("code"))
        if code is None:
            continue
        try:
            n = int(str(code).translate(_PERSIAN_DIGITS).strip())
        except (TypeError, ValueError):
            continue
        if n in seen:
            continue
        seen.add(n)
        codes.append(n)
    return codes


def lookup_moshtari_by_phone(tel: str) -> int | None:
    """DoListMoshtari filtered by phone; returns first Code or None (any group)."""
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
        codes = _moshtari_codes_from_payload(data)
        if codes:
            return codes[0]
    return None


def lookup_moshtari_by_code(code: int) -> int | None:
    """DoListMoshtari by moshtari Code; None if that card does not exist."""
    try:
        n = int(code)
    except (TypeError, ValueError):
        return None
    if n <= 0:
        return None
    data = call_method_direct("DoListMoshtari", [n])
    codes = _moshtari_codes_from_payload(data)
    if n in codes:
        return n
    return None


def lookup_existing_moshtari(
    *,
    tel: str | None = None,
    preferred_code: int | None = None,
) -> int | None:
    """Find a moshtari already in Tahesab (any group). Never creates one."""
    if tel:
        found = lookup_moshtari_by_phone(tel)
        if found is not None:
            return found
    if preferred_code is not None:
        found = lookup_moshtari_by_code(int(preferred_code))
        if found is not None:
            return found
    return None


def _preferred_code_from_params(params: list[Any]) -> int | None:
    if len(params) <= 8:
        return None
    try:
        n = int(params[8])
    except (TypeError, ValueError):
        return None
    return n if n > 0 else None


def resolve_duplicate_moshtari(params: list[Any]) -> int | None:
    """On DoNewMoshtari تکراری: reuse the existing card instead of a second one."""
    tel = params[2] if len(params) > 2 else ""
    pref = _preferred_code_from_params(params)
    linked = lookup_existing_moshtari(
        tel=str(tel) if tel is not None else "",
        preferred_code=pref,
    )
    if linked is not None:
        return linked
    # Tahesab already has this phone/code — work on the requested Code.
    return pref


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
            linked = resolve_duplicate_moshtari(params)
            if linked is not None:
                result = {"OK": linked, "linked": True, "note": err}
                job.status = "done"
                job.result_json = json.dumps(result, ensure_ascii=False)
                job.last_error = None
                apply_bridge_result(db, job, result)
                db.add(job)
                db.commit()
                logger.info("[tahesab] linked duplicate → moshtari %s", linked)
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

        # DoDeleteSanad: missing / already-gone factor is a successful void.
        if job.method == "DoDeleteSanad" and any(
            x in err for x in ("پیدا نشد", "یافت نشد", "وجود ندارد", "not found", "Not Found", "نامعتبر")
        ):
            result = {"DELETED": params[0] if params else "missing", "note": err}
            job.status = "done"
            job.result_json = json.dumps(result, ensure_ascii=False)
            job.last_error = None
            apply_bridge_result(db, job, result)
            db.add(job)
            db.commit()
            logger.info("[tahesab] DoDeleteSanad already absent → %s", params[0] if params else "?")
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

    # Success shapes: {"OK": ...}, {"DELETED": ...}, CheckHealth {"Api_Status": "OK"},
    # getmandehesabbycode {"MandeHesab": [...]}, DoListAsnad {id: {...}, ...}.
    method_l = (job.method or "").lower()
    if (
        "OK" not in data
        and "DELETED" not in data
        and "Api_Status" not in data
        and not payload_is_mande_success(data)
        and method_l != MANDE_METHOD
        and method_l != ASNAD_METHOD.lower()
        and not parse_asnad_rows(data)
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


def sync_unsynced_users_to_tahesab(db: Session, limit: int = 100) -> int:
    """Queue/link DoNewMoshtari for every app user missing a moshtari id.

    Does not create app users from Tahesab. Skips users that already have
    a pending/claimed DoNewMoshtari outbox job.
    """
    from app.models_db import TahesabOutbox, User

    if not is_configured():
        return 0
    users = (
        db.query(User)
        .filter(User.tahesab_moshtari_id.is_(None))
        .order_by(User.created_at.asc())
        .limit(limit)
        .all()
    )
    n = 0
    for user in users:
        pending = (
            db.query(TahesabOutbox)
            .filter(
                TahesabOutbox.ref_type == "user",
                TahesabOutbox.ref_id == user.id,
                TahesabOutbox.method == "DoNewMoshtari",
                TahesabOutbox.status.in_(("pending", "claimed")),
            )
            .first()
        )
        if pending:
            continue
        try:
            sync_user_to_tahesab(db, user)
            n += 1
        except Exception:
            logger.exception(
                "[tahesab] catch-up user sync failed for %s",
                getattr(user, "user_code", getattr(user, "id", "?")),
            )
    if n:
        db.commit()
        logger.info("[tahesab] catch-up queued/linked %s app users to Tahesab", n)
    return n


def reset_all_app_remainings(db: Session) -> dict[str, int]:
    """Zero gold + cash remaining for every app user.

    Tahesab assets are wiped separately on the shop PC. This:
      - writes Tahesab cache to 0 so the remaining card shows empty
      - offsets the app gold/cash ledger so the fallback is also 0
      - cancels pending مانده jobs so a fresh Tahesab pull can follow
    Coin (سکه) ledgers are left unchanged.
    """
    from sqlalchemy import func

    from app.models_db import (
        BalanceTransaction,
        TransactionReasonEnum,
        User,
        gen_uuid,
    )

    now = datetime.utcnow()
    users = db.query(User).all()
    ledger_rows = (
        db.query(
            BalanceTransaction.user_id,
            func.coalesce(func.sum(BalanceTransaction.gold_change), 0.0),
            func.coalesce(func.sum(BalanceTransaction.cash_change), 0.0),
        )
        .filter(BalanceTransaction.goldbridge_item_id.is_(None))
        .group_by(BalanceTransaction.user_id)
        .all()
    )
    ledger = {
        uid: (float(gold or 0.0), float(cash or 0.0)) for uid, gold, cash in ledger_rows
    }

    n_users = 0
    n_offsets = 0
    for user in users:
        user.tahesab_gold_balance = 0.0
        user.tahesab_cash_balance = 0.0
        user.tahesab_balance_at = now
        db.add(user)
        n_users += 1
        gold_sum, cash_sum = ledger.get(user.id, (0.0, 0.0))
        if gold_sum or cash_sum:
            db.add(
                BalanceTransaction(
                    id=gen_uuid(),
                    user_id=user.id,
                    gold_change=-gold_sum,
                    cash_change=-cash_sum,
                    reason=TransactionReasonEnum.admin_adjustment,
                    note="صفر کردن مانده هم‌زمان با ته‌حساب",
                    created_at=now,
                )
            )
            n_offsets += 1

    cancelled = cancel_pending_mande_jobs(db)
    clear_mande_hold(db)
    set_books_reset_at(db, now)
    db.flush()
    logger.info(
        "[tahesab] remaining reset users=%s ledger_offsets=%s mande_cancelled=%s",
        n_users,
        n_offsets,
        cancelled,
    )
    return {
        "users": n_users,
        "ledger_offsets": n_offsets,
        "mande_cancelled": cancelled,
    }


def reset_remainings_and_sync_users(db: Session) -> dict[str, int]:
    """One-shot: clear app remaining, then ensure every app user is in Tahesab."""
    stats = reset_all_app_remainings(db)
    queued = sync_unsynced_users_to_tahesab(db, limit=5000)
    stats["users_queued"] = queued
    return stats


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
    """Bridge + direct: retry unsynced app users, then accepted orders."""
    from app.db import SessionLocal

    poll = 20.0
    logger.info("[tahesab] catch-up worker started poll=%ss", poll)
    while True:
        try:
            if is_configured():
                db = SessionLocal()
                try:
                    sync_unsynced_users_to_tahesab(db)
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


def _cli(argv: list[str] | None = None) -> int:
    """One-shot ops: python -m app.services.tahesab reset-and-sync"""
    import sys

    from app.db import SessionLocal

    args = list(sys.argv[1:] if argv is None else argv)
    cmd = args[0] if args else ""
    db = SessionLocal()
    try:
        if cmd == "reset-remainings":
            stats = reset_all_app_remainings(db)
            db.commit()
            print(stats)
            return 0
        if cmd == "sync-users":
            n = sync_unsynced_users_to_tahesab(db, limit=5000)
            db.commit()
            print({"users_queued": n})
            return 0
        if cmd == "reset-and-sync":
            stats = reset_remainings_and_sync_users(db)
            db.commit()
            print(stats)
            return 0
        if cmd == "release-mande-hold":
            clear_mande_hold(db)
            queued = enqueue_mande_for_all_users(db)
            db.commit()
            print({"hold_cleared": True, "mande_jobs": queued})
            return 0
        if cmd == "set-books-reset":
            raw = args[1] if len(args) > 1 else ""
            when = parse_setting_datetime(raw) if raw else datetime.utcnow()
            if raw and when is None:
                print({"error": f"invalid datetime: {raw}"}, file=sys.stderr)
                return 2
            set_books_reset_at(db, when)
            queued = enqueue_mande_for_all_users(db)
            db.commit()
            print({
                "books_reset_at": books_reset_at(db).isoformat() if books_reset_at(db) else None,
                "mande_jobs": queued,
            })
            return 0
        print(
            "usage: python -m app.services.tahesab "
            "{reset-remainings|sync-users|reset-and-sync|release-mande-hold|set-books-reset}",
            file=sys.stderr,
        )
        return 2
    except Exception:
        db.rollback()
        logger.exception("[tahesab] cli %s failed", cmd)
        raise
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(_cli())
