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


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    phone_number = Column(String, unique=True, nullable=False, index=True)
    full_name = Column(String, nullable=True)
    is_blocked = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    orders = relationship("Order", back_populates="user")
    transactions = relationship("BalanceTransaction", back_populates="user")


class Order(Base):
    __tablename__ = "orders"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    user_id = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=True)

    side = Column(Enum(OrderSideEnum), nullable=False)
    amount_type = Column(Enum(AmountTypeEnum), nullable=False)
    value = Column(Float, nullable=False)
    description = Column(Text, default="")
    status = Column(Enum(OrderStatusEnum), default=OrderStatusEnum.pending, nullable=False)
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
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

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
    user_id = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=False)

    gold_change = Column(Float, default=0)   # مثقال - positive or negative
    cash_change = Column(Float, default=0)   # تومان - positive or negative
    reason = Column(Enum(TransactionReasonEnum), nullable=False)
    note = Column(Text, default="")          # e.g. admin's reason for manual adjustment
    related_order_id = Column(UUID(as_uuid=False), ForeignKey("orders.id"), nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="transactions")


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
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)