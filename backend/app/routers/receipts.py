from fastapi import APIRouter, Depends, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.db import get_db
from app.auth import get_current_user
from app.admin_auth import get_current_admin
from app.models_db import User
from app.schemas.order import OrderOut
from app.services.receipts import save_receipt, get_receipt_path_for_viewer

router = APIRouter(tags=["receipts"])


@router.post("/api/orders/{order_id}/receipt", response_model=OrderOut)
async def upload_receipt(
    order_id: str,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    content = await file.read()
    order = save_receipt(db, order_id, current_user.id, file, content)
    return order


@router.get("/api/orders/{order_id}/receipt")
async def view_own_receipt(
    order_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    path = get_receipt_path_for_viewer(db, order_id, current_user.id, is_admin=False)
    return FileResponse(path)


@router.get("/api/admin/orders/{order_id}/receipt")
async def view_receipt_as_admin(order_id: str, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    path = get_receipt_path_for_viewer(db, order_id, viewer_user_id=None, is_admin=True)
    return FileResponse(path)