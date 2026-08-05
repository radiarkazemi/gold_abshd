from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.admin_auth import require_permission
from app.models_db import Order, BalanceTransaction, User
from app.schemas.admin import (
    UserSummaryOut, UserDetailOut, TransactionOut, BalanceAdjustIn, BlockUserIn,
    TradingBanUserIn, AdminCreateUserIn, AdminCreateUserOut, AdminUpdateUserIn,
    TermsAcceptanceSummaryOut,
)
from app.services.registration import create_user_with_key, delete_user
from app.services.devices import list_user_devices, revoke_user_device, count_user_devices
from app.services.terms import list_user_terms_acceptances, acceptance_to_dict
from app.services.orders import (
    get_user_balance,
    get_user_or_404,
    list_users_with_balance,
    adjust_balance as adjust_balance_db,
    set_user_blocked,
    set_user_trading_banned,
    update_user as update_user_db,
)

router = APIRouter(prefix="/api/admin/users", tags=["admin-users"])


def _user_summary(db: Session, user: User) -> UserSummaryOut:
    balance = get_user_balance(db, user.id)
    reg_key = user.registration_key
    return UserSummaryOut(
        id=user.id,
        user_code=user.user_code,
        phone_number=user.phone_number,
        full_name=user.full_name,
        is_blocked=user.is_blocked,
        is_trading_banned=user.is_trading_banned,
        created_at=user.created_at,
        gold_balance=balance["gold_balance"],
        cash_balance=balance["cash_balance"],
        role=user.role,
        is_online=user.is_online,
        registration_status=reg_key.status.value if reg_key else None,
        referrer=user.referrer,
        max_devices=user.max_devices or 1,
        device_count=count_user_devices(db, user),
    )


@router.post("", response_model=AdminCreateUserOut)
async def create_user(payload: AdminCreateUserIn, db: Session = Depends(get_db), _admin=Depends(require_permission("add-user"))):
    user, reg_key = create_user_with_key(
        db,
        phone_number=payload.phone_number,
        full_name=payload.full_name,
        role_id=payload.role_id,
        national_id=payload.national_id,
        notes=payload.notes,
        referrer=payload.referrer,
        key_ttl_days=payload.key_ttl_days,
        max_devices=payload.max_devices,
    )
    return AdminCreateUserOut(
        user_id=user.id,
        user_code=user.user_code,
        phone_number=user.phone_number,
        registration_key=reg_key.key,
        expires_at=reg_key.expires_at,
        max_devices=user.max_devices or 1,
    )


@router.get("", response_model=list[UserSummaryOut])
async def list_users(search: str | None = None, db: Session = Depends(get_db), _admin=Depends(require_permission("users"))):
    return list_users_with_balance(db, search)


@router.get("/{user_id}", response_model=UserDetailOut)
async def get_user_detail(user_id: str, db: Session = Depends(get_db), _admin=Depends(require_permission("users"))):
    user = get_user_or_404(db, user_id)
    balance = get_user_balance(db, user_id)

    orders = (
        db.query(Order)
        .filter(Order.user_id == user_id)
        .order_by(Order.created_at.desc())
        .all()
    )
    transactions = (
        db.query(BalanceTransaction)
        .filter(BalanceTransaction.user_id == user_id)
        .order_by(BalanceTransaction.created_at.desc())
        .all()
    )

    return UserDetailOut(
        id=user.id,
        user_code=user.user_code,
        phone_number=user.phone_number,
        full_name=user.full_name,
        national_id=user.national_id,
        notes=user.notes,
        is_blocked=user.is_blocked,
        is_trading_banned=user.is_trading_banned,
        referrer=user.referrer,
        created_at=user.created_at,
        gold_balance=balance["gold_balance"],
        cash_balance=balance["cash_balance"],
        role=user.role,
        is_online=user.is_online,
        device_info=user.device_info,
        max_devices=user.max_devices or 1,
        devices=list_user_devices(db, user),
        registration_key=user.registration_key,
        terms_acceptances=[
            TermsAcceptanceSummaryOut(**acceptance_to_dict(row))
            for row in list_user_terms_acceptances(db, user_id)
        ],
        orders=orders,
        transactions=transactions,
    )


@router.post("/{user_id}/adjust-balance", response_model=TransactionOut)
async def adjust_user_balance(user_id: str, payload: BalanceAdjustIn, db: Session = Depends(get_db), _admin=Depends(require_permission("users"))):
    txn = adjust_balance_db(db, user_id, payload.gold_change,
                            payload.cash_change, payload.note)
    return txn


@router.post("/{user_id}/block", response_model=UserSummaryOut)
async def block_user(user_id: str, payload: BlockUserIn, db: Session = Depends(get_db), _admin=Depends(require_permission("users"))):
    user = set_user_blocked(db, user_id, payload.is_blocked)
    return _user_summary(db, user)


@router.post("/{user_id}/trading-ban", response_model=UserSummaryOut)
async def ban_user_trading(user_id: str, payload: TradingBanUserIn, db: Session = Depends(get_db), _admin=Depends(require_permission("users"))):
    user = set_user_trading_banned(db, user_id, payload.is_trading_banned)
    return _user_summary(db, user)


@router.patch("/{user_id}", response_model=UserSummaryOut)
async def edit_user(user_id: str, payload: AdminUpdateUserIn, db: Session = Depends(get_db), _admin=Depends(require_permission("users"))):
    user = update_user_db(
        db, user_id, payload.full_name, payload.role_id,
        payload.national_id, payload.notes, payload.referrer, payload.max_devices,
    )
    return _user_summary(db, user)


@router.delete("/{user_id}")
async def remove_user(user_id: str, db: Session = Depends(get_db), _admin=Depends(require_permission("users"))):
    delete_user(db, user_id)
    return {"ok": True}


@router.delete("/{user_id}/devices/{device_row_id}")
async def remove_user_device(
    user_id: str,
    device_row_id: str,
    db: Session = Depends(get_db),
    _admin=Depends(require_permission("users")),
):
    user = get_user_or_404(db, user_id)
    revoke_user_device(db, user, device_row_id)
    return {"ok": True, "devices": list_user_devices(db, user)}
