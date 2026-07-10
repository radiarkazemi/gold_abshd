from pydantic import BaseModel
from datetime import datetime


class SettlementLabelOut(BaseModel):
    label: str
    weekday: str
    date: str
    jalali_date: str


class HolidayIn(BaseModel):
    date: str  # "YYYY-MM-DD" Gregorian
    description: str | None = None


class HolidayOut(BaseModel):
    id: str
    date: datetime
    description: str | None = None

    class Config:
        from_attributes = True
