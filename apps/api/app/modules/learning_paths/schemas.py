"""Learning path schemas."""

from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import BaseModel, Field, model_validator


class PathItemIn(BaseModel):
    course_id: uuid.UUID
    lesson_id: uuid.UUID | None = None
    is_required: bool = True
    note: str | None = Field(default=None, max_length=2000)


class PathIn(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=10_000)
    status: str = Field(default="draft", pattern="^(draft|published|archived)$")
    items: list[PathItemIn] = Field(default_factory=list, max_length=200)


class PathUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=10_000)
    status: str | None = Field(default=None, pattern="^(draft|published|archived)$")


class PathItemsIn(BaseModel):
    items: list[PathItemIn] = Field(max_length=200)


class PathItemOut(BaseModel):
    id: uuid.UUID
    course_id: uuid.UUID | None
    course_title: str | None = None
    course_status: str | None = None
    lesson_id: uuid.UUID | None
    position: int
    is_required: bool
    note: str | None


class PathOut(BaseModel):
    id: uuid.UUID
    title: str
    description: str | None
    status: str
    is_personalised: bool
    owner_user_id: uuid.UUID | None
    created_by: uuid.UUID | None
    created_at: datetime
    updated_at: datetime
    items: list[PathItemOut]
    enrolled_users: int = 0


class PathEnrolIn(BaseModel):
    user_ids: list[uuid.UUID] = Field(default_factory=list, max_length=5000)
    department_ids: list[uuid.UUID] = Field(default_factory=list, max_length=200)
    team_ids: list[uuid.UUID] = Field(default_factory=list, max_length=200)
    due_date: date | None = None

    @model_validator(mode="after")
    def _targets(self) -> PathEnrolIn:
        if not (self.user_ids or self.department_ids or self.team_ids):
            raise ValueError("Provide user_ids, department_ids and/or team_ids")
        return self


class PathEnrolOut(BaseModel):
    users: int
    created: int
    reactivated: int
    skipped: int
    courses_skipped: list[dict[str, str]]


class MyPathCourse(BaseModel):
    item_id: uuid.UUID
    course_id: uuid.UUID
    title: str
    thumbnail_url: str | None = None
    is_required: bool
    enrolment_id: uuid.UUID | None = None
    status: str | None = None  # enrolment status, None when not enrolled
    progress_pct: float = 0.0


class MyPath(BaseModel):
    id: uuid.UUID
    title: str
    description: str | None
    status: str  # not_started | in_progress | completed
    progress_pct: float
    completed_courses: int
    required_courses: int
    next_course_id: uuid.UUID | None
    courses: list[MyPathCourse]
