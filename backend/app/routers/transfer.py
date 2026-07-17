from fastapi import APIRouter, Depends, UploadFile, File, Form
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.db import get_db
from app.auth import get_current_user
from app.admin_auth import require_permission
from app.models_db import User
from app.schemas.transfer import TransferRequestOut, TransferDecisionIn
from app.services.transfer import (
    create_transfer_request,
    list_my_transfer_requests,
    list_transfer_requests,
    get_transfer_document_path,
    decide_transfer_request,
)

router = APIRouter(tags=["transfers"])


def _to_out(row, with_user: bool = False) -> TransferRequestOut:
    return TransferRequestOut(
        id=row.id,
        amount=row.amount,
        bank_reference=row.bank_reference,
        transfer_date=row.transfer_date,
        description=row.description,
        has_receipt=bool(row.receipt_path),
        status=row.status.value if hasattr(
            row.status, "value") else row.status,
        admin_note=row.admin_note,
        created_at=row.created_at,
        reviewed_at=row.reviewed_at,
        user_id=row.user_id if with_user else None,
        user_code=row.user.user_code if with_user and row.user else None,
        customer_name=row.user.full_name if with_user and row.user else None,
    )


@router.post("/api/transfers", response_model=TransferRequestOut)
async def submit_transfer(
    amount: float = Form(...),
    bank_reference: str = Form(""),
    transfer_date: str = Form(""),
    description: str = Form(""),
    file: UploadFile | None = File(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    content = await file.read() if file else None
    row = create_transfer_request(
        db, current_user, amount, bank_reference, transfer_date, description, file, content
    )
    return _to_out(row)


@router.get("/api/my/transfers", response_model=list[TransferRequestOut])
async def get_my_transfers(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return [_to_out(r) for r in list_my_transfer_requests(db, current_user.id)]


@router.get("/api/transfers/{transfer_id}/receipt")
async def view_own_transfer_receipt(
    transfer_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    path = get_transfer_document_path(
        db, transfer_id, current_user.id, is_admin=False)
    return FileResponse(path)


@router.get("/api/admin/transfers", response_model=list[TransferRequestOut])
async def get_admin_transfers(
    status: str | None = None, db: Session = Depends(get_db), _admin=Depends(require_permission("transfers"))
):
    return [_to_out(r, with_user=True) for r in list_transfer_requests(db, status)]


@router.get("/api/admin/transfers/{transfer_id}/receipt")
async def view_transfer_receipt_as_admin(
    transfer_id: str, db: Session = Depends(get_db), _admin=Depends(require_permission("transfers"))
):
    path = get_transfer_document_path(
        db, transfer_id, viewer_user_id=None, is_admin=True)
    return FileResponse(path)


@router.post("/api/admin/transfers/{transfer_id}/decide", response_model=TransferRequestOut)
async def decide_transfer(
    transfer_id: str,
    payload: TransferDecisionIn,
    db: Session = Depends(get_db),
    _admin=Depends(require_permission("transfers")),
):
    row = decide_transfer_request(
        db, transfer_id, payload.accept, payload.admin_note)
    return _to_out(row, with_user=True)
