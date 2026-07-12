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
from app.ws_manager import manager
from app.db import init_db
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
    asyncio.create_task(price_broadcaster())


async def price_broadcaster():
    """قیمت فعلی رو دائم برای همه کلاینت‌های وصل‌شده پخش می‌کنه"""
    queue = asyncio.Queue()
    price_service.subscribe(queue)
    try:
        while True:
            price = await queue.get()
            await manager.broadcast_price(price.model_dump())
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