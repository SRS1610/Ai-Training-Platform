"""AI content generation schemas."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

GenerationKind = Literal[
    "course",
    "module",
    "lesson",
    "quiz",
    "assignment",
    "rubric",
    "flashcards",
    "revision_notes",
    "case_study",
    "scenario",
]


class GenerationCreate(BaseModel):
    kind: GenerationKind
    input: dict[str, Any] = Field(
        description="subject, audience, difficulty, objectives, duration, industry, format, "
        "weeks, course_id, lesson_id, module_id, question_count, question_types"
    )
    course_id: uuid.UUID | None = None


class RegenerateIn(BaseModel):
    feedback: str | None = Field(default=None, max_length=4000)
    input: dict[str, Any] | None = None  # optional input overrides


class EditIn(BaseModel):
    edited_output: dict[str, Any]


class ReviewIn(BaseModel):
    notes: str | None = Field(default=None, max_length=4000)


class RejectIn(BaseModel):
    notes: str = Field(min_length=1, max_length=4000)


class ApplyIn(BaseModel):
    course_id: uuid.UUID | None = None
    module_id: uuid.UUID | None = None


class GenerationSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    kind: str
    status: str
    version: int
    parent_id: uuid.UUID | None
    course_id: uuid.UUID | None
    requested_by: uuid.UUID | None
    reviewed_by: uuid.UUID | None
    reviewed_at: datetime | None
    applied_entity_type: str | None
    applied_entity_id: uuid.UUID | None
    provider: str | None
    model: str | None
    cost_usd: float
    error: str | None
    created_at: datetime
    updated_at: datetime
    title: str | None = None


class GenerationOut(GenerationSummary):
    input: dict[str, Any]
    output: dict[str, Any] | None
    edited_output: dict[str, Any] | None
    review_notes: str | None
    tokens_in: int
    tokens_out: int
    safety: dict[str, Any]
    offline: bool = False


class ApplyOut(BaseModel):
    generation: GenerationOut
    entity_type: str
    entity_id: uuid.UUID
    created: dict[str, int]
    link: str
