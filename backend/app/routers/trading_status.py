from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.admin_auth import get_current_admin
from app.schemas.calendar import TradingStatusOut, TradingStatusUpdateIn
from app.services.trading_status import is_trading_online, set_trading_online

router = APIRouter(tags=["trading-status"])


@router.get("/api/trading-status", response_model=TradingStatusOut)
async def get_trading_status(db: Session = Depends(get_db)):
    return TradingStatusOut(is_online=is_trading_online(db))


@router.post("/api/admin/trading-status", response_model=TradingStatusOut)
async def update_trading_status(payload: TradingStatusUpdateIn, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    online = set_trading_online(db, payload.is_online)
    return TradingStatusOut(is_online=online)