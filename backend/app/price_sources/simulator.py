"""
Fake price source for local development - no external dependencies at all.
Starts from a base price and nudges it randomly every few seconds.
"""
import asyncio
import random

from app.price_sources.base import PriceSource, OnPriceCallback

BASE_PRICE = 45_500_000  # سطح شروع نمونه (تومان به ازای هر مثقال ۱۷)
SPREAD = 150_000


class SimulatorPriceSource(PriceSource):
    async def run(self, on_price: OnPriceCallback):
        price = BASE_PRICE
        # emit an initial price immediately so the app isn't empty on boot
        await on_price(price - SPREAD / 2, price + SPREAD / 2)
        while True:
            await asyncio.sleep(3)
            change = random.randint(-20_000, 20_000)
            price = max(1_000_000, price + change)
            await on_price(price - SPREAD / 2, price + SPREAD / 2)