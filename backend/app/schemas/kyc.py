from datetime import datetime

from pydantic import BaseModel


class KycStatusOut(BaseModel):
    kyc_status: str  # none | pending | approved | rejected
    kyc_submitted_at: datetime | None = None
    kyc_reviewed_at: datetime | None = None
    kyc_reject_reason: str | None = None
    has_id_front: bool = False
    has_id_back: bool = False
    has_birth_cert: bool = False


class KycPendingOut(BaseModel):
    user_id: str
    user_code: str
    full_name: str | None = None
    phone_number: str
    kyc_status: str = "pending"  # pending | approved
    kyc_submitted_at: datetime | None = None
    kyc_reviewed_at: datetime | None = None
    has_id_front: bool = False
    has_id_back: bool = False
    has_birth_cert: bool = False


class KycReviewIn(BaseModel):
    approve: bool
    reject_reason: str | None = None
