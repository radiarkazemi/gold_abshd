"""
سرویس قیمت طلا (مظنه).

The actual price data comes from a pluggable "price source" (see the
price_sources/ package): a local simulator for development, a Telegram
channel reader for testing with a real feed, or a generic HTTP API
poller for production. Which one runs is controlled by GOLDAPP_PRICE_SOURCE
in .env - everything else in the app (WebSocket broadcasting, order
submission, etc.) doesn't need to know or care which source is active.
"""
import asyncio
import logging

from app.models import GoldPrice
from app.config import settings
from app.gold_conversion import mesghal17_to_gram18

logger = logging.getLogger(__name__)


def _build_source():
    source = settings.PRICE_SOURCE.lower()

    if source == "simulator":
        from app.price_sources.simulator import SimulatorPriceSource
        return SimulatorPriceSource()

    if source == "telegram":
        from app.price_sources.telegram_source import TelegramPriceSource
        return TelegramPriceSource()

    if source == "api":
        from app.price_sources.api_source import ApiPriceSource
        return ApiPriceSource()

    raise ValueError(
        f"Unknown GOLDAPP_PRICE_SOURCE={settings.PRICE_SOURCE!r}. "
        f"Must be one of: simulator, telegram, api"
    )


class PriceService:
    def __init__(self):
        self.current_price = GoldPrice(buy_price=0, sell_price=0)
        self._subscribers = []
        self._has_price = False

    def get_price(self) -> GoldPrice:
        return self.current_price

    def subscribe(self, queue: asyncio.Queue):
        self._subscribers.append(queue)

    def unsubscribe(self, queue: asyncio.Queue):
        if queue in self._subscribers:
            self._subscribers.remove(queue)

    async def _broadcast(self):
        for q in list(self._subscribers):
            await q.put(self.current_price)

    async def _on_price(self, buy: float, sell: float, gram18_buy: float = None, gram18_sell: float = None):
        self.current_price = GoldPrice(
            buy_price=buy,
            sell_price=sell,
            # Prefer the source's own real گرم۱۸ price when it provides one
            # (e.g. the Telegram channel reports it directly) - only fall
            # back to the formula-based approximation when a source
            # doesn't give us a real number to use.
            gram18_buy_price=gram18_buy if gram18_buy is not None else mesghal17_to_gram18(buy),
            gram18_sell_price=gram18_sell if gram18_sell is not None else mesghal17_to_gram18(sell),
        )
        self._has_price = True
        await self._broadcast()

    async def run_simulation(self):
        """
        Despite the name (kept for backwards compatibility with main.py),
        this runs whichever price source is configured - not necessarily
        the simulator. Retries with a backoff if the source errors out
        (including construction/config errors, e.g. missing Telegram
        credentials) so a flaky connection or bad config doesn't
        silently kill this background task forever.
        """
        logger.info(f"[price] using source: {settings.PRICE_SOURCE}")

        backoff = 3
        while True:
            try:
                source = _build_source()
                await source.run(self._on_price)
            except Exception as e:
                logger.error(f"[price] source '{settings.PRICE_SOURCE}' failed: {e}")
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 60)


price_service = PriceService()