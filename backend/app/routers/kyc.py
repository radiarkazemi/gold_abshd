from fastapi import APIRouter, Depends, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.db import get_db
from app.auth import get_current_user
from app.admin_auth import require_permission
from app.models_db import User
from app.schemas.kyc import KycStatusOut, KycPendingOut, KycReviewIn
from app.services.kyc import (
    DOC_SLOTS,
    submit_kyc,
    get_kyc_document_path,
    list_pending_kyc,
    review_kyc,
    status_payload,
)
from app.ws_manager import manager

router = APIRouter(tags=["kyc"])


@router.get("/api/kyc/status", response_model=KycStatusOut)
async def get_my_kyc_status(current_user: User = Depends(get_current_user)):
    return KycStatusOut(**status_payload(current_user))


@router.post("/api/kyc/submit", response_model=KycStatusOut)
async def submit_my_kyc(
    id_front: UploadFile = File(..., description="عکس روی کارت ملی"),
    id_back: UploadFile = File(..., description="عکس پشت کارت ملی"),
    birth_cert: UploadFile = File(..., description="عکس صفحه اول شناسنامه"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    files = {
        "id_front": (id_front, await id_front.read()),
        "id_back": (id_back, await id_back.read()),
        "birth_cert": (birth_cert, await birth_cert.read()),
    }
    user = submit_kyc(db, current_user, files)
    await manager.broadcast_to_admins(
        {
            "type": "new_kyc",
            "user": {
                "user_id": user.id,
                "user_code": user.user_code,
                "full_name": user.full_name,
                "phone_number": user.phone_number,
                "kyc_submitted_at": user.kyc_submitted_at.isoformat() if user.kyc_submitted_at else None,
            },
        }
    )
    return KycStatusOut(**status_payload(user))


@router.get("/api/admin/kyc/pending", response_model=list[KycPendingOut])
async def get_pending_kyc(db: Session = Depends(get_db), _admin=Depends(require_permission("kyc"))):
    """List pending + approved KYC (approved kept so admins can revoke)."""
    return [
        KycPendingOut(
            user_id=u.id,
            user_code=u.user_code,
            full_name=u.full_name,
            phone_number=u.phone_number,
            kyc_status=u.kyc_status or "pending",
            kyc_submitted_at=u.kyc_submitted_at,
            kyc_reviewed_at=u.kyc_reviewed_at,
            has_id_front=bool(u.kyc_id_front_path or u.kyc_document_path),
            has_id_back=bool(u.kyc_id_back_path),
            has_birth_cert=bool(u.kyc_birth_cert_path),
        )
        for u in list_pending_kyc(db)
    ]


@router.get("/api/admin/kyc/{user_id}/document")
async def get_kyc_document_legacy(
    user_id: str,
    db: Session = Depends(get_db),
    _admin=Depends(require_permission("kyc")),
):
    """Backward-compatible: returns national-ID front (or legacy single doc). """
    path = get_kyc_document_path(db, user_id, "id_front", viewer_user_id=None, is_admin=True)
    return FileResponse(path)


@router.get("/api/admin/kyc/{user_id}/document/{kind}")
async def get_kyc_document_kind(
    user_id: str,
    kind: str,
    db: Session = Depends(get_db),
    _admin=Depends(require_permission("kyc")),
):
    if kind not in DOC_SLOTS:
        from fastapi import HTTPException

        raise HTTPException(status_code=400, detail="نوع مدرک نامعتبر است")
    path = get_kyc_document_path(db, user_id, kind, viewer_user_id=None, is_admin=True)
    return FileResponse(path)


@router.post("/api/admin/kyc/{user_id}/review", response_model=KycStatusOut)
async def review_kyc_endpoint(
    user_id: str,
    payload: KycReviewIn,
    db: Session = Depends(get_db),
    _admin=Depends(require_permission("kyc")),
):
    user = review_kyc(db, user_id, payload.approve, payload.reject_reason)
    return KycStatusOut(**status_payload(user))
