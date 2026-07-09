"""
Handles receipt (فیش واریز / حواله proof) uploads attached to orders.

Rules:
  - Only the order's own owner can upload a receipt to it.
  - Only while the order is still "pending" (once decided, the receipt
    is locked - no replacing evidence after the fact).
  - Only image/PDF files, capped at a configurable size.
  - The file is saved on disk under a per-order-id-prefixed name (not
    the user-supplied filename, to avoid path traversal or collisions).
  - Reading a receipt back requires being the order's owner OR an admin.
"""
import os
import uuid

from fastapi import HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.config import settings
from app.models_db import Order, OrderStatusEnum


def _ensure_upload_dir():
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)


def save_receipt(db: Session, order_id: str, user_id: str, file: UploadFile, content: bytes) -> Order:
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="سفارش پیدا نشد")
    if order.user_id != user_id:
        raise HTTPException(status_code=403, detail="این سفارش متعلق به شما نیست")
    if order.status != OrderStatusEnum.pending:
        raise HTTPException(
            status_code=400,
            detail="فقط برای سفارش‌های در انتظار می‌توان فیش ضمیمه کرد",
        )

    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in settings.ALLOWED_RECEIPT_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"فرمت فایل مجاز نیست. فرمت‌های مجاز: {', '.join(sorted(settings.ALLOWED_RECEIPT_EXTENSIONS))}",
        )

    max_bytes = settings.MAX_RECEIPT_SIZE_MB * 1024 * 1024
    if len(content) > max_bytes:
        raise HTTPException(
            status_code=400,
            detail=f"حجم فایل نباید بیشتر از {settings.MAX_RECEIPT_SIZE_MB} مگابایت باشد",
        )

    _ensure_upload_dir()
    filename = f"{order_id}_{uuid.uuid4().hex[:8]}{ext}"
    filepath = os.path.join(settings.UPLOAD_DIR, filename)
    with open(filepath, "wb") as f:
        f.write(content)

    # Remove a previous receipt file for this order, if any, now that
    # it's been replaced (still only possible while pending).
    if order.receipt_path and os.path.exists(order.receipt_path):
        try:
            os.remove(order.receipt_path)
        except OSError:
            pass

    order.receipt_path = filepath
    db.commit()
    db.refresh(order)
    return order


def get_receipt_path_for_viewer(db: Session, order_id: str, viewer_user_id: str | None, is_admin: bool) -> str:
    """Returns the file path if the viewer is allowed to see it, else raises."""
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="سفارش پیدا نشد")
    if not order.receipt_path or not os.path.exists(order.receipt_path):
        raise HTTPException(status_code=404, detail="فیشی برای این سفارش ثبت نشده")

    if is_admin or order.user_id == viewer_user_id:
        return order.receipt_path

    raise HTTPException(status_code=403, detail="اجازه دسترسی به این فیش را ندارید")