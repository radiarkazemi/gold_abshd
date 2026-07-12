from pydantic import BaseModel


class NoticeOut(BaseModel):
    text: str


class NoticeUpdateIn(BaseModel):
    text: str