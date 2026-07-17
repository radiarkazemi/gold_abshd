"""
KYC (احراز هویت): customer uploads a document photo (national ID,
etc), admin reviews and approves/rejects. Same file-validation
approach as receipts.py (extension + magic bytes + size cap) - kept as
a near-duplicate rather than a shared import to avoid coupling two
independently-evolving upload flows to one helper.
"""
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


def _content_matches_extension(content: bytes, ext: str) -> bool:
    signatures = _MAGIC_SIGNATURES.get(ext)
    if not signatures:
        return False
    if ext == ".webp":
        return content[:4] == b"RIFF" and content[8:12] == b"WEBP"
    return any(content.startswith(sig) for sig in signatures)


def submit_kyc(db: Session, user: User, file: UploadFile, content: bytes) -> User:
    if user.kyc_status == "pending":
        raise HTTPException(
            status_code=400, detail="درخواست احراز هویت شما در حال بررسی است")
    if user.kyc_status == "approved":
        raise HTTPException(
            status_code=400, detail="هویت شما قبلا تایید شده است")

    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in settings.ALLOWED_RECEIPT_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"فرمت فایل مجاز نیست. فرمت‌های مجاز: {', '.join(sorted(settings.ALLOWED_RECEIPT_EXTENSIONS))}",
        )
    if not _content_matches_extension(content, ext):
        raise HTTPException(
            status_code=400, detail="محتوای فایل با فرمت اعلام‌شده مطابقت ندارد")

    max_bytes = settings.MAX_RECEIPT_SIZE_MB * 1024 * 1024
    if len(content) > max_bytes:
        raise HTTPException(
            status_code=400,
            detail=f"حجم فایل نباید بیشتر از {settings.MAX_RECEIPT_SIZE_MB} مگابایت باشد",
        )

    os.makedirs(KYC_UPLOAD_DIR, exist_ok=True)
    filename = f"{user.id}_{uuid.uuid4().hex[:8]}{ext}"
    filepath = os.path.join(KYC_UPLOAD_DIR, filename)
    with open(filepath, "wb") as f:
        f.write(content)

    if user.kyc_document_path and os.path.exists(user.kyc_document_path):
        try:
            os.remove(user.kyc_document_path)
        except OSError:
            pass

    user.kyc_document_path = filepath
    user.kyc_status = "pending"
    user.kyc_submitted_at = datetime.utcnow()
    user.kyc_reject_reason = None
    db.commit()
    db.refresh(user)
    return user


def get_kyc_document_path(db: Session, user_id: str, viewer_user_id: str | None, is_admin: bool) -> str:
    user = db.query(User).filter(User.id == user_id).first()
    if not user or not user.kyc_document_path or not os.path.exists(user.kyc_document_path):
        raise HTTPException(status_code=404, detail="مدرکی ثبت نشده")
    if is_admin or user.id == viewer_user_id:
        return user.kyc_document_path
    raise HTTPException(status_code=403, detail="اجازه دسترسی ندارید")


def list_pending_kyc(db: Session) -> list[User]:
    return db.query(User).filter(User.kyc_status == "pending").order_by(User.kyc_submitted_at.asc()).all()


def review_kyc(db: Session, user_id: str, approve: bool, reject_reason: str | None = None) -> User:
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="کاربر پیدا نشد")
    if user.kyc_status != "pending":
        raise HTTPException(
            status_code=400, detail="این درخواست در وضعیت در انتظار بررسی نیست")

    user.kyc_status = "approved" if approve else "rejected"
    user.kyc_reviewed_at = datetime.utcnow()
    user.kyc_reject_reason = None if approve else (reject_reason or "")
    db.commit()
    db.refresh(user)
    return user
