"""
Admin-only view of every raw price goldbridge is currently tracking
(not just the one item the live trading price uses). Proxies
goldbridge's GET /prices server-side so the browser never needs
goldbridge's API key directly.
"""
import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException

from app.admin_auth import get_current_admin, require_permission
from app.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(tags=["admin-prices"])


def _all_prices_url() -> str:
    if settings.PRICE_API_ALL_URL:
        return settings.PRICE_API_ALL_URL
    if settings.PRICE_API_URL.endswith("/price"):
        return settings.PRICE_API_URL[: -len("/price")] + "/prices"
    raise RuntimeError(
        "Can't determine goldbridge's /prices URL - set GOLDAPP_PRICE_API_ALL_URL explicitly"
    )


@router.get("/api/admin/all-prices")
async def get_all_prices(_admin=Depends(require_permission("prices"))):
    """
    Full list of every item goldbridge tracks, straight from its
    /prices endpoint (still in Rial - goldbridge doesn't know about
    Toman conversion; the frontend card view converts for display).
    """
    try:
        url = _all_prices_url()
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))

    headers = {}
    if settings.PRICE_API_KEY:
        headers["Authorization"] = f"Bearer {settings.PRICE_API_KEY}"

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
            return resp.json()
    except httpx.HTTPStatusError as e:
        logger.warning(
            f"[admin-prices] goldbridge returned {e.response.status_code}")
        raise HTTPException(
            status_code=502, detail="goldbridge returned an error")
    except Exception as e:
        logger.warning(f"[admin-prices] failed to reach goldbridge: {e}")
        raise HTTPException(
            status_code=502, detail="couldn't reach goldbridge")
