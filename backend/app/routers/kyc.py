from fastapi import APIRouter, Depends, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.db import get_db
from app.auth import get_current_user
from app.admin_auth import require_permission
from app.models_db import User
from app.schemas.kyc import KycStatusOut, KycPendingOut, KycReviewIn
from app.services.kyc import submit_kyc, get_kyc_document_path, list_pending_kyc, review_kyc

router = APIRouter(tags=["kyc"])


@router.get("/api/kyc/status", response_model=KycStatusOut)
async def get_my_kyc_status(current_user: User = Depends(get_current_user)):
    return KycStatusOut(
        kyc_status=current_user.kyc_status,
        kyc_submitted_at=current_user.kyc_submitted_at,
        kyc_reviewed_at=current_user.kyc_reviewed_at,
        kyc_reject_reason=current_user.kyc_reject_reason,
    )


@router.post("/api/kyc/submit", response_model=KycStatusOut)
async def submit_my_kyc(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    content = await file.read()
    user = submit_kyc(db, current_user, file, content)
    return KycStatusOut(
        kyc_status=user.kyc_status,
        kyc_submitted_at=user.kyc_submitted_at,
        kyc_reviewed_at=user.kyc_reviewed_at,
        kyc_reject_reason=user.kyc_reject_reason,
    )


@router.get("/api/admin/kyc/pending", response_model=list[KycPendingOut])
async def get_pending_kyc(db: Session = Depends(get_db), _admin=Depends(require_permission("kyc"))):
    return [
        KycPendingOut(
            user_id=u.id, user_code=u.user_code, full_name=u.full_name,
            phone_number=u.phone_number, kyc_submitted_at=u.kyc_submitted_at,
        )
        for u in list_pending_kyc(db)
    ]


@router.get("/api/admin/kyc/{user_id}/document")
async def get_kyc_document_as_admin(user_id: str, db: Session = Depends(get_db), _admin=Depends(require_permission("kyc"))):
    path = get_kyc_document_path(
        db, user_id, viewer_user_id=None, is_admin=True)
    return FileResponse(path)


@router.post("/api/admin/kyc/{user_id}/review", response_model=KycStatusOut)
async def review_kyc_endpoint(
    user_id: str,
    payload: KycReviewIn,
    db: Session = Depends(get_db),
    _admin=Depends(require_permission("kyc")),
):
    user = review_kyc(db, user_id, payload.approve, payload.reject_reason)
    return KycStatusOut(
        kyc_status=user.kyc_status,
        kyc_submitted_at=user.kyc_submitted_at,
        kyc_reviewed_at=user.kyc_reviewed_at,
        kyc_reject_reason=user.kyc_reject_reason,
    )
