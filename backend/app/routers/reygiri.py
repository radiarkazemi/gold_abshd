from fastapi import APIRouter, Depends, Request

from app.auth import get_current_user
from app.models_db import User
from app.rate_limit import limiter
from app.schemas.reygiri import ReygiriLookupIn, ReygiriLookupOut, ReygiriSourceOut
from app.services.reygiri import lookup_ang

router = APIRouter(tags=["reygiri"])


@router.post("/api/reygiri/lookup", response_model=ReygiriLookupOut)
@limiter.limit("20/minute")
async def reygiri_lookup(
    request: Request,
    payload: ReygiriLookupIn,
    _user: User = Depends(get_current_user),
):
    """
    Authenticated proxy: query both public ریگیری sites and return structured
    results. Must run on an Iran-routed server for the national site.
    """
    raw = await lookup_ang(
        payload.ang,
        series=payload.series,
        include_archive=payload.include_archive,
    )
    return ReygiriLookupOut(
        ang=raw["ang"],
        series=raw.get("series") or "",
        include_archive=bool(raw.get("include_archive", True)),
        national=ReygiriSourceOut(**{**raw["national"], "source": raw["national"].get("source") or "reygiri.com", "source_label": raw["national"].get("source_label") or "سامانه ریگیری کشوری"}),
        abhar=ReygiriSourceOut(**{**raw["abhar"], "source": raw["abhar"].get("source") or "reygir.ir", "source_label": raw["abhar"].get("source_label") or "سامانه ریگیری ابهر"}),
    )
