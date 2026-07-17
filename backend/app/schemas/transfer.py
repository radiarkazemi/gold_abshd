from datetime import datetime

from pydantic import BaseModel


class TransferRequestOut(BaseModel):
    id: str
    amount: float
    bank_reference: str | None = None
    transfer_date: str | None = None
    description: str | None = None
    has_receipt: bool = False
    status: str
    admin_note: str | None = None
    created_at: datetime
    reviewed_at: datetime | None = None

    # only populated on the admin list
    user_id: str | None = None
    user_code: str | None = None
    customer_name: str | None = None

    class Config:
        from_attributes = True


class TransferDecisionIn(BaseModel):
    accept: bool
    admin_note: str = ""
