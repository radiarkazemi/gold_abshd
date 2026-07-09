"""
Common interface for anywhere the gold price can come from.

Every source just needs to call `on_price(buy, sell)` whenever it has a
fresh price. price_service.py wires that callback to update the shared
current price and broadcast it over the price WebSocket - the source
itself doesn't need to know anything about WebSockets, the database, etc.
"""
from abc import ABC, abstractmethod
from typing import Callable, Awaitable, Optional


# gram18_buy / gram18_sell are optional - pass them when the source
# reports its own real گرم۱۸ price directly (like the Telegram channel
# does), rather than relying on the formula-based approximation.
OnPriceCallback = Callable[[float, float, Optional[float], Optional[float]], Awaitable[None]]


class PriceSource(ABC):
    @abstractmethod
    async def run(self, on_price: OnPriceCallback):
        """
        Runs forever (until cancelled). Whenever a new price is available,
        call `await on_price(buy_price, sell_price)`.
        """
        raise NotImplementedError