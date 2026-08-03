from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query

from sqlalchemy.orm import Session

from app.db import get_db
from app.admin_auth import require_permission
from app.schemas.expert import (
    TehranDealerOut,
    TehranDealerCreateIn,
    TehranDealerUpdateIn,
    ExpertHedgeOut,
    ExpertHedgeCreateIn,
    ExpertDeskOut,
    ExpertDayReportOut,
)
from app.services import expert_desk

router = APIRouter(prefix="/api/admin/expert", tags=["admin-expert"])


@router.get("/desk", response_model=ExpertDeskOut)
async def get_expert_desk(
    db: Session = Depends(get_db),
    _admin=Depends(require_permission("expert")),
):
    return expert_desk.get_desk(db)


@router.get("/tehran-report", response_model=ExpertDayReportOut)
async def get_tehran_day_report(
    day: date = Query(..., description="Gregorian YYYY-MM-DD (Tehran calendar day)"),
    db: Session = Depends(get_db),
    _admin=Depends(require_permission("expert")),
):
    if day > date.today() + timedelta(days=1):
        raise HTTPException(status_code=400, detail="تاریخ نامعتبر است")
    return expert_desk.get_day_report(db, day)


@router.get("/dealers", response_model=list[TehranDealerOut])
async def get_dealers(
    db: Session = Depends(get_db),
    _admin=Depends(require_permission("expert")),
):
    return expert_desk.list_dealers(db)


@router.post("/dealers", response_model=TehranDealerOut)
async def add_dealer(
    payload: TehranDealerCreateIn,
    db: Session = Depends(get_db),
    _admin=Depends(require_permission("expert")),
):
    return expert_desk.create_dealer(
        db, payload.name, payload.phone, payload.notes, payload.sort_order
    )


@router.patch("/dealers/{dealer_id}", response_model=TehranDealerOut)
async def edit_dealer(
    dealer_id: str,
    payload: TehranDealerUpdateIn,
    db: Session = Depends(get_db),
    _admin=Depends(require_permission("expert")),
):
    return expert_desk.update_dealer(
        db,
        dealer_id,
        name=payload.name,
        phone=payload.phone,
        notes=payload.notes,
        is_active=payload.is_active,
        sort_order=payload.sort_order,
    )


@router.post("/hedges", response_model=ExpertHedgeOut)
async def add_hedge(
    payload: ExpertHedgeCreateIn,
    db: Session = Depends(get_db),
    admin=Depends(require_permission("expert")),
):
    return expert_desk.create_hedge(
        db,
        dealer_id=payload.dealer_id,
        related_order_id=payload.related_order_id,
        side=payload.side,
        weight_gram18=payload.weight_gram18,
        price_mesghal17=payload.price_mesghal17,
        note=payload.note,
        created_by=admin.get("username"),
    )


@router.delete("/hedges/{hedge_id}")
async def remove_hedge(
    hedge_id: str,
    db: Session = Depends(get_db),
    _admin=Depends(require_permission("expert")),
):
    expert_desk.delete_hedge(db, hedge_id)
    return {"ok": True}
