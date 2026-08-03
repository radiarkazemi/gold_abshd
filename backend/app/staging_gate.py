"""Staging-environment access helpers."""
from __future__ import annotations

from fastapi import HTTPException

from app.config import settings


def assert_staging_admin_allowed(username: str | None) -> None:
    """On staging, only allowlisted main admins may use the admin panel."""
    if not settings.IS_STAGING:
        return
    name = (username or "").strip()
    if name not in settings.STAGING_ALLOWED_ADMINS:
        raise HTTPException(
            status_code=403,
            detail="دسترسی محیط آزمایشی فقط برای مدیران اصلی مجاز است",
        )


def staging_env_label() -> str:
    return settings.APP_ENV or "development"
