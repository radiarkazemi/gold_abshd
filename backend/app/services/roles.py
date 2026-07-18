from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models_db import Role, CommissionTypeEnum

VALID_PRICE_LABEL_MODES = ("mesghal_and_gram18", "gram18_only")


def list_roles(db: Session) -> list[Role]:
    return db.query(Role).order_by(Role.name).all()


def _validate_price_label_mode(mode: str):
    if mode not in VALID_PRICE_LABEL_MODES:
        raise HTTPException(status_code=400, detail="حالت نمایش قیمت نامعتبر است")


def create_role(
    db: Session, name: str, commission_type: str, commission_value: float,
    min_weight: float | None = None, max_weight: float | None = None,
    min_amount: float | None = None, max_amount: float | None = None,
    price_label_mode: str = "mesghal_and_gram18",
) -> Role:
    if commission_type not in ("fixed", "percentage"):
        raise HTTPException(status_code=400, detail="نوع کمیسیون نامعتبر است")
    if db.query(Role).filter(Role.name == name).first():
        raise HTTPException(status_code=400, detail="نقشی با این نام قبلا ثبت شده است")
    _validate_price_label_mode(price_label_mode)

    role = Role(
        name=name,
        commission_type=CommissionTypeEnum(commission_type),
        commission_value=commission_value,
        min_weight=min_weight,
        max_weight=max_weight,
        min_amount=min_amount,
        max_amount=max_amount,
        price_label_mode=price_label_mode,
    )
    db.add(role)
    db.commit()
    db.refresh(role)
    return role


def update_role_commission(
    db: Session, role_id: str, commission_type: str, commission_value: float,
    min_weight: float | None = None, max_weight: float | None = None,
    min_amount: float | None = None, max_amount: float | None = None,
    price_label_mode: str = "mesghal_and_gram18",
) -> Role:
    role = db.query(Role).filter(Role.id == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="نقش پیدا نشد")
    if commission_type not in ("fixed", "percentage"):
        raise HTTPException(status_code=400, detail="نوع کمیسیون نامعتبر است")
    _validate_price_label_mode(price_label_mode)

    role.commission_type = CommissionTypeEnum(commission_type)
    role.commission_value = commission_value
    role.min_weight = min_weight
    role.max_weight = max_weight
    role.min_amount = min_amount
    role.max_amount = max_amount
    role.price_label_mode = price_label_mode
    db.commit()
    db.refresh(role)
    return role