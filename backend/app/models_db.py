"""
SQLAlchemy table definitions.

Note: `Order` here is the *database* table. The Pydantic classes in
models.py (OrderCreate, Order, etc.) are the API request/response shapes -
those will be updated to read from these tables in a later step.
"""
import uuid
from datetime import datetime

from sqlalchemy import (
    Column,
    String,
    Float,
    DateTime,
    ForeignKey,
    Enum,
    Boolean,
    Text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db import Base
import enum


def gen_uuid():
    return str(uuid.uuid4())


class OrderSideEnum(str, enum.Enum):
    buy = "buy"
    sell = "sell"


class OrderStatusEnum(str, enum.Enum):
    pending = "pending"
    accepted = "accepted"
    rejected = "rejected"


class AmountTypeEnum(str, enum.Enum):
    weight = "weight"
    amount = "amount"


class TransactionReasonEnum(str, enum.Enum):
    order_accepted = "order_accepted"
    admin_adjustment = "admin_adjustment"


class CommissionTypeEnum(str, enum.Enum):
    fixed = "fixed"           # ثابت، مثلا ۱۰,۰۰۰ تومان
    percentage = "percentage"  # درصدی، مثلا ۰.۵٪


class RegistrationKeyStatusEnum(str, enum.Enum):
    pending = "pending"     # صادر شده، هنوز فعال نشده
    active = "active"       # روی یک دستگاه فعال شده
    banned = "banned"


class Role(Base):
    """
    A user category (همکار ویترین دار, خریدار خانگی, ...) with its own
    commission rate. Admin creates/edits these in a separate management
    tab; every new user is assigned one at creation time.
    """

    __tablename__ = "roles"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    name = Column(String, unique=True, nullable=False)
    commission_type = Column(Enum(CommissionTypeEnum),
                             nullable=False, default=CommissionTypeEnum.fixed)
    # تومان اگر fixed, درصد اگر percentage
    commission_value = Column(Float, nullable=False, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

    users = relationship("User", back_populates="role")


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    user_code = Column(String, unique=True, nullable=False,
                       index=True)  # کد کوتاه و یکتای مشتری
    phone_number = Column(String, unique=True, nullable=False, index=True)
    full_name = Column(String, nullable=True)
    national_id = Column(String, nullable=True)   # کد ملی
    notes = Column(Text, nullable=True)            # یادداشت آزاد ادمین

    role_id = Column(UUID(as_uuid=False),
                     ForeignKey("roles.id"), nullable=True)

    is_blocked = Column(Boolean, default=False, nullable=False)

    # Single-device lock: set the first time the user activates their
    # registration key. A random token generated and stored in the
    # browser's localStorage - not a real hardware fingerprint (not
    # possible from a web app), but functionally equivalent: if it's
    # lost (cache cleared, different browser), the account is locked
    # until an admin issues a new registration key.
    device_id = Column(String, nullable=True)
    # user-agent string, informational only
    device_info = Column(String, nullable=True)

    last_seen_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)

    @property
    def is_online(self) -> bool:
        if not self.last_seen_at:
            return False
        return (datetime.utcnow() - self.last_seen_at).total_seconds() < 90

    role = relationship("Role", back_populates="users")
    orders = relationship("Order", back_populates="user")
    transactions = relationship("BalanceTransaction", back_populates="user")
    registration_key = relationship(
        "RegistrationKey", back_populates="user", uselist=False)


class RegistrationKey(Base):
    """
    Issued once by the admin when creating a new user. The user needs
    this key (plus their phone number) to activate their account the
    first time - after that, the key is bound to whichever device
    completed activation and can't be reused elsewhere.
    """

    __tablename__ = "registration_keys"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    key = Column(String, unique=True, nullable=False, index=True)
    user_id = Column(UUID(as_uuid=False), ForeignKey(
        "users.id"), nullable=False)

    status = Column(Enum(RegistrationKeyStatusEnum),
                    default=RegistrationKeyStatusEnum.pending, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    activated_at = Column(DateTime, nullable=True)
    device_id = Column(String, nullable=True)  # set once activated

    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="registration_key")


class Order(Base):
    __tablename__ = "orders"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    user_id = Column(UUID(as_uuid=False),
                     ForeignKey("users.id"), nullable=True)

    side = Column(Enum(OrderSideEnum), nullable=False)
    amount_type = Column(Enum(AmountTypeEnum), nullable=False)
    value = Column(Float, nullable=False)
    description = Column(Text, default="")
    status = Column(Enum(OrderStatusEnum),
                    default=OrderStatusEnum.pending, nullable=False)
    price_at_submit = Column(Float, nullable=False)

    # Path (on disk, relative to the upload directory) to an optional
    # bank-transfer receipt the user attached as proof of payment for a
    # cash order. Never exposed directly to the client - only a boolean
    # "has_receipt" flag is; the actual file is served through an
    # authenticated endpoint that checks the requester owns the order
    # (or is an admin) before streaming it.
    receipt_path = Column(String, nullable=True)

    @property
    def has_receipt(self) -> bool:
        return bool(self.receipt_path)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow,
                        onupdate=datetime.utcnow)

    user = relationship("User", back_populates="orders")


class BalanceTransaction(Base):
    """
    Every balance change - from an accepted order or a manual admin
    adjustment - is logged as a row here. A user's current balance is
    always the SUM of their transactions, never a directly-edited number.
    This keeps a full audit trail.
    """

    __tablename__ = "balance_transactions"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    user_id = Column(UUID(as_uuid=False), ForeignKey(
        "users.id"), nullable=False)

    gold_change = Column(Float, default=0)   # مثقال - positive or negative
    cash_change = Column(Float, default=0)   # تومان - positive or negative
    reason = Column(Enum(TransactionReasonEnum), nullable=False)
    # e.g. admin's reason for manual adjustment
    note = Column(Text, default="")
    related_order_id = Column(
        UUID(as_uuid=False), ForeignKey("orders.id"), nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="transactions")


class Holiday(Base):
    """
    Admin-managed list of non-trading days beyond the regular weekend
    (Nowruz, religious holidays, etc.). Iranian religious holidays shift
    every Gregorian year (lunar calendar) so they can't be computed with
    a formula - the admin adds/removes specific dates here.
    """

    __tablename__ = "holidays"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    # stored as midnight of that Gregorian date
    date = Column(DateTime, nullable=False, unique=True)
    description = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class OtpCode(Base):
    """Short-lived OTP codes for phone login."""

    __tablename__ = "otp_codes"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    phone_number = Column(String, nullable=False, index=True)
    code = Column(String, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    is_used = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class AppSetting(Base):
    """
    Generic key-value store for small pieces of runtime-editable config -
    things the admin should be able to change without a redeploy. Right
    now only "notice_text" is used (the note shown under the prices on
    the main screen), but this table can hold future settings the same
    way without new migrations each time.
    """

    __tablename__ = "app_settings"

    key = Column(String, primary_key=True)
    value = Column(Text, nullable=False, default="")
    updated_at = Column(DateTime, default=datetime.utcnow,
                        onupdate=datetime.utcnow)
