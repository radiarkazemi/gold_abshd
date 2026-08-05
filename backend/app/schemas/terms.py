from pydantic import BaseModel, Field
from typing import Any, Optional
from datetime import datetime


class TermsOut(BaseModel):
    text: str
    version: str
    content_hash: str
    updated_at: Optional[str] = None


class TermsUpdateIn(BaseModel):
    text: str = Field(..., min_length=1)


class TermsAcceptanceOut(BaseModel):
    id: str
    user_id: str
    phone_number: str
    terms_version: str
    terms_content_hash: str
    device_id: str
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    fingerprint: dict[str, Any] = {}
    signature_hash: str
    accepted_at: datetime
    accepted_at_client: Optional[datetime] = None
