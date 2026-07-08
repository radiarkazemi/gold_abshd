"""
App configuration, loaded from environment variables (.env file).
"""
import os
from dotenv import load_dotenv

load_dotenv()


class Settings:
    # Postgres connection - the "maintenance" connection (to the default
    # postgres db) is used only once at startup to create our app database
    # if it doesn't exist yet.
    DB_HOST: str = os.getenv("DB_HOST", "localhost")
    DB_PORT: str = os.getenv("DB_PORT", "5432")
    DB_USER: str = os.getenv("DB_USER", "postgres")
    DB_PASSWORD: str = os.getenv("DB_PASSWORD", "")
    DB_NAME: str = os.getenv("DB_NAME", "goldapp")

    JWT_SECRET: str = os.getenv("JWT_SECRET", "dev-secret-change-me")
    JWT_EXPIRE_MINUTES: int = int(os.getenv("JWT_EXPIRE_MINUTES", "43200"))  # 30 days

    # When true, the OTP code is printed to the server console AND returned
    # in the API response, so you can test without a real SMS provider.
    # Set to false once a real SMS provider (Kavenegar/Ghasedak) is wired up.
    DEBUG_OTP: bool = os.getenv("DEBUG_OTP", "true").lower() == "true"

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