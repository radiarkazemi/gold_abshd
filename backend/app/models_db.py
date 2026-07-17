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
    cancelled = "cancelled"  # customer cancelled it themselves, while still pending


class AmountTypeEnum(str, enum.Enum):
    weight = "weight"
    amount = "amount"


class TransactionReasonEnum(str, enum.Enum):
    order_accepted = "order_accepted"
    admin_adjustment = "admin_adjustment"
    transfer_request = "transfer_request"


class CommissionTypeEnum(str, enum.Enum):
    fixed = "fixed"           # ثابت، مثلا ۱۰,۰۰۰ تومان
    percentage = "percentage"  # درصدی، مثلا ۰.۵٪


class TransferStatusEnum(str, enum.Enum):
    pending = "pending"
    accepted = "accepted"
    rejected = "rejected"


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

    # KYC (احراز هویت) - customer submits a document photo for review;
    # admin approves or rejects. "none" until the customer submits once.
    # none | pending | approved | rejected
    kyc_status = Column(String, nullable=False, default="none")
    kyc_document_path = Column(String, nullable=True)
    kyc_submitted_at = Column(DateTime, nullable=True)
    kyc_reviewed_at = Column(DateTime, nullable=True)
    kyc_reject_reason = Column(String, nullable=True)

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
    # گرم۱۸ price (commission-adjusted), used for balance math
    price_at_submit = Column(Float, nullable=False)
    # raw مثقال۱۷ quote at submit time, for display only
    mesghal17_price_at_submit = Column(Float, nullable=True)
    # True for حواله تلفنی (admin-entered) orders
    is_manual = Column(Boolean, default=False, nullable=False)

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


class TransferRequest(Base):
    """
    ثبت حواله: a customer notifies the shop of a bank transfer they've
    already made (amount, bank reference/tracking number, date, and
    optionally a receipt image) so the admin can review and credit
    their cash balance - distinct from an Order's receipt, which is
    tied to a specific buy/sell already in progress. This is for
    topping up account balance independent of any particular order.
    """

    __tablename__ = "transfer_requests"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    user_id = Column(UUID(as_uuid=False), ForeignKey(
        "users.id"), nullable=False)
    amount = Column(Float, nullable=False)  # تومان
    bank_reference = Column(String, nullable=True)  # شماره پیگیری / کد رهگیری
    # customer-entered, Jalali string
    transfer_date = Column(String, nullable=True)
    description = Column(Text, nullable=True)
    receipt_path = Column(String, nullable=True)
    status = Column(Enum(TransferStatusEnum),
                    default=TransferStatusEnum.pending, nullable=False)
    admin_note = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    reviewed_at = Column(DateTime, nullable=True)

    user = relationship("User")


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


class AdminUser(Base):
    """
    A sub-admin account (accountant, manager, etc), created by the one
    super-admin (whose own credentials still live in .env, unchanged -
    see admin_auth.py). Each sub-admin has their own username/password
    and a list of permission scopes limiting which admin panel sections
    they can use. The super-admin themselves does NOT have a row here -
    they're identified purely by is_super=True in their JWT.

    Login is two-step, same spirit as the customer OTP flow: username +
    password first, then an SMS code sent to phone_number. On a
    sub-admin's very first login, registration_key must also be
    supplied (handed to them by the super-admin at creation time) -
    after that, activated_at is set and only the OTP step is needed
    going forward.
    """

    __tablename__ = "admin_users"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    username = Column(String, unique=True, nullable=False, index=True)
    password_hash = Column(String, nullable=False)
    full_name = Column(String, nullable=True)
    phone_number = Column(String, unique=True, nullable=True, index=True)
    national_id = Column(String, nullable=True)
    # JSON list of scope strings
    permissions = Column(Text, nullable=False, default="[]")
    is_active = Column(Boolean, default=True)
    # username of the super-admin who created this row
    created_by = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_login_at = Column(DateTime, nullable=True)

    # First-activation registration key (like the customer flow) -
    # shown once to the super-admin at creation time, consumed on the
    # sub-admin's first successful login.
    registration_key = Column(String, nullable=True)
    registration_key_expires_at = Column(DateTime, nullable=True)
    activated_at = Column(DateTime, nullable=True)


class AdminActivityLog(Base):
    """
    Audit trail of admin actions, so the super-admin can see what each
    sub-admin has actually done. actor is the username (works for both
    the env-based super-admin and AdminUser rows, so this table doesn't
    need a nullable FK for the super-admin case).
    """

    __tablename__ = "admin_activity_log"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    actor_username = Column(String, nullable=False, index=True)
    is_super = Column(Boolean, default=False)
    action = Column(String, nullable=False)
    detail = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
