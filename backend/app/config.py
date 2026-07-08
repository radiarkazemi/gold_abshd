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
    MIN_ORDER_WEIGHT: float = float(
        os.getenv("GOLDAPP_MIN_ORDER_WEIGHT", "0.1"))
    MAX_ORDER_WEIGHT: float = float(
        os.getenv("GOLDAPP_MAX_ORDER_WEIGHT", "50"))

    # Admin login. ADMIN_PASSWORD_HASH is a bcrypt hash - never store the
    # plain password. Generate one with:
    #   python -c "import bcrypt; print(bcrypt.hashpw(b'yourpassword', bcrypt.gensalt()).decode())"
    ADMIN_USERNAME: str = os.getenv("GOLDAPP_ADMIN_USERNAME", "admin")
    ADMIN_PASSWORD_HASH: str = os.getenv("GOLDAPP_ADMIN_PASSWORD_HASH", "")

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
