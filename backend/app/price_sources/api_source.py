"""
Polls a real gold price API on an interval. Works with basically any
JSON API - you tell it, via dot-path config, where in the response the
buy and sell prices live.

Example: if your API returns
    {"data": {"gold17": {"buy": 45400000, "sell": 45550000}}}
then set:
    GOLDAPP_API_BUY_PATH=data.gold17.buy
    GOLDAPP_API_SELL_PATH=data.gold17.sell
"""
import asyncio
import logging

import httpx

from app.price_sources.base import PriceSource, OnPriceCallback
from app.config import settings

logger = logging.getLogger(__name__)


def _get_path(data: dict, path: str):
    """Walks a dotted path like 'data.gold17.buy' through nested dicts."""
    current = data
    for key in path.split("."):
        if isinstance(current, dict) and key in current:
            current = current[key]
        else:
            return None
    return current


class ApiPriceSource(PriceSource):
    async def run(self, on_price: OnPriceCallback):
        if not settings.PRICE_API_URL:
            raise RuntimeError(
                "GOLDAPP_PRICE_API_URL must be set in .env to use the api price source")

        headers = {}
        if settings.PRICE_API_KEY:
            headers["Authorization"] = f"Bearer {settings.PRICE_API_KEY}"

        async with httpx.AsyncClient(timeout=10) as client:
            while True:
                try:
                    resp = await client.get(settings.PRICE_API_URL, headers=headers)
                    resp.raise_for_status()
                    data = resp.json()

                    buy = _get_path(data, settings.PRICE_API_BUY_PATH)
                    sell = _get_path(data, settings.PRICE_API_SELL_PATH)

                    if buy is None or sell is None:
                        logger.warning(
                            f"[api-price] couldn't find buy/sell at configured paths "
                            f"in response: {data}"
                        )
                    elif float(buy) == float(sell):
                        logger.warning(
                            f"[api-price] buy and sell came out equal ({buy}) - "
                            f"not emitting this update"
                        )
                    else:
                        buy, sell = float(buy), float(sell)

                        # goldbridge/sekefarshad.ir reports Rial - convert to
                        # Toman before anything else touches these numbers.
                        # NOTE: no commission/markup applied here - this is
                        # the shared base price broadcast to everyone. Each
                        # user's commission (fixed or %) comes from their
                        # role (دسته‌بندی) and is applied per-user at
                        # order-submit time - see apply_pricing_formula() in
                        # app/services/orders.py. Applying a commission here
                        # too would double-charge it.
                        if settings.PRICE_API_RIAL_TO_TOMAN:
                            buy /= 10
                            sell /= 10

                        await on_price(buy, sell)

                except Exception as e:
                    logger.warning(f"[api-price] fetch failed: {e}")

                await asyncio.sleep(settings.PRICE_API_POLL_SECONDS)
