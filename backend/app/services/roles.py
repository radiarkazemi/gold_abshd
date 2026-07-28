from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models_db import Role, CommissionTypeEnum
from app.gold_conversion import mesghal17_to_gram18
from app.services import price_cards
from app.services.orders import apply_role_pricing_formula

VALID_PRICE_LABEL_MODES = ("mesghal_and_gram18", "gram18_only")


def list_roles(db: Session) -> list[Role]:
    return db.query(Role).order_by(Role.name).all()


def _validate_price_label_mode(mode: str):
    if mode not in VALID_PRICE_LABEL_MODES:
        raise HTTPException(status_code=400, detail="حالت نمایش قیمت نامعتبر است")


def _current_role_amount_limits(
    db: Session,
    commission_type: str,
    commission_value: float,
    min_weight: float | None,
    max_weight: float | None,
    min_amount: float | None,
    max_amount: float | None,
) -> tuple[float | None, float | None]:
    """Auto-fill amount limits from weight limits using the current primary
    gold buy price personalized for this role.

    We only fill missing amount values; explicit admin-entered amounts win.
    """
    if min_amount is not None and max_amount is not None:
        return min_amount, max_amount

    try:
        cards = price_cards.get_enabled_cards_for_broadcast(db)
    except Exception:
        return min_amount, max_amount

    gold_card = next((c for c in cards if c.get("type") == price_cards.GOLD_ITEM_TYPE and c.get("is_primary")), None)
    if not gold_card:
        gold_card = next((c for c in cards if c.get("type") == price_cards.GOLD_ITEM_TYPE), None)
    if not gold_card or gold_card.get("buy_price") is None:
        return min_amount, max_amount

    final_buy_mesghal = apply_role_pricing_formula(
        gold_card["buy_price"],
        "buy",
        commission_type,
        commission_value,
    )
    gram18_buy_price = mesghal17_to_gram18(final_buy_mesghal)

    if min_amount is None and min_weight is not None:
        min_amount = round(min_weight * gram18_buy_price)
    if max_amount is None and max_weight is not None:
        max_amount = round(max_weight * gram18_buy_price)
    return min_amount, max_amount


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
    min_amount, max_amount = _current_role_amount_limits(
        db,
        commission_type,
        commission_value,
        min_weight,
        max_weight,
        min_amount,
        max_amount,
    )

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
    price_label_mode: str | None = None,
) -> Role:
    role = db.query(Role).filter(Role.id == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="نقش پیدا نشد")
    if commission_type not in ("fixed", "percentage"):
        raise HTTPException(status_code=400, detail="نوع کمیسیون نامعتبر است")
    min_amount, max_amount = _current_role_amount_limits(
        db,
        commission_type,
        commission_value,
        min_weight,
        max_weight,
        min_amount,
        max_amount,
    )

    role.commission_type = CommissionTypeEnum(commission_type)
    role.commission_value = commission_value
    role.min_weight = min_weight
    role.max_weight = max_weight
    role.min_amount = min_amount
    role.max_amount = max_amount

    if price_label_mode is not None:
        _validate_price_label_mode(price_label_mode)
        role.price_label_mode = price_label_mode

    db.commit()
    db.refresh(role)
    return role