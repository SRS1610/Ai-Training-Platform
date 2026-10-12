"""AI tutor schemas."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class SessionCreate(BaseModel):
    course_id: uuid.UUID | None = None
    lesson_id: uuid.UUID | None = None
    title: str | None = Field(default=None, max_length=255)


class SessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str | None
    course_id: uuid.UUID | None
    lesson_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


class MessageIn(BaseModel):
    content: str = Field(min_length=1, max_length=4000)
    lesson_id: uuid.UUID | None = None


class Citation(BaseModel):
    index: int
    document_id: str
    title: str
    chunk_id: str
    snippet: str
    heading: str | None = None


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    role: str
    content: str
    mode: str | None
    citations: list[dict[str, Any]]
    safety: dict[str, Any]
    model: str | None
    tokens_in: int
    tokens_out: int
    feedback_rating: int | None
    created_at: datetime


class ExchangeOut(BaseModel):
    session_id: uuid.UUID
    user_message: MessageOut
    assistant_message: MessageOut
    mode: str
    offline: bool


class RatingIn(BaseModel):
    rating: Literal[-1, 1]
