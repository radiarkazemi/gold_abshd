from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.admin_auth import get_current_admin, require_permission
from app.schemas.admin import RoleOut, RoleCreateIn, RoleUpdateIn
from app.services.roles import list_roles, create_role, update_role_commission

router = APIRouter(prefix="/api/admin/roles", tags=["admin-roles"])


@router.get("", response_model=list[RoleOut])
async def get_roles(db: Session = Depends(get_db), _admin=Depends(require_permission("roles"))):
    return list_roles(db)


@router.post("", response_model=RoleOut)
async def add_role(payload: RoleCreateIn, db: Session = Depends(get_db), _admin=Depends(require_permission("roles"))):
    return create_role(
        db, payload.name, payload.commission_type, payload.commission_value,
        min_weight=payload.min_weight, max_weight=payload.max_weight,
        min_amount=payload.min_amount, max_amount=payload.max_amount,
        price_label_mode=payload.price_label_mode,
    )


@router.patch("/{role_id}", response_model=RoleOut)
async def edit_role_commission(role_id: str, payload: RoleUpdateIn, db: Session = Depends(get_db), _admin=Depends(require_permission("roles"))):
    return update_role_commission(
        db, role_id, payload.commission_type, payload.commission_value,
        min_weight=payload.min_weight, max_weight=payload.max_weight,
        min_amount=payload.min_amount, max_amount=payload.max_amount,
        price_label_mode=payload.price_label_mode,
    )