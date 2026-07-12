from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.admin_auth import get_current_admin
from app.schemas.calendar import SettlementLabelOut, HolidayIn, HolidayOut
from app.services.calendar import get_settlement_label
from app.models_db import Holiday

router = APIRouter(tags=["calendar"])


@router.get("/api/settlement-label", response_model=SettlementLabelOut)
async def get_settlement(db: Session = Depends(get_db)):
    return get_settlement_label(db)


@router.get("/api/admin/holidays", response_model=list[HolidayOut])
async def list_holidays(db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    return db.query(Holiday).order_by(Holiday.date.asc()).all()


@router.post("/api/admin/holidays", response_model=HolidayOut)
async def add_holiday(payload: HolidayIn, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    day = datetime.strptime(payload.date, "%Y-%m-%d")
    existing = db.query(Holiday).filter(Holiday.date == day).first()
    if existing:
        raise HTTPException(status_code=400, detail="این تاریخ قبلا به عنوان تعطیل ثبت شده")
    holiday = Holiday(date=day, description=payload.description)
    db.add(holiday)
    db.commit()
    db.refresh(holiday)
    return holiday


@router.delete("/api/admin/holidays/{holiday_id}")
async def remove_holiday(holiday_id: str, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    holiday = db.query(Holiday).filter(Holiday.id == holiday_id).first()
    if not holiday:
        raise HTTPException(status_code=404, detail="تعطیلی پیدا نشد")
    db.delete(holiday)
    db.commit()
    return {"deleted": True}