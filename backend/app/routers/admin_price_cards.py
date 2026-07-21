from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.admin_auth import require_permission
from app.schemas.price_cards import AdminPriceCardOut, SetCardEnabledIn, SetCardOrderableIn, SetCardOverrideIn
from app.services import price_cards

router = APIRouter(prefix="/api/admin/price-cards", tags=["admin-price-cards"])


@router.get("", response_model=list[AdminPriceCardOut])
async def list_cards(db: Session = Depends(get_db), _admin=Depends(require_permission("prices"))):
    return price_cards.list_admin_cards(db)


@router.put("/{goldbridge_item_id}/enabled", response_model=list[AdminPriceCardOut])
async def set_enabled(
    goldbridge_item_id: int,
    payload: SetCardEnabledIn,
    db: Session = Depends(get_db),
    _admin=Depends(require_permission("prices")),
):
    if goldbridge_item_id not in price_cards.get_raw_items():
        raise HTTPException(status_code=404, detail="این آیتم شناخته‌شده نیست")
    price_cards.set_card_enabled(
        db, goldbridge_item_id, payload.is_enabled, payload.display_name, payload.sort_order
    )
    return price_cards.list_admin_cards(db)


@router.put("/{goldbridge_item_id}/orderable", response_model=list[AdminPriceCardOut])
async def set_orderable(
    goldbridge_item_id: int,
    payload: SetCardOrderableIn,
    db: Session = Depends(get_db),
    _admin=Depends(require_permission("prices")),
):
    try:
        price_cards.set_card_orderable_sides(db, goldbridge_item_id, payload.orderable_buy, payload.orderable_sell)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return price_cards.list_admin_cards(db)


@router.put("/{goldbridge_item_id}/override", response_model=list[AdminPriceCardOut])
async def set_override(
    goldbridge_item_id: int,
    payload: SetCardOverrideIn,
    db: Session = Depends(get_db),
    _admin=Depends(require_permission("prices")),
):
    try:
        price_cards.set_card_override(db, goldbridge_item_id, payload.override_source_restriction)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return price_cards.list_admin_cards(db)