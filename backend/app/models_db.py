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
    Integer,
    Float,
    DateTime,
    ForeignKey,
    Enum,
    Boolean,
    Text,
    UniqueConstraint,
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
    weight = "weight"   # گرم۱۸ - gold items
    amount = "amount"   # تومان - gold items
    count = "count"     # تعداد - coin items, no گرم/تومان conversion


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

    Also carries two per-category display/limit overrides:
      - min/max weight and amount: overrides the app-wide order limits
        (see services/order_limits.py) for users in this role. Null =
        inherit the global default for that field.
      - price_label_mode: whether users in this role see both مثقال۱۷
        and گرم۱۸ prices, or only گرم۱۸ - e.g. a "خانگی" (home/retail)
        category that doesn't deal in مثقال has no reason to see it.
    """

    __tablename__ = "roles"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    name = Column(String, unique=True, nullable=False)
    commission_type = Column(Enum(CommissionTypeEnum), nullable=False, default=CommissionTypeEnum.fixed)
    commission_value = Column(Float, nullable=False, default=0)  # تومان اگر fixed, درصد اگر percentage
    created_at = Column(DateTime, default=datetime.utcnow)

    # Per-role order limit overrides - null means "use the global default"
    min_weight = Column(Float, nullable=True)
    max_weight = Column(Float, nullable=True)
    min_amount = Column(Float, nullable=True)
    max_amount = Column(Float, nullable=True)

    # "mesghal_and_gram18" | "gram18_only"
    price_label_mode = Column(String, nullable=False, default="mesghal_and_gram18")

    users = relationship("User", back_populates="role")


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    user_code = Column(String, unique=True, nullable=False, index=True)  # کد کوتاه و یکتای مشتری
    phone_number = Column(String, unique=True, nullable=False, index=True)
    full_name = Column(String, nullable=True)
    national_id = Column(String, nullable=True)   # کد ملی
    notes = Column(Text, nullable=True)            # یادداشت آزاد ادمین

    role_id = Column(UUID(as_uuid=False), ForeignKey("roles.id"), nullable=True)

    is_blocked = Column(Boolean, default=False, nullable=False)
    is_trading_banned = Column(Boolean, default=False, nullable=False)  # can log in / view prices, but cannot submit orders
    referrer = Column(String, nullable=True)  # معرف - freeform source/person who introduced this customer

    # Legacy single-device fields kept for older installs / display.
    # Authoritative device list is user_devices; max_devices caps how
    # many distinct browser/app installs may log in after activation.
    device_id = Column(String, nullable=True)
    device_info = Column(String, nullable=True)  # user-agent string, informational only
    max_devices = Column(Integer, nullable=False, default=1)

    last_seen_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)

    # KYC (احراز هویت) — three document photos required before trading.
    # Status: none → pending → approved | rejected
    kyc_status = Column(String, nullable=False, default="none")
    kyc_document_path = Column(String, nullable=True)  # legacy single-doc path
    kyc_id_front_path = Column(String, nullable=True)
    kyc_id_back_path = Column(String, nullable=True)
    kyc_birth_cert_path = Column(String, nullable=True)
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
    registration_key = relationship("RegistrationKey", back_populates="user", uselist=False)
    devices = relationship("UserDevice", back_populates="user", cascade="all, delete-orphan")


class UserDevice(Base):
    """
    One row per browser/app install that has successfully logged in for
    this user. After first activation (registration key), additional
    devices may log in until count reaches User.max_devices.
    """

    __tablename__ = "user_devices"
    __table_args__ = (
        UniqueConstraint("user_id", "device_id", name="uq_user_devices_user_device"),
    )

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    user_id = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=False, index=True)
    device_id = Column(String, nullable=False, index=True)
    device_info = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_seen_at = Column(DateTime, nullable=True)

    user = relationship("User", back_populates="devices")


class RegistrationKey(Base):
    """
    Issued once by the admin when creating a new user. The user needs
    this key (plus their phone number) to activate their account the
    first time - after that the key is spent. Further logins may use
    any device up to the user's max_devices limit.
    """

    __tablename__ = "registration_keys"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    key = Column(String, unique=True, nullable=False, index=True)
    user_id = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=False)

    status = Column(Enum(RegistrationKeyStatusEnum), default=RegistrationKeyStatusEnum.pending, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    activated_at = Column(DateTime, nullable=True)
    device_id = Column(String, nullable=True)  # set once activated

    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="registration_key")


class Order(Base):
    __tablename__ = "orders"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    user_id = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=True)

    side = Column(Enum(OrderSideEnum), nullable=False)
    amount_type = Column(Enum(AmountTypeEnum), nullable=False)
    value = Column(Float, nullable=False)
    description = Column(Text, default="")
    status = Column(Enum(OrderStatusEnum), default=OrderStatusEnum.pending, nullable=False)
    price_at_submit = Column(Float, nullable=False)  # گرم۱۸ price (commission-adjusted), used for balance math
    mesghal17_price_at_submit = Column(Float, nullable=True)  # FINAL مثقال۱۷ quote (raw + this user's commission) - what the customer actually got
    mesghal17_raw_price_at_submit = Column(Float, nullable=True)  # raw مثقال۱۷ quote from the source, no commission - for "has the market price moved" comparisons only
    goldbridge_item_id = Column(Integer, nullable=True)  # which goldbridge instrument this was priced against - see PriceCard
    is_manual = Column(Boolean, default=False, nullable=False)  # True for حواله تلفنی (admin-entered) orders

    # Path (on disk, relative to the upload directory) to an optional
    # bank-transfer receipt the user attached as proof of payment for a
    # cash order. Never exposed directly to the client - only a boolean
    # "has_receipt" flag is; the actual file is served through an
    # authenticated endpoint that checks the requester owns the order
    # (or is an admin) before streaming it.
    receipt_path = Column(String, nullable=True)

    # Admin-queue visibility window. Set to now+ORDER_PENDING_SECONDS on
    # create (and again on each customer retry). While status is pending
    # AND pending_deadline_at is in the future, the order appears on the
    # admin dashboard sorted by soonest deadline. After the deadline
    # passes unanswered, it is soft-hidden from the admin queue until
    # the customer retries (which bumps this timestamp).
    pending_deadline_at = Column(DateTime, nullable=True)
    # How many times the customer has already bumped the waiting window
    # after the initial countdown. Capped by ORDER_MAX_RETRIES.
    retry_count = Column(Integer, nullable=False, default=0)
    # Optional reject reason. Currently used for admin "رد به دلیل تغییر مظنه"
    # which sets reject_reason="price_change" while status stays "rejected".
    reject_reason = Column(String, nullable=True)

    @property
    def has_receipt(self) -> bool:
        return bool(self.receipt_path)

    @property
    def seconds_remaining(self) -> int | None:
        """Seconds left in the current admin-visibility window, or None
        if this order isn't in an active pending countdown."""
        if self.status != OrderStatusEnum.pending or not self.pending_deadline_at:
            return None
        return max(0, int((self.pending_deadline_at - datetime.utcnow()).total_seconds()))

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

    # None = the legacy universal گرم۱۸ gold ledger (unchanged meaning).
    # Set to a goldbridge coin item's id = this row belongs to THAT
    # coin's own separate count-based ledger instead - gold_change here
    # means "number of coins", never mixed with the گرم۱۸ ledger above.
    goldbridge_item_id = Column(Integer, nullable=True)

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
    user_id = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=False)
    amount = Column(Float, nullable=False)  # تومان
    bank_reference = Column(String, nullable=True)  # شماره پیگیری / کد رهگیری
    transfer_date = Column(String, nullable=True)  # customer-entered, Jalali string
    description = Column(Text, nullable=True)
    receipt_path = Column(String, nullable=True)
    status = Column(Enum(TransferStatusEnum), default=TransferStatusEnum.pending, nullable=False)
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
    date = Column(DateTime, nullable=False, unique=True)  # stored as midnight of that Gregorian date
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
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class PriceCard(Base):
    """
    Admin-managed set of goldbridge items shown to customers as price
    cards on the main screen. Each row references a goldbridge item by
    its numeric id (see goldbridge's /prices) - the live name/type/ayar/
    buy/sell always comes fresh from the price poller's cache, never
    stored here, so this table only holds admin CHOICES:

      - is_enabled: shown to customers at all (as a display card)
      - orderable_buy / orderable_sell: independent per-side switches -
        a card can allow buying but not selling, or vice versa, or
        neither (still shown, just not tradable on that side). Any
        number of cards may be orderable simultaneously - there is no
        longer a single exclusive "the orderable card".

    Gold items (type=1, گرم/عیار) trade in گرم۱۸ terms against the
    existing balance ledger, exactly as before. Coin items (type=2)
    trade by COUNT against their OWN separate per-item balance ledger
    (see BalanceTransaction.goldbridge_item_id) - a coin is never
    converted into or mixed with گرم۱۸ gold balance, since that would
    misrepresent its actual purity/value.
    """

    __tablename__ = "price_cards"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    goldbridge_item_id = Column(Integer, unique=True, nullable=False)
    display_name = Column(String, nullable=True)  # None = use goldbridge's own name
    is_enabled = Column(Boolean, default=False, nullable=False)
    orderable_buy = Column(Boolean, default=False, nullable=False)
    orderable_sell = Column(Boolean, default=False, nullable=False)
    # When True, this app's own orderable_buy/orderable_sell above are
    # final - goldbridge's own allow_buy/allow_sell flags for this item
    # are ignored entirely. Off by default: normally BOTH this app's
    # toggle AND goldbridge's own flag must agree before customers can
    # order (see services/price_cards.get_enabled_cards_for_broadcast).
    override_source_restriction = Column(Boolean, default=False, nullable=False)
    sort_order = Column(Integer, default=0, nullable=False)
    # When True (or when live goldbridge prices are missing), customers
    # see and trade against manual_buy / manual_sell instead of the feed.
    use_manual_price = Column(Boolean, default=False, nullable=False)
    manual_buy = Column(Float, nullable=True)   # مثقال۱۷ تومان
    manual_sell = Column(Float, nullable=True)  # مثقال۱۷ تومان
    # Mirror another goldbridge item's live buy/sell (e.g. متفرقه / نقد کارتخوان → id 1).
    # When set, resolve_effective_item copies prices from that source id.
    price_source_item_id = Column(Integer, nullable=True)
    # Optional per-card price display override for ALL users of this card.
    # None = inherit the user's role price_label_mode.
    # "mesghal_and_gram18" | "gram18_only" | "mesghal17_only"
    price_label_mode = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class PriceCardCommission(Base):
    """
    Per-card × per-role commission override. When missing, the role's
    default commission_type/value applies. Lets admin set e.g. 20000
    Toman on one card for «عمده» today and 10000 tomorrow without
    changing the role-wide default.
    """

    __tablename__ = "price_card_commissions"
    __table_args__ = (
        UniqueConstraint("goldbridge_item_id", "role_id", name="uq_card_role_commission"),
    )

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    goldbridge_item_id = Column(Integer, nullable=False, index=True)
    role_id = Column(UUID(as_uuid=False), ForeignKey("roles.id"), nullable=False)
    commission_type = Column(Enum(CommissionTypeEnum), nullable=False, default=CommissionTypeEnum.fixed)
    commission_value = Column(Float, nullable=False, default=0)
    # When the card is on manual prices, admin can deny specific roles
    # from placing orders against that manual quote. Ignored for live feed.
    can_order = Column(Boolean, nullable=False, default=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    role = relationship("Role")


class AdminUser(Base):
    """
    Every admin account - including the ONE super-admin - is a row
    here. The super-admin (is_super=True) is auto-seeded once from
    GOLDAPP_ADMIN_USERNAME/GOLDAPP_ADMIN_PASSWORD_HASH in .env the
    first time the app starts with zero AdminUser rows - see
    services/admin_accounts.ensure_super_admin_seeded(). After that
    seed, .env is never read again for auth - username/password live
    only in the database, and the super-admin can change their own
    password the same way any sub-admin does (PATCH their own row).

    Sub-admins (accountant, manager, etc) are created BY the
    super-admin, each with their own username/password and a list of
    permission scopes limiting which admin panel sections they can
    use.

    Login is two-step for sub-admins, same spirit as the customer OTP
    flow: username + password first, then an SMS code sent to
    phone_number. On a sub-admin's very first login, registration_key
    must also be supplied (handed to them by the super-admin at
    creation time) - after that, activated_at is set and only the OTP
    step is needed going forward. The super-admin (is_super=True)
    skips the OTP step entirely - unchanged from before.
    """

    __tablename__ = "admin_users"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    username = Column(String, unique=True, nullable=False, index=True)
    password_hash = Column(String, nullable=False)
    full_name = Column(String, nullable=True)
    phone_number = Column(String, unique=True, nullable=True, index=True)
    national_id = Column(String, nullable=True)
    permissions = Column(Text, nullable=False, default="[]")  # JSON list of scope strings
    is_active = Column(Boolean, default=True)
    is_super = Column(Boolean, default=False, nullable=False)
    created_by = Column(String, nullable=True)  # username of the super-admin who created this row
    created_at = Column(DateTime, default=datetime.utcnow)
    last_login_at = Column(DateTime, nullable=True)

    # First-activation registration key (like the customer flow) -
    # shown once to the super-admin at creation time, consumed on the
    # sub-admin's first successful login.
    registration_key = Column(String, nullable=True)
    registration_key_expires_at = Column(DateTime, nullable=True)
    activated_at = Column(DateTime, nullable=True)


class AdminPushSubscription(Base):
    """
    Web Push subscriptions for admin devices (mobile PWA / desktop).
    Used to deliver order/KYC alerts with OS sound when the admin panel
    is backgrounded or the phone is locked — WebSocket alone cannot.
    """

    __tablename__ = "admin_push_subscriptions"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    admin_username = Column(String, nullable=False, index=True)
    endpoint = Column(Text, unique=True, nullable=False)
    p256dh = Column(Text, nullable=False)
    auth = Column(Text, nullable=False)
    user_agent = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_seen_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


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


class TehranDealer(Base):
    """
    آبشده‌فروش‌های تهران - counterparties the expert desk hedges
    unmatched customer buy/sell weight with (e.g. فرشاد گلد، منیری).
    """

    __tablename__ = "tehran_dealers"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    name = Column(String, unique=True, nullable=False)
    phone = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    sort_order = Column(Integer, default=0, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class ExpertHedgeSideEnum(str, enum.Enum):
    # Our action with the Tehran dealer:
    buy_from_dealer = "buy_from_dealer"    # خرید از آبشده تهران (cover customer buys)
    sell_to_dealer = "sell_to_dealer"      # فروش به آبشده تهران (cover customer sells)


class ExpertHedge(Base):
    """
    A hedge / assignment of customer-order weight (or a free-standing
    desk trade) against a Tehran melted-gold dealer.
    """

    __tablename__ = "expert_hedges"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    dealer_id = Column(UUID(as_uuid=False), ForeignKey("tehran_dealers.id"), nullable=False, index=True)
    side = Column(Enum(ExpertHedgeSideEnum), nullable=False)
    weight_gram18 = Column(Float, nullable=False)
    # Deal price with Tehran (مثقال ۱۷) — what we actually bought/sold at.
    price_mesghal17 = Column(Float, nullable=True)
    related_order_id = Column(UUID(as_uuid=False), ForeignKey("orders.id"), nullable=True, index=True)
    note = Column(Text, nullable=True)
    created_by = Column(String, nullable=True)  # admin username
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    dealer = relationship("TehranDealer")
    order = relationship("Order")


class TermsAcceptance(Base):
    """
    Append-only digital signature of a user accepting قوانین و مقررات
    at login. Each successful login that requires acceptance creates a
    new row — never update or delete these rows; they are legal proof.
    """

    __tablename__ = "terms_acceptances"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    user_id = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=False, index=True)
    phone_number = Column(String, nullable=False, index=True)

    # Snapshot of the terms the user signed (so later edits don't erase proof)
    terms_version = Column(String, nullable=False)
    terms_content_hash = Column(String, nullable=False)
    terms_text_snapshot = Column(Text, nullable=False)

    # Device / environment fingerprint for legal proof
    device_id = Column(String, nullable=False, index=True)
    ip_address = Column(String, nullable=True)
    user_agent = Column(Text, nullable=True)
    fingerprint_json = Column(Text, nullable=False, default="{}")

    # Tamper-evident hash over the acceptance payload
    signature_hash = Column(String, nullable=False, unique=True, index=True)

    accepted_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    accepted_at_client = Column(DateTime, nullable=True)

    user = relationship("User")
