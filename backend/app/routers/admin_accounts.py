from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.admin_auth import require_super_admin
from app.permissions import PERMISSION_SCOPES
from app.schemas.admin_accounts import (
    AdminUserCreateIn,
    AdminUserUpdateIn,
    AdminUserOut,
    AdminActivityLogOut,
    PermissionScopeOut,
)
from app.services.admin_accounts import (
    create_sub_admin,
    list_sub_admins,
    update_sub_admin,
    delete_sub_admin,
    admin_user_permissions,
    log_activity,
    list_activity,
)

router = APIRouter(prefix="/api/admin/admins", tags=["admin-accounts"])


def _to_out(row) -> AdminUserOut:
    return AdminUserOut(
        id=row.id,
        username=row.username,
        full_name=row.full_name,
        phone_number=row.phone_number,
        national_id=row.national_id,
        permissions=admin_user_permissions(row),
        is_active=row.is_active,
        activated=row.activated_at is not None,
        registration_key=row.registration_key,
        registration_key_expires_at=row.registration_key_expires_at,
        created_by=row.created_by,
        created_at=row.created_at,
        last_login_at=row.last_login_at,
    )


@router.get("/permission-scopes", response_model=list[PermissionScopeOut])
async def get_permission_scopes(_admin=Depends(require_super_admin)):
    return [PermissionScopeOut(key=k, label=v) for k, v in PERMISSION_SCOPES.items()]


@router.get("", response_model=list[AdminUserOut])
async def get_sub_admins(db: Session = Depends(get_db), _admin=Depends(require_super_admin)):
    return [_to_out(r) for r in list_sub_admins(db)]


@router.post("", response_model=AdminUserOut)
async def create_sub_admin_endpoint(
    payload: AdminUserCreateIn,
    db: Session = Depends(get_db),
    admin=Depends(require_super_admin),
):
    try:
        row = create_sub_admin(
            db,
            username=payload.username,
            password=payload.password,
            full_name=payload.full_name,
            phone_number=payload.phone_number,
            national_id=payload.national_id,
            permissions=payload.permissions,
            created_by=admin["username"],
            key_ttl_days=payload.key_ttl_days,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    log_activity(db, admin["username"], True, "create_admin_user",
                 f"created sub-admin '{payload.username}'")
    return _to_out(row)


@router.patch("/{admin_user_id}", response_model=AdminUserOut)
async def update_sub_admin_endpoint(
    admin_user_id: str,
    payload: AdminUserUpdateIn,
    db: Session = Depends(get_db),
    admin=Depends(require_super_admin),
):
    try:
        row = update_sub_admin(
            db,
            admin_user_id,
            full_name=payload.full_name,
            permissions=payload.permissions,
            is_active=payload.is_active,
            new_password=payload.new_password,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    log_activity(db, admin["username"], True, "update_admin_user",
                 f"updated sub-admin '{row.username}'")
    return _to_out(row)


@router.delete("/{admin_user_id}")
async def delete_sub_admin_endpoint(
    admin_user_id: str,
    db: Session = Depends(get_db),
    admin=Depends(require_super_admin),
):
    delete_sub_admin(db, admin_user_id)
    log_activity(db, admin["username"], True, "delete_admin_user",
                 f"deleted sub-admin id={admin_user_id}")
    return {"ok": True}


@router.get("/activity", response_model=list[AdminActivityLogOut])
async def get_activity(
    limit: int = 200,
    db: Session = Depends(get_db),
    _admin=Depends(require_super_admin),
):
    return list_activity(db, limit=limit)
