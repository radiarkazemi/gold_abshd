from pydantic import BaseModel


class NoticeOut(BaseModel):
    text: str
    updated_at: str | None = None


class NoticeUpdateIn(BaseModel):
    text: str
