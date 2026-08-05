"""
قوانین و مقررات — admin-editable text + permanent digital signatures
recorded on every login acceptance.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from app.models_db import AppSetting, TermsAcceptance, User, gen_uuid
from app.content.default_terms_fa import DEFAULT_TERMS

TERMS_TEXT_KEY = "terms_text"
TERMS_VERSION_KEY = "terms_version"


def content_hash(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()


def get_terms_text(db: Session) -> str:
    row = db.query(AppSetting).filter(AppSetting.key == TERMS_TEXT_KEY).first()
    return row.value if row else DEFAULT_TERMS


def get_terms_version(db: Session) -> str:
    row = db.query(AppSetting).filter(AppSetting.key == TERMS_VERSION_KEY).first()
    return row.value if row else "1"


def get_terms(db: Session) -> dict[str, Any]:
    text = get_terms_text(db)
    version = get_terms_version(db)
    row = db.query(AppSetting).filter(AppSetting.key == TERMS_TEXT_KEY).first()
    return {
        "text": text,
        "version": version,
        "content_hash": content_hash(text),
        "updated_at": row.updated_at.isoformat() if row and row.updated_at else None,
    }


def set_terms(db: Session, text: str) -> dict[str, Any]:
    text = (text or "").strip()
    if not text:
        text = DEFAULT_TERMS
    now = datetime.utcnow()
    current = get_terms_text(db)
    version_row = db.query(AppSetting).filter(AppSetting.key == TERMS_VERSION_KEY).first()

    if version_row:
        try:
            current_version = int(version_row.value)
        except (TypeError, ValueError):
            current_version = 1
    else:
        current_version = 1

    # Bump version only when the published text actually changes.
    next_version = str(current_version + 1) if current != text else str(current_version)

    text_row = db.query(AppSetting).filter(AppSetting.key == TERMS_TEXT_KEY).first()
    if text_row:
        text_row.value = text
        text_row.updated_at = now
    else:
        db.add(AppSetting(key=TERMS_TEXT_KEY, value=text, updated_at=now))

    if version_row:
        version_row.value = next_version
        version_row.updated_at = now
    else:
        db.add(AppSetting(key=TERMS_VERSION_KEY, value=next_version, updated_at=now))

    db.commit()
    return get_terms(db)


def _parse_client_time(raw: Any) -> datetime | None:
    if not raw:
        return None
    if isinstance(raw, datetime):
        return raw.replace(tzinfo=None) if raw.tzinfo else raw
    s = str(raw).strip()
    if not s:
        return None
    try:
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        dt = datetime.fromisoformat(s)
        return dt.replace(tzinfo=None) if dt.tzinfo else dt
    except ValueError:
        return None


def build_signature_hash(payload: dict[str, Any]) -> str:
    canonical = json.dumps(payload, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def record_terms_acceptance(
    db: Session,
    *,
    user: User,
    device_id: str,
    ip_address: str | None,
    fingerprint: dict[str, Any] | None,
    terms_version: str | None = None,
) -> TermsAcceptance:
    """
    Persist an immutable digital signature for this login acceptance.
    Always creates a new row (append-only).
    """
    terms = get_terms(db)
    text = terms["text"]
    version = terms_version or terms["version"]
    # If client sent a stale version, still record current text hash but keep
    # the version they claimed for audit; prefer live content hash.
    c_hash = terms["content_hash"]
    fp = dict(fingerprint or {})
    user_agent = (
        fp.get("user_agent")
        or fp.get("userAgent")
        or fp.get("ua")
        or ""
    )
    accepted_at = datetime.utcnow()
    accepted_at_client = _parse_client_time(fp.get("accepted_at_client") or fp.get("acceptedAtClient"))
    row_id = gen_uuid()

    signature_payload = {
        "acceptance_id": row_id,
        "user_id": user.id,
        "user_code": user.user_code,
        "phone_number": user.phone_number,
        "terms_version": version,
        "terms_content_hash": c_hash,
        "device_id": device_id,
        "ip_address": ip_address or "",
        "user_agent": user_agent,
        "fingerprint": fp,
        "accepted_at": accepted_at.isoformat() + "Z",
        "accepted_at_client": accepted_at_client.isoformat() + "Z" if accepted_at_client else None,
    }
    sig = build_signature_hash(signature_payload)

    row = TermsAcceptance(
        id=row_id,
        user_id=user.id,
        phone_number=user.phone_number,
        terms_version=str(version),
        terms_content_hash=c_hash,
        terms_text_snapshot=text,
        device_id=device_id or "",
        ip_address=ip_address or None,
        user_agent=user_agent or None,
        fingerprint_json=json.dumps(fp, ensure_ascii=False, default=str),
        signature_hash=sig,
        accepted_at=accepted_at,
        accepted_at_client=accepted_at_client,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def list_user_terms_acceptances(
    db: Session,
    user_id: str,
    *,
    limit: int = 500,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    sort: str = "desc",
) -> list[TermsAcceptance]:
    q = db.query(TermsAcceptance).filter(TermsAcceptance.user_id == user_id)
    if date_from is not None:
        q = q.filter(TermsAcceptance.accepted_at >= date_from)
    if date_to is not None:
        q = q.filter(TermsAcceptance.accepted_at <= date_to)
    if (sort or "").lower() == "asc":
        q = q.order_by(TermsAcceptance.accepted_at.asc())
    else:
        q = q.order_by(TermsAcceptance.accepted_at.desc())
    return q.limit(limit).all()


def count_user_terms_acceptances(db: Session, user_id: str) -> int:
    return db.query(TermsAcceptance).filter(TermsAcceptance.user_id == user_id).count()


def acceptance_to_dict(row: TermsAcceptance) -> dict[str, Any]:
    try:
        fingerprint = json.loads(row.fingerprint_json or "{}")
    except json.JSONDecodeError:
        fingerprint = {}
    return {
        "id": row.id,
        "user_id": row.user_id,
        "phone_number": row.phone_number,
        "terms_version": row.terms_version,
        "terms_content_hash": row.terms_content_hash,
        "device_id": row.device_id,
        "ip_address": row.ip_address,
        "user_agent": row.user_agent,
        "fingerprint": fingerprint,
        "signature_hash": row.signature_hash,
        "accepted_at": row.accepted_at,
        "accepted_at_client": row.accepted_at_client,
    }
