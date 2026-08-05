from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.admin_auth import require_permission
from app.schemas.terms import TermsOut, TermsUpdateIn
from app.services.terms import get_terms, set_terms

router = APIRouter(tags=["terms"])


@router.get("/api/terms", response_model=TermsOut)
async def get_public_terms(db: Session = Depends(get_db)):
    return TermsOut(**get_terms(db))


@router.put("/api/admin/terms", response_model=TermsOut)
async def update_terms(
    payload: TermsUpdateIn,
    db: Session = Depends(get_db),
    _admin=Depends(require_permission("notice")),
):
    return TermsOut(**set_terms(db, payload.text))
