from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models_db import Role, CommissionTypeEnum


def list_roles(db: Session) -> list[Role]:
    return db.query(Role).order_by(Role.name).all()


def create_role(db: Session, name: str, commission_type: str, commission_value: float) -> Role:
    if commission_type not in ("fixed", "percentage"):
        raise HTTPException(status_code=400, detail="نوع کمیسیون نامعتبر است")
    if db.query(Role).filter(Role.name == name).first():
        raise HTTPException(
            status_code=400, detail="نقشی با این نام قبلا ثبت شده است")

    role = Role(
        name=name,
        commission_type=CommissionTypeEnum(commission_type),
        commission_value=commission_value,
    )
    db.add(role)
    db.commit()
    db.refresh(role)
    return role


def update_role_commission(db: Session, role_id: str, commission_type: str, commission_value: float) -> Role:
    role = db.query(Role).filter(Role.id == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="نقش پیدا نشد")
    if commission_type not in ("fixed", "percentage"):
        raise HTTPException(status_code=400, detail="نوع کمیسیون نامعتبر است")

    role.commission_type = CommissionTypeEnum(commission_type)
    role.commission_value = commission_value
    db.commit()
    db.refresh(role)
    return role
