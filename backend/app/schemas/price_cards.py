from pydantic import BaseModel


class AdminPriceCardOut(BaseModel):
    goldbridge_item_id: int
    name: str                      # live name from goldbridge
    display_name: str              # admin override or falls back to `name`
    type: int | None = None
    ayar: int | None = None
    item_weight: float | None = None
    buy: float | None = None       # effective raw (live or manual), no commission
    sell: float | None = None
    live_buy: float | None = None  # goldbridge feed only
    live_sell: float | None = None
    allow_buy: bool = False        # goldbridge's OWN flag
    allow_sell: bool = False
    active: bool = False
    is_enabled: bool = False       # shown to customers
    orderable_buy: bool = False    # this app's OWN admin toggle, independent per side
    orderable_sell: bool = False
    override_source_restriction: bool = False  # when True, this app's toggle wins over goldbridge's own flag
    use_manual_price: bool = False
    manual_buy: float | None = None
    manual_sell: float | None = None
    price_source: str = "live"     # "live" | "manual" | "mirrored" | "unavailable"
    sort_order: int = 0
    price_source_item_id: int | None = None
    price_label_mode: str | None = None
    # Role commission overrides for this card: [{role_id, role_name, commission_type, commission_value}]
    role_commissions: list[dict] = []


class SetCardEnabledIn(BaseModel):
    is_enabled: bool
    display_name: str | None = None
    sort_order: int | None = None


class SetCardOrderableIn(BaseModel):
    orderable_buy: bool
    orderable_sell: bool


class SetCardOverrideIn(BaseModel):
    override_source_restriction: bool


class SetCardManualPriceIn(BaseModel):
    use_manual_price: bool
    manual_buy: float | None = None
    manual_sell: float | None = None


class SetCardRoleCommissionIn(BaseModel):
    role_id: str
    commission_type: str  # "fixed" | "percentage"
    commission_value: float
    # When the card uses manual prices, False blocks this role from ordering.
    can_order: bool = True


class CustomerPriceCardOut(BaseModel):
    goldbridge_item_id: int
    name: str
    type: int | None = None
    unit: str                      # "gram18" | "count"
    item_weight: float | None = None
    is_primary: bool = False
    orderable_buy: bool
    orderable_sell: bool
    buy_price: float
    sell_price: float
    gram18_buy_price: float | None = None
    gram18_sell_price: float | None = None
    price_source: str = "live"
    # When set, overrides the user's role price_label_mode for THIS card only.
    price_label_mode: str | None = None
    price_source_item_id: int | None = None
    # "motaferaghe_sell" => (id1 buy + commission) / 4.39 for گرم۱۸ بفروشید
    pricing_mode: str | None = None
