from datetime import datetime

from pydantic import BaseModel


class AdminUserCreateIn(BaseModel):
    username: str
    password: str
    full_name: str
    phone_number: str
    national_id: str
    permissions: list[str] = []
    key_ttl_days: int = 14


class AdminUserUpdateIn(BaseModel):
    full_name: str | None = None
    permissions: list[str] | None = None
    is_active: bool | None = None
    new_password: str | None = None


class AdminUserOut(BaseModel):
    id: str
    username: str
    full_name: str | None = None
    phone_number: str | None = None
    national_id: str | None = None
    permissions: list[str]
    is_active: bool
    activated: bool
    registration_key: str | None = None
    registration_key_expires_at: datetime | None = None
    created_by: str | None = None
    created_at: datetime
    last_login_at: datetime | None = None

    class Config:
        from_attributes = True


class AdminActivityLogOut(BaseModel):
    id: str
    actor_username: str
    is_super: bool
    action: str
    detail: str | None = None
    created_at: datetime

    class Config:
        from_attributes = True


class PermissionScopeOut(BaseModel):
    key: str
    label: str
