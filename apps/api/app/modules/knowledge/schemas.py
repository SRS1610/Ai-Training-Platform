"""Knowledge base schemas."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class DocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    course_id: uuid.UUID | None
    source_type: str
    source_url: str | None
    file_id: uuid.UUID | None
    category: str | None
    status: str
    approved: bool
    approved_by: uuid.UUID | None
    approved_at: datetime | None
    chunk_count: int
    char_count: int
    error: str | None
    created_by: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


class UrlIn(BaseModel):
    url: str = Field(min_length=8, max_length=2048)
    title: str | None = Field(default=None, max_length=255)
    course_id: uuid.UUID | None = None
    category: str | None = Field(default=None, max_length=64)


class TextIn(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    text: str = Field(min_length=1, max_length=2_000_000)
    course_id: uuid.UUID | None = None
    category: str | None = Field(default=None, max_length=64)
    format: str = Field(default="markdown", pattern="^(markdown|text)$")


class DocumentUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    category: str | None = Field(default=None, max_length=64)
    course_id: uuid.UUID | None = None
    clear_course: bool = False


class ChunkOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    document_id: uuid.UUID
    chunk_index: int
    heading: str | None
    content: str
    token_count: int
    embedding_model: str | None
    course_id: uuid.UUID | None


class SearchIn(BaseModel):
    query: str = Field(min_length=1, max_length=2000)
    course_id: uuid.UUID | None = None
    k: int = Field(default=5, ge=1, le=50)
    approved_only: bool = False


class SearchHit(BaseModel):
    chunk_id: uuid.UUID
    document_id: uuid.UUID
    title: str
    heading: str | None
    snippet: str
    score: float
    source: str
    course_id: uuid.UUID | None


class SearchOut(BaseModel):
    query: str
    results: list[SearchHit]
    embedding_model: str
