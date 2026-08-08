from pydantic import BaseModel, Field
from typing import Any, Optional


class ReygiriLookupIn(BaseModel):
    ang: str = Field(..., min_length=1, max_length=32, description="شماره انگ / پاکت")
    series: str = Field("", max_length=1, description="کد سری A-D یا خالی")
    include_archive: bool = True


class ReygiriNationalItem(BaseModel):
    title: Optional[str] = None
    karat: Optional[str] = None
    lab_name: Optional[str] = None
    register_type: Optional[str] = None
    datetime: Optional[str] = None
    series: Optional[str] = None
    fields: dict[str, str] = {}


class ReygiriAbharItem(BaseModel):
    owner: Optional[str] = None
    ang: Optional[str] = None
    karat: Optional[str] = None
    lab_name: Optional[str] = None
    id: Optional[str] = None
    raw: dict[str, Any] = {}


class ReygiriSourceOut(BaseModel):
    ok: bool
    source: str
    source_label: str
    error: Optional[str] = None
    empty: bool = False
    warnings: list[str] = []
    items: list[dict[str, Any]] = []


class ReygiriLookupOut(BaseModel):
    ang: str
    series: str = ""
    include_archive: bool = True
    national: ReygiriSourceOut
    abhar: ReygiriSourceOut
