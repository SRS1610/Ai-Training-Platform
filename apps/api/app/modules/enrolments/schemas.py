"""Enrolment and course-player schemas."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator


class SelfEnrolIn(BaseModel):
    course_id: uuid.UUID


class AssignIn(BaseModel):
    course_id: uuid.UUID
    user_ids: list[uuid.UUID] = Field(default_factory=list, max_length=5000)
    department_ids: list[uuid.UUID] = Field(default_factory=list, max_length=200)
    team_ids: list[uuid.UUID] = Field(default_factory=list, max_length=200)
    due_date: date | None = None

    @model_validator(mode="after")
    def _targets(self) -> AssignIn:
        if not (self.user_ids or self.department_ids or self.team_ids):
            raise ValueError("Provide user_ids, department_ids and/or team_ids")
        return self


class AssignOut(BaseModel):
    created: int
    reactivated: int
    skipped: int
    enrolment_ids: list[uuid.UUID]


class EnrolmentUpdate(BaseModel):
    due_date: date | None = None


class UserBrief(BaseModel):
    id: uuid.UUID
    full_name: str
    email: str


class CourseBrief(BaseModel):
    id: uuid.UUID
    title: str


class EnrolmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    course_id: uuid.UUID
    course_version_id: uuid.UUID
    version_number: int | None = None
    source: str
    learning_path_id: uuid.UUID | None
    assigned_by: uuid.UUID | None
    due_date: date | None
    status: str
    progress_pct: float
    final_score: float | None
    started_at: datetime | None
    completed_at: datetime | None
    last_accessed_at: datetime | None
    time_spent_seconds: int
    created_at: datetime
    is_overdue: bool = False
    user: UserBrief | None = None
    course: CourseBrief | None = None


class NextLesson(BaseModel):
    id: str
    title: str
    lesson_type: str
    module_id: str | None = None


class MyEnrolmentOut(EnrolmentOut):
    title: str
    thumbnail_url: str | None = None
    category: str | None = None
    difficulty: str | None = None
    latest_version_number: int | None = None
    upgrade_available: bool = False
    next_lesson: NextLesson | None = None


class LessonState(BaseModel):
    status: str | None = None  # None (not started) | in_progress | completed
    time_spent_seconds: int = 0
    completed_at: datetime | None = None
    last_position: dict[str, Any] = {}


class OutlineLesson(BaseModel):
    id: str
    title: str
    summary: str | None = None
    lesson_type: str
    duration_minutes: int = 0
    position: int = 0
    is_required: bool = True
    is_preview: bool = False
    linked: dict[str, Any] | None = None
    completes_via: str = "learner"  # learner | assessment | assignment | simulation
    progress: LessonState
    locked: bool = False


class OutlineModule(BaseModel):
    id: str
    title: str
    description: str | None = None
    position: int = 0
    lessons: list[OutlineLesson]


class LearnEnrolment(BaseModel):
    id: uuid.UUID
    status: str
    progress_pct: float
    final_score: float | None
    due_date: date | None
    source: str
    started_at: datetime | None
    completed_at: datetime | None
    last_accessed_at: datetime | None
    last_lesson_id: uuid.UUID | None
    time_spent_seconds: int


class VersionInfo(BaseModel):
    id: uuid.UUID
    version_number: int
    published_at: datetime | None


class LearnStats(BaseModel):
    total_lessons: int
    required_lessons: int
    completed_lessons: int
    completed_required: int


class LearnCourseOut(BaseModel):
    enrolment: LearnEnrolment
    course: dict[str, Any]
    version: VersionInfo
    latest_version_number: int | None
    upgrade_available: bool
    modules: list[OutlineModule]
    next_lesson: NextLesson | None
    stats: LearnStats


class LearnLessonOut(BaseModel):
    course_id: uuid.UUID
    enrolment_id: uuid.UUID | None
    module: dict[str, Any]
    lesson: dict[str, Any]
    progress: LessonState
    locked: bool
    completes_via: str
    previous_lesson_id: str | None
    next_lesson_id: str | None
    preview: bool = False


class CheckIn(BaseModel):
    answer_ids: list[str] = Field(min_length=1, max_length=50)


class CheckOut(BaseModel):
    correct: bool
    correct_ids: list[str]
    explanation: str | None = None
