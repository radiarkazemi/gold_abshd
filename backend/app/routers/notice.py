from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.admin_auth import get_current_admin, require_permission
from app.schemas.notice import NoticeOut, NoticeUpdateIn
from app.services.notice import get_notice, get_notice_updated_at, set_notice

router = APIRouter(tags=["notice"])


@router.get("/api/notice", response_model=NoticeOut)
async def get_site_notice(db: Session = Depends(get_db)):
    return NoticeOut(text=get_notice(db), updated_at=get_notice_updated_at(db))


@router.put("/api/admin/notice", response_model=NoticeOut)
async def update_site_notice(payload: NoticeUpdateIn, db: Session = Depends(get_db), _admin=Depends(require_permission("notice"))):
    text = set_notice(db, payload.text)
    return NoticeOut(text=text, updated_at=get_notice_updated_at(db))
