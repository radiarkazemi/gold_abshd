"""
App configuration, loaded from environment variables (.env file).

All variables use a GOLDAPP_ prefix on purpose - this avoids collisions
with unrelated environment variables that might already exist on a
developer's machine (e.g. a leftover DB_NAME from a different old
project set at the Windows system level, which would silently override
plain "DB_NAME" here since real environment variables always take
priority over .env file values).
"""
import os
from dotenv import load_dotenv

load_dotenv()


class Settings:
    # Postgres connection - the "maintenance" connection (to the default
    # postgres db) is used only once at startup to create our app database
    # if it doesn't exist yet.
    DB_HOST: str = os.getenv("GOLDAPP_DB_HOST", "localhost")
    DB_PORT: str = os.getenv("GOLDAPP_DB_PORT", "5432")
    DB_USER: str = os.getenv("GOLDAPP_DB_USER", "postgres")
    DB_PASSWORD: str = os.getenv("GOLDAPP_DB_PASSWORD", "")
    DB_NAME: str = os.getenv("GOLDAPP_DB_NAME", "goldapp")

    JWT_SECRET: str = os.getenv("GOLDAPP_JWT_SECRET", "dev-secret-change-me")
    JWT_EXPIRE_MINUTES: int = int(
        os.getenv("GOLDAPP_JWT_EXPIRE_MINUTES", "43200"))  # 30 days

    # When true, the OTP code is printed to the server console AND returned
    # in the API response, so you can test without a real SMS provider.
    # Set to false once a real SMS provider (Kavenegar/Ghasedak) is wired up.
    DEBUG_OTP: bool = os.getenv("GOLDAPP_DEBUG_OTP", "true").lower() == "true"

    # Order size limits, in مثقال ۱۷. Orders placed in تومان are converted
    # to their مثقال equivalent (using the price at submit time) before
    # being checked against these bounds.
    # Order size limits, in گرم ۱۸ (NOT مثقال - orders are tracked in گرم۱۸
    # even though the price feed itself is quoted per مثقال۱۷; the
    # conversion happens automatically). Orders placed in تومان are
    # converted to their گرم۱۸ equivalent before being checked against these.
    MIN_ORDER_WEIGHT: float = float(os.getenv("GOLDAPP_MIN_ORDER_WEIGHT", "1"))
    MAX_ORDER_WEIGHT: float = float(
        os.getenv("GOLDAPP_MAX_ORDER_WEIGHT", "200"))

    # Admin login. ADMIN_PASSWORD_HASH is a bcrypt hash - never store the
    # plain password. Generate one with:
    #   python -c "import bcrypt; print(bcrypt.hashpw(b'yourpassword', bcrypt.gensalt()).decode())"
    ADMIN_USERNAME: str = os.getenv("GOLDAPP_ADMIN_USERNAME", "admin")

    # Comma-separated list of allowed frontend origins for CORS. Defaults
    # to common local dev ports so nothing breaks locally - MUST be set
    # to your real production domain(s) (e.g. "https://yourdomain.com")
    # before deploying, or the API will reject requests from your live
    # frontend.
    _origins_raw: str = os.getenv(
        "GOLDAPP_ALLOWED_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000",
    )

    @property
    def ALLOWED_ORIGINS(self) -> list[str]:
        return [o.strip() for o in self._origins_raw.split(",") if o.strip()]
    ADMIN_PASSWORD_HASH: str = os.getenv("GOLDAPP_ADMIN_PASSWORD_HASH", "")

    # Which weekdays are non-trading days, as Python weekday() numbers
    # (Monday=0 ... Sunday=6). Default: Friday only (4). Add Thursday (3)
    # too with "3,4" if this business also closes Thursdays.
    WEEKEND_DAYS: str = os.getenv("GOLDAPP_WEEKEND_DAYS", "4")

    # After this hour (24h, local server time), a trade placed "today"
    # settles one trading day LATER than it would before this hour.
    SETTLEMENT_CUTOFF_HOUR: int = int(
        os.getenv("GOLDAPP_SETTLEMENT_CUTOFF_HOUR", "13"))

    @property
    def WEEKEND_DAYS_SET(self) -> set[int]:
        return {int(d) for d in self.WEEKEND_DAYS.split(",") if d.strip()}

    # Which price source to use: "simulator" (fake, for local dev),
    # "telegram" (read a Telegram channel, for testing with a real feed),
    # or "api" (poll a real HTTP API, for production).
    PRICE_SOURCE: str = os.getenv("GOLDAPP_PRICE_SOURCE", "simulator")

    # --- Telegram source settings ---
    TG_API_ID: str = os.getenv("GOLDAPP_TG_API_ID", "")
    TG_API_HASH: str = os.getenv("GOLDAPP_TG_API_HASH", "")
    TG_SESSION_NAME: str = os.getenv(
        "GOLDAPP_TG_SESSION_NAME", "goldapp_price_session")
    TG_CHANNEL: str = os.getenv("GOLDAPP_TG_CHANNEL", "")
    # The number to extract. Real channel messages look like:
    #   **77,950,000**⏳باحواله🔵خرید
    #   گرم: **17,994,828**
    # The default regex grabs the FIRST bold number (the leading price,
    # not the گرم one on the second line) - re.search always matches the
    # leftmost occurrence, which is exactly the one we want here.
    # Each message is checked for the buy/sell keyword to decide which
    # price it's reporting; messages with neither (or both) are skipped
    # (e.g. a "معامله"/trade-executed post isn't a buy or sell quote).
    TG_PRICE_REGEX: str = os.getenv(
        "GOLDAPP_TG_PRICE_REGEX", r"\*\*([\d,]+)\*\*")
    # The channel also reports its own real گرم۱۸ price directly in each
    # message - we use that number as-is instead of computing an
    # approximation, since it's guaranteed to match the source exactly.
    TG_GRAM18_REGEX: str = os.getenv(
        "GOLDAPP_TG_GRAM18_REGEX", r"گرم:[^\d]*([\d,]+)")
    TG_BUY_KEYWORD: str = os.getenv("GOLDAPP_TG_BUY_KEYWORD", "خرید")
    TG_SELL_KEYWORD: str = os.getenv("GOLDAPP_TG_SELL_KEYWORD", "فروش")

    # Proxy for the Telegram connection (needed if Telegram is blocked on
    # this network, e.g. via V2rayN or any other local SOCKS5/HTTP proxy).
    # V2rayN's default local SOCKS5 port is usually 10808 - check your
    # V2rayN "Parameter setting" / "Local port" field if unsure.
    TG_PROXY_ENABLED: bool = os.getenv(
        "GOLDAPP_TG_PROXY_ENABLED", "false").lower() == "true"
    TG_PROXY_TYPE: str = os.getenv(
        "GOLDAPP_TG_PROXY_TYPE", "socks5")  # socks5, socks4, or http
    TG_PROXY_HOST: str = os.getenv("GOLDAPP_TG_PROXY_HOST", "127.0.0.1")
    TG_PROXY_PORT: int = int(os.getenv("GOLDAPP_TG_PROXY_PORT", "10808"))

    # --- HTTP API source settings ---
    PRICE_API_URL: str = os.getenv("GOLDAPP_PRICE_API_URL", "")
    PRICE_API_KEY: str = os.getenv("GOLDAPP_PRICE_API_KEY", "")
    PRICE_API_BUY_PATH: str = os.getenv("GOLDAPP_PRICE_API_BUY_PATH", "buy")
    PRICE_API_SELL_PATH: str = os.getenv("GOLDAPP_PRICE_API_SELL_PATH", "sell")
    PRICE_API_POLL_SECONDS: int = int(
        os.getenv("GOLDAPP_PRICE_API_POLL_SECONDS", "5"))

    # Receipt uploads (proof of bank transfer / حواله for cash orders)
    UPLOAD_DIR: str = os.getenv("GOLDAPP_UPLOAD_DIR", "uploads/receipts")
    MAX_RECEIPT_SIZE_MB: int = int(
        os.getenv("GOLDAPP_MAX_RECEIPT_SIZE_MB", "5"))
    ALLOWED_RECEIPT_EXTENSIONS: set = {
        ".jpg", ".jpeg", ".png", ".pdf", ".webp"}

    @property
    def DATABASE_URL(self) -> str:
        return (
            f"postgresql+psycopg2://{self.DB_USER}:{self.DB_PASSWORD}"
            f"@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"
        )

    @property
    def MAINTENANCE_DATABASE_URL(self) -> str:
        """Connects to the default 'postgres' db, used only to create our db."""
        return (
            f"postgresql+psycopg2://{self.DB_USER}:{self.DB_PASSWORD}"
            f"@{self.DB_HOST}:{self.DB_PORT}/postgres"
        )


settings = Settings()
