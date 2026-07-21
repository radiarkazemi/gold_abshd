from pydantic import BaseModel


class AdminPriceCardOut(BaseModel):
    goldbridge_item_id: int
    name: str                      # live name from goldbridge
    display_name: str              # admin override or falls back to `name`
    type: int | None = None
    ayar: int | None = None
    item_weight: float | None = None
    buy: float | None = None       # raw, Toman, no commission - admin view only
    sell: float | None = None
    allow_buy: bool = False        # goldbridge's OWN flag
    allow_sell: bool = False
    active: bool = False
    is_enabled: bool = False       # shown to customers
    orderable_buy: bool = False    # this app's OWN admin toggle, independent per side
    orderable_sell: bool = False
    override_source_restriction: bool = False  # when True, this app's toggle wins over goldbridge's own flag
    sort_order: int = 0


class SetCardEnabledIn(BaseModel):
    is_enabled: bool
    display_name: str | None = None
    sort_order: int | None = None


class SetCardOrderableIn(BaseModel):
    orderable_buy: bool
    orderable_sell: bool


class SetCardOverrideIn(BaseModel):
    override_source_restriction: bool


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