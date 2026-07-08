"""
سرویس قیمت طلا (مظنه).
فعلا با یک شبیه‌ساز کار می‌کنیم که قیمت رو در بازه‌ی واقعی نوسان می‌ده.
بعدا اینجا رو به منبع واقعی (API صرافی / سایت مظنه) وصل می‌کنیم.
"""
import asyncio
import random
from app.models import GoldPrice

# قیمت پایه (نمونه) - این عدد رو بعدا با API واقعی جایگزین می‌کنیم
BASE_PRICE = 45_500_000  # تومان به ازای هر مثقال ۱۷ عیار (نمونه)
SPREAD = 150_000          # اختلاف بین قیمت خرید و فروش


class PriceService:
    def __init__(self):
        self.current_price = GoldPrice(
            buy_price=BASE_PRICE - SPREAD / 2,
            sell_price=BASE_PRICE + SPREAD / 2,
        )
        self._subscribers = []

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

    async def run_simulation(self):
        """
        هر چند ثانیه یک نوسان کوچک روی قیمت پایه اعمال می‌کنه.
        در نسخه‌ی نهایی این متد با فراخوانی API واقعی جایگزین می‌شه.
        """
        global BASE_PRICE
        while True:
            await asyncio.sleep(3)
            change = random.randint(-20_000, 20_000)
            BASE_PRICE = max(1_000_000, BASE_PRICE + change)
            self.current_price = GoldPrice(
                buy_price=BASE_PRICE - SPREAD / 2,
                sell_price=BASE_PRICE + SPREAD / 2,
            )
            await self._broadcast()


price_service = PriceService()
