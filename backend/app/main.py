"""
اپ آبشده قصر طلا - سمت سرور
اجرا: uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

Structure: this file only does app setup (middleware, startup tasks,
router registration). Every actual endpoint lives in app/routers/,
grouped by domain. Business logic lives in app/services/, request/
response shapes in app/schemas/ - main.py itself should stay small
forever; if it starts growing again, something belongs in a router
instead.
"""
import asyncio
import logging
import os

logger = logging.getLogger(__name__)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    datefmt="%H:%M:%S",
)

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.rate_limit import limiter
from app.price_service import price_service
from app.services import price_cards
from app.ws_manager import manager
from app.db import init_db, SessionLocal
from app.config import settings

from app.routers import (
    auth,
    price,
    notice,
    calendar,
    trading_status,
    orders,
    receipts,
    admin_auth,
    admin_orders,
    admin_users,
    admin_roles,
    admin_prices,
    admin_accounts,
    kyc,
    transfers,
    admin_price_cards,
)

app = FastAPI(title="آبشده قصر طلا - Gold Trading Server")

# Rate limiting on sensitive auth endpoints only (OTP request/verify, admin
# login) - everything else is unaffected. Keyed by IP address. This is
# purely additive: normal single-attempt usage never comes close to these
# limits, it only kicks in under rapid repeated attempts (e.g. brute force).
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    """
    A few headers that carry zero functionality risk for a JSON API -
    no CSP here on purpose, since getting a CSP right requires knowing
    exactly what your production static frontend loads (fonts, CDNs,
    etc.) and a wrong one silently breaks the UI rather than erroring
    loudly. Worth adding once the frontend hosting is finalized.
    """
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response


@app.on_event("startup")
async def startup_event():
    init_db()
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    asyncio.create_task(price_service.run_simulation())
    asyncio.create_task(price_cards.poll_all_items())
    asyncio.create_task(price_broadcaster())


async def price_broadcaster():
    """قیمت فعلی رو دائم برای همه کلاینت‌های وصل‌شده پخش می‌کنه.

    Two modes:
      - GOLDAPP_PRICE_SOURCE=api: driven by price_cards' own poll of
        ALL goldbridge items. Broadcasts {"cards": [...], "updated_at":
        ...} - every enabled card, each carrying its own
        orderable_buy/orderable_sell/is_primary flags (see
        services/price_cards.py). The frontend renders every card the
        same way, sized differently only for whichever one
        is_primary=true.
      - simulator/telegram: no concept of multiple items, so this
        falls back to the original single-price broadcast, wrapped as
        a single-item "cards" list so the frontend doesn't need two
        different payload formats.
    """
    if settings.PRICE_SOURCE.lower() == "api":
        await _price_cards_broadcaster_loop()
    else:
        await _legacy_single_price_broadcaster_loop()


async def _price_cards_broadcaster_loop():
    last_payload = None
    while True:
        try:
            db = SessionLocal()
            try:
                payload = price_cards.build_broadcast_payload(db)
            finally:
                db.close()

            if payload != last_payload:
                await manager.broadcast_price(payload)
                last_payload = payload
        except Exception as e:
            # Without this, ANY exception here (a transient DB hiccup,
            # anything) kills this asyncio task permanently and silently -
            # no more price updates ever again, with nothing in the logs
            # pointing at why. Log it and keep the loop alive instead.
            logger.error(f"[price-broadcast] tick failed: {type(e).__name__}: {e}")

        await asyncio.sleep(2)


async def _legacy_single_price_broadcaster_loop():
    """
    NOTE: since order creation now always targets a specific
    goldbridge_item_id (see routers/orders.py), and this fallback has
    no real item id to offer (simulator/telegram don't have the
    concept), orders can't actually be placed while running in this
    mode - it's display-only. This is an acceptable gap for a
    dev/testing-only price source; production always runs
    GOLDAPP_PRICE_SOURCE=api.
    """
    queue = asyncio.Queue()
    price_service.subscribe(queue)
    try:
        while True:
            price = await queue.get()
            p = price.model_dump()
            card = {
                "goldbridge_item_id": None,
                "name": "قیمت",
                "type": 1,
                "unit": "gram18",
                "item_weight": None,
                "is_primary": True,
                "orderable_buy": True,
                "orderable_sell": True,
                "buy_price": p["buy_price"],
                "sell_price": p["sell_price"],
                "gram18_buy_price": p.get("gram18_buy_price"),
                "gram18_sell_price": p.get("gram18_sell_price"),
            }
            await manager.broadcast_price({"cards": [card], "updated_at": p.get("updated_at")})
    finally:
        price_service.unsubscribe(queue)


# ---------------- ثبت روترها ----------------
# هر روتر مسیرهای خودش رو با app.* تعریف می‌کنه (نه router.* با prefix
# اضافه در اینجا) مگر جایی که در تعریف خود روتر prefix گذاشته شده.

app.include_router(auth.router)
app.include_router(price.router)
app.include_router(notice.router)
app.include_router(calendar.router)
app.include_router(trading_status.router)
app.include_router(orders.router)
app.include_router(receipts.router)
app.include_router(admin_auth.router)
app.include_router(admin_orders.router)
app.include_router(admin_orders.ws_router)
app.include_router(admin_users.router)
app.include_router(admin_roles.router)
app.include_router(admin_prices.router)
app.include_router(admin_accounts.router)
app.include_router(kyc.router)
app.include_router(transfers.router)
app.include_router(admin_price_cards.router)