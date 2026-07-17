"""
ثبت حواله: customer-submitted notice of a bank transfer they've made,
for the admin to verify and credit to their cash balance. See
TransferRequest in models_db.py for the shape.
"""
import os
import uuid
from datetime import datetime

from fastapi import HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.config import settings
from app.models_db import TransferRequest, TransferStatusEnum, BalanceTransaction, TransactionReasonEnum, User

_MAGIC_SIGNATURES = {
    ".jpg": [b"\xff\xd8\xff"],
    ".jpeg": [b"\xff\xd8\xff"],
    ".png": [b"\x89PNG\r\n\x1a\n"],
    ".webp": [b"RIFF"],
    ".pdf": [b"%PDF-"],
}

TRANSFER_UPLOAD_DIR = os.getenv(
    "GOLDAPP_TRANSFER_UPLOAD_DIR", "uploads/transfers")


def _content_matches_extension(content: bytes, ext: str) -> bool:
    signatures = _MAGIC_SIGNATURES.get(ext)
    if not signatures:
        return False
    if ext == ".webp":
        return content[:4] == b"RIFF" and content[8:12] == b"WEBP"
    return any(content.startswith(sig) for sig in signatures)


def _save_receipt_file(file: UploadFile, content: bytes, prefix: str) -> str:
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

    os.makedirs(TRANSFER_UPLOAD_DIR, exist_ok=True)
    filename = f"{prefix}_{uuid.uuid4().hex[:8]}{ext}"
    filepath = os.path.join(TRANSFER_UPLOAD_DIR, filename)
    with open(filepath, "wb") as f:
        f.write(content)
    return filepath


def create_transfer_request(
    db: Session, user: User, amount: float, bank_reference: str, transfer_date: str,
    description: str, file: UploadFile | None, content: bytes | None,
) -> TransferRequest:
    if amount <= 0:
        raise HTTPException(
            status_code=400, detail="مبلغ باید بزرگتر از صفر باشد")

    receipt_path = None
    if file and content:
        receipt_path = _save_receipt_file(
            file, content, prefix=f"transfer_{user.id}")

    row = TransferRequest(
        user_id=user.id,
        amount=amount,
        bank_reference=bank_reference,
        transfer_date=transfer_date,
        description=description,
        receipt_path=receipt_path,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def list_my_transfer_requests(db: Session, user_id: str) -> list[TransferRequest]:
    return (
        db.query(TransferRequest)
        .filter(TransferRequest.user_id == user_id)
        .order_by(TransferRequest.created_at.desc())
        .all()
    )


def list_transfer_requests(db: Session, status: str | None = None) -> list[TransferRequest]:
    q = db.query(TransferRequest)
    if status:
        q = q.filter(TransferRequest.status == status)
    return q.order_by(TransferRequest.created_at.desc()).all()


def get_transfer_document_path(db: Session, transfer_id: str, viewer_user_id: str | None, is_admin: bool) -> str:
    row = db.query(TransferRequest).filter(
        TransferRequest.id == transfer_id).first()
    if not row or not row.receipt_path or not os.path.exists(row.receipt_path):
        raise HTTPException(status_code=404, detail="فیشی ثبت نشده")
    if is_admin or row.user_id == viewer_user_id:
        return row.receipt_path
    raise HTTPException(status_code=403, detail="اجازه دسترسی ندارید")


def decide_transfer_request(db: Session, transfer_id: str, accept: bool, admin_note: str = "") -> TransferRequest:
    row = db.query(TransferRequest).filter(
        TransferRequest.id == transfer_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="درخواست پیدا نشد")
    if row.status != TransferStatusEnum.pending:
        raise HTTPException(
            status_code=400, detail="این درخواست قبلا بررسی شده است")

    row.status = TransferStatusEnum.accepted if accept else TransferStatusEnum.rejected
    row.admin_note = admin_note
    row.reviewed_at = datetime.utcnow()

    if accept:
        tx = BalanceTransaction(
            user_id=row.user_id,
            gold_change=0,
            cash_change=row.amount,
            reason=TransactionReasonEnum.transfer_request,
            note=f"حواله تایید شده - {admin_note}".strip(" -"),
            related_order_id=None,
        )
        db.add(tx)

    db.commit()
    db.refresh(row)
    return row
