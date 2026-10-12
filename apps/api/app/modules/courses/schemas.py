"""Course authoring, versioning and catalog schemas."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.content import CourseStatus, Difficulty, LessonType

SLUG_PATTERN = r"^[a-z0-9]+(?:-[a-z0-9]+)*$"


class SkillRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str


# ----------------------------------------------------------------------------- courses


class CourseBase(BaseModel):
    subtitle: str | None = Field(default=None, max_length=255)
    description: str | None = Field(default=None, max_length=50_000)
    category: str | None = Field(default=None, max_length=100)
    difficulty: Difficulty | None = None
    duration_minutes: int | None = Field(default=None, ge=0, le=100_000)
    learning_objectives: list[str] | None = Field(default=None, max_length=100)
    prerequisites: list[str] | None = Field(default=None, max_length=100)
    target_audience: str | None = Field(default=None, max_length=5000)
    tags: list[str] | None = Field(default=None, max_length=50)
    thumbnail_url: str | None = Field(default=None, max_length=1024)
    visibility: str | None = Field(default=None, pattern="^(organisation|public)$")
    instructor_id: uuid.UUID | None = None
    certificate_enabled: bool | None = None
    pass_threshold: float | None = Field(default=None, ge=0, le=100)
    ai_tutor_enabled: bool | None = None
    sequential: bool | None = None
    skill_ids: list[uuid.UUID] | None = None


class CourseCreate(CourseBase):
    title: str = Field(min_length=1, max_length=255)
    slug: str | None = Field(default=None, min_length=1, max_length=160, pattern=SLUG_PATTERN)


class CourseUpdate(CourseBase):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    slug: str | None = Field(default=None, min_length=1, max_length=160, pattern=SLUG_PATTERN)
    status: CourseStatus | None = Field(default=None, description="Only draft <-> in_review via this endpoint")


class CourseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    slug: str
    title: str
    subtitle: str | None
    description: str
    category: str | None
    difficulty: str
    duration_minutes: int
    learning_objectives: list[Any]
    prerequisites: list[Any]
    target_audience: str | None
    tags: list[Any]
    thumbnail_url: str | None
    status: str
    visibility: str
    instructor_id: uuid.UUID | None
    created_by: uuid.UUID | None
    current_version_id: uuid.UUID | None
    current_version_number: int | None = None
    draft_version_number: int
    certificate_enabled: bool
    pass_threshold: float
    ai_tutor_enabled: bool
    ai_generated: bool
    sequential: bool
    skills: list[SkillRef] = []
    module_count: int = 0
    lesson_count: int = 0
    enrolment_count: int = 0
    created_at: datetime
    updated_at: datetime


class CourseSkillsIn(BaseModel):
    skill_ids: list[uuid.UUID] = Field(max_length=200)


class DuplicateIn(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)


# ----------------------------------------------------------------------------- structure


class ModuleCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=10_000)
    position: int | None = Field(default=None, ge=0)


class ModuleUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=10_000)
    position: int | None = Field(default=None, ge=0)


class ModuleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    course_id: uuid.UUID
    title: str
    description: str | None
    position: int


class LessonCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    summary: str | None = Field(default=None, max_length=10_000)
    lesson_type: LessonType = LessonType.TEXT
    content: dict[str, Any] = Field(default_factory=dict)
    duration_minutes: int = Field(default=5, ge=0, le=10_000)
    position: int | None = Field(default=None, ge=0)
    is_required: bool = True
    is_preview: bool = False
    assessment_id: uuid.UUID | None = None
    assignment_id: uuid.UUID | None = None
    simulation_id: uuid.UUID | None = None
    skill_ids: list[uuid.UUID] = Field(default_factory=list, max_length=50)


class LessonUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    summary: str | None = Field(default=None, max_length=10_000)
    lesson_type: LessonType | None = None
    content: dict[str, Any] | None = None
    duration_minutes: int | None = Field(default=None, ge=0, le=10_000)
    position: int | None = Field(default=None, ge=0)
    module_id: uuid.UUID | None = None
    is_required: bool | None = None
    is_preview: bool | None = None
    assessment_id: uuid.UUID | None = None
    assignment_id: uuid.UUID | None = None
    simulation_id: uuid.UUID | None = None
    skill_ids: list[uuid.UUID] | None = Field(default=None, max_length=50)


class LinkedItem(BaseModel):
    type: str  # assessment | assignment | simulation
    id: uuid.UUID
    title: str
    status: str | None = None


class ActivityCreate(BaseModel):
    activity_type: str = Field(min_length=1, max_length=32)
    title: str | None = Field(default=None, max_length=255)
    content: dict[str, Any] = Field(default_factory=dict)
    position: int | None = Field(default=None, ge=0)


class ActivityUpdate(BaseModel):
    activity_type: str | None = Field(default=None, min_length=1, max_length=32)
    title: str | None = Field(default=None, max_length=255)
    content: dict[str, Any] | None = None
    position: int | None = Field(default=None, ge=0)


class ActivityOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    lesson_id: uuid.UUID
    activity_type: str
    title: str | None
    content: dict[str, Any]
    position: int


class ActivityOrderIn(BaseModel):
    activity_ids: list[uuid.UUID]


class LessonOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    course_id: uuid.UUID
    module_id: uuid.UUID
    title: str
    summary: str | None
    lesson_type: str
    content: dict[str, Any]
    duration_minutes: int
    position: int
    is_required: bool
    is_preview: bool
    assessment_id: uuid.UUID | None
    assignment_id: uuid.UUID | None
    simulation_id: uuid.UUID | None
    skill_ids: list[Any]
    ai_generated: bool
    linked: LinkedItem | None = None
    activities: list[ActivityOut] = []


class StructureModuleOut(ModuleOut):
    lessons: list[LessonOut] = []


class StructureOut(BaseModel):
    course: CourseOut
    modules: list[StructureModuleOut]
    has_unpublished_changes: bool


class ReorderLesson(BaseModel):
    id: uuid.UUID
    position: int = Field(ge=0)
    module_id: uuid.UUID | None = None


class ReorderModule(BaseModel):
    id: uuid.UUID
    position: int = Field(ge=0)
    lessons: list[ReorderLesson] = Field(default_factory=list)


class ReorderIn(BaseModel):
    modules: list[ReorderModule]

    @field_validator("modules")
    @classmethod
    def _unique(cls, v: list[ReorderModule]) -> list[ReorderModule]:
        ids = [m.id for m in v]
        lesson_ids = [lsn.id for m in v for lsn in m.lessons]
        if len(ids) != len(set(ids)) or len(lesson_ids) != len(set(lesson_ids)):
            raise ValueError("Duplicate module or lesson ids")
        return v


# ----------------------------------------------------------------------------- versions


class PublishIn(BaseModel):
    changelog: str | None = Field(default=None, max_length=10_000)


class VersionSummary(BaseModel):
    id: uuid.UUID
    version_number: int
    status: str
    changelog: str | None
    published_by: uuid.UUID | None
    published_by_name: str | None = None
    published_at: datetime | None
    stats: dict[str, Any] = {}


class VersionOut(VersionSummary):
    snapshot: dict[str, Any]


class PublishOut(BaseModel):
    course: CourseOut
    version: VersionSummary


# ----------------------------------------------------------------------------- catalog


class EnrolmentState(BaseModel):
    id: uuid.UUID
    status: str
    progress_pct: float
    due_date: Any = None


class CatalogItem(BaseModel):
    id: uuid.UUID
    slug: str
    title: str
    subtitle: str | None = None
    description: str = ""
    category: str | None = None
    difficulty: str | None = None
    duration_minutes: int = 0
    thumbnail_url: str | None = None
    tags: list[Any] = []
    skills: list[dict[str, Any]] = []
    lesson_count: int = 0
    module_count: int = 0
    version_number: int
    published_at: datetime | None = None
    enrolment: EnrolmentState | None = None


class CatalogDetail(CatalogItem):
    learning_objectives: list[Any] = []
    prerequisites: list[Any] = []
    target_audience: str | None = None
    certificate_enabled: bool = True
    outline: list[dict[str, Any]] = []


class CategoryCount(BaseModel):
    category: str
    count: int
