from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.admin_auth import require_permission
from app.schemas.notice import NoticeOut, NoticeUpdateIn
from app.services.notice import get_notice, get_notice_updated_at, set_notice
from app.ws_manager import manager

router = APIRouter(tags=["notice"])


@router.get("/api/notice", response_model=NoticeOut)
async def get_site_notice(db: Session = Depends(get_db)):
    return NoticeOut(text=get_notice(db), updated_at=get_notice_updated_at(db))


@router.put("/api/admin/notice", response_model=NoticeOut)
async def update_site_notice(payload: NoticeUpdateIn, db: Session = Depends(get_db), _admin=Depends(require_permission("notice"))):
    text = set_notice(db, payload.text)
    notice = NoticeOut(text=text, updated_at=get_notice_updated_at(db))
    # Push to every customer client on /ws/price so NoticeModal/Card
    # update immediately without a refresh.
    await manager.broadcast_site_event({"type": "notice_updated", "notice": notice.model_dump()})
    return notice
