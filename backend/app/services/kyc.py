"""
KYC (احراز هویت): customer uploads three document photos
(national ID front/back + birth-certificate first page), then admin
reviews and approves/rejects. Orders stay blocked until approved.
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime

from fastapi import HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.config import settings
from app.models_db import User

_MAGIC_SIGNATURES = {
    ".jpg": [b"\xff\xd8\xff"],
    ".jpeg": [b"\xff\xd8\xff"],
    ".png": [b"\x89PNG\r\n\x1a\n"],
    ".webp": [b"RIFF"],
    ".pdf": [b"%PDF-"],
}

KYC_UPLOAD_DIR = os.getenv("GOLDAPP_KYC_UPLOAD_DIR", "uploads/kyc")

# Slot key → (User column, Persian label)
DOC_SLOTS = {
    "id_front": ("kyc_id_front_path", "عکس روی کارت ملی"),
    "id_back": ("kyc_id_back_path", "عکس پشت کارت ملی"),
    "birth_cert": ("kyc_birth_cert_path", "عکس صفحه اول شناسنامه"),
}


def _content_matches_extension(content: bytes, ext: str) -> bool:
    signatures = _MAGIC_SIGNATURES.get(ext)
    if not signatures:
        return False
    if ext == ".webp":
        return content[:4] == b"RIFF" and content[8:12] == b"WEBP"
    return any(content.startswith(sig) for sig in signatures)


def _unlink(path: str | None) -> None:
    if path and os.path.exists(path):
        try:
            os.remove(path)
        except OSError:
            pass


def _compress_image_bytes(content: bytes) -> tuple[bytes, str]:
    """Downscale + JPEG-compress photos so KYC uploads stay small on disk."""
    try:
        from io import BytesIO
        from PIL import Image, ImageOps
    except ImportError:
        return content, ""

    try:
        im = Image.open(BytesIO(content))
    except Exception:
        return content, ""

    try:
        im = ImageOps.exif_transpose(im)
    except Exception:
        pass

    if im.mode in ("RGBA", "P"):
        background = Image.new("RGB", im.size, (255, 255, 255))
        if im.mode == "P":
            im = im.convert("RGBA")
        background.paste(im, mask=im.split()[-1] if im.mode == "RGBA" else None)
        im = background
    elif im.mode != "RGB":
        im = im.convert("RGB")

    max_edge = 1600
    w, h = im.size
    longest = max(w, h)
    if longest > max_edge:
        scale = max_edge / float(longest)
        im = im.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.Resampling.LANCZOS)

    out = BytesIO()
    im.save(out, format="JPEG", quality=72, optimize=True, progressive=True)
    compressed = out.getvalue()
    # Keep original only if somehow smaller (rare)
    if len(compressed) >= len(content) and content[:3] == b"\xff\xd8\xff":
        return content, ".jpg"
    return compressed, ".jpg"


def _validate_and_store(user_id: str, slot: str, file: UploadFile, content: bytes) -> str:
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in settings.ALLOWED_RECEIPT_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"فرمت فایل مجاز نیست. فرمت‌های مجاز: {', '.join(sorted(settings.ALLOWED_RECEIPT_EXTENSIONS))}",
        )
    if not _content_matches_extension(content, ext):
        raise HTTPException(status_code=400, detail="محتوای فایل با فرمت اعلام‌شده مطابقت ندارد")

    max_bytes = settings.MAX_RECEIPT_SIZE_MB * 1024 * 1024
    if len(content) > max_bytes:
        raise HTTPException(
            status_code=400,
            detail=f"حجم فایل نباید بیشتر از {settings.MAX_RECEIPT_SIZE_MB} مگابایت باشد",
        )

    store_ext = ext
    store_bytes = content
    if ext in (".jpg", ".jpeg", ".png", ".webp"):
        compressed, new_ext = _compress_image_bytes(content)
        if new_ext:
            store_bytes = compressed
            store_ext = new_ext

    # Hard cap after compression (~1.5MB per image)
    hard_cap = 1_500_000
    if store_ext != ".pdf" and len(store_bytes) > hard_cap:
        raise HTTPException(status_code=400, detail="حجم تصویر پس از فشرده‌سازی هنوز زیاد است؛ لطفا عکس واضح‌تر و سبک‌تری بگیرید")

    os.makedirs(KYC_UPLOAD_DIR, exist_ok=True)
    filename = f"{user_id}_{slot}_{uuid.uuid4().hex[:8]}{store_ext}"
    filepath = os.path.join(KYC_UPLOAD_DIR, filename)
    with open(filepath, "wb") as f:
        f.write(store_bytes)
    return filepath


def status_payload(user: User) -> dict:
    return {
        "kyc_status": user.kyc_status or "none",
        "kyc_submitted_at": user.kyc_submitted_at,
        "kyc_reviewed_at": user.kyc_reviewed_at,
        "kyc_reject_reason": user.kyc_reject_reason,
        "has_id_front": bool(user.kyc_id_front_path),
        "has_id_back": bool(user.kyc_id_back_path),
        "has_birth_cert": bool(user.kyc_birth_cert_path),
    }


def clear_kyc_files(user: User) -> None:
    for attr, _ in DOC_SLOTS.values():
        _unlink(getattr(user, attr, None))
        setattr(user, attr, None)
    # Legacy single-doc column
    _unlink(getattr(user, "kyc_document_path", None))
    user.kyc_document_path = None


def submit_kyc(
    db: Session,
    user: User,
    files: dict[str, tuple[UploadFile, bytes]],
) -> User:
    """
    files: {slot: (UploadFile, content_bytes)} for all three DOC_SLOTS.
    """
    if user.kyc_status == "pending":
        raise HTTPException(status_code=400, detail="درخواست احراز هویت شما در حال بررسی است")
    if user.kyc_status == "approved":
        raise HTTPException(status_code=400, detail="هویت شما قبلا تایید شده است")

    missing = [DOC_SLOTS[s][1] for s in DOC_SLOTS if s not in files]
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"لطفا هر سه مدرک را بارگذاری کنید: {'، '.join(missing)}",
        )

    # Replace previous attempt files after validating all three.
    saved: dict[str, str] = {}
    try:
        for slot, (upload, content) in files.items():
            saved[slot] = _validate_and_store(user.id, slot, upload, content)
    except Exception:
        for path in saved.values():
            _unlink(path)
        raise

    clear_kyc_files(user)
    for slot, path in saved.items():
        setattr(user, DOC_SLOTS[slot][0], path)

    user.kyc_status = "pending"
    user.kyc_submitted_at = datetime.utcnow()
    user.kyc_reject_reason = None
    db.commit()
    db.refresh(user)
    return user


def get_kyc_document_path(
    db: Session,
    user_id: str,
    kind: str,
    viewer_user_id: str | None,
    is_admin: bool,
) -> str:
    if kind not in DOC_SLOTS:
        raise HTTPException(status_code=400, detail="نوع مدرک نامعتبر است")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="کاربر پیدا نشد")
    if not (is_admin or user.id == viewer_user_id):
        raise HTTPException(status_code=403, detail="اجازه دسترسی ندارید")

    attr = DOC_SLOTS[kind][0]
    path = getattr(user, attr, None)
    # Fallback: legacy single document treated as id_front
    if not path and kind == "id_front":
        path = user.kyc_document_path
    if not path or not os.path.exists(path):
        raise HTTPException(status_code=404, detail="مدرکی ثبت نشده")
    return path


def list_pending_kyc(db: Session) -> list[User]:
    """Pending + approved KYC rows for the admin verify tab.

    Approved stays visible so admins can reject (revoke) after approval.
    Pending is sorted first.
    """
    from sqlalchemy import case

    return (
        db.query(User)
        .filter(User.kyc_status.in_(("pending", "approved")))
        .order_by(
            case((User.kyc_status == "pending", 0), else_=1),
            User.kyc_submitted_at.asc().nullslast(),
            User.created_at.asc(),
        )
        .all()
    )


def count_pending_kyc(db: Session) -> int:
    return db.query(User).filter(User.kyc_status == "pending").count()


def review_kyc(db: Session, user_id: str, approve: bool, reject_reason: str | None = None) -> User:
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="کاربر پیدا نشد")

    if approve:
        if user.kyc_status not in ("pending", "rejected"):
            raise HTTPException(status_code=400, detail="این درخواست قابل تایید نیست")
        user.kyc_status = "approved"
        user.kyc_reject_reason = None
    else:
        # Allow reject from pending OR already-approved (revoke verification)
        if user.kyc_status not in ("pending", "approved"):
            raise HTTPException(status_code=400, detail="این درخواست قابل رد نیست")
        user.kyc_status = "rejected"
        user.kyc_reject_reason = (reject_reason or "").strip() or None

    user.kyc_reviewed_at = datetime.utcnow()
    db.commit()
    db.refresh(user)
    return user


def require_kyc_approved(user: User) -> None:
    if (user.kyc_status or "none") != "approved":
        raise HTTPException(
            status_code=403,
            detail="برای ثبت سفارش ابتدا احراز هویت خود را تکمیل کنید.",
        )
