"""Training content: courses (versioned), modules, lessons, activities, learning paths, skills, files."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Table,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, SoftDelete, StrEnum, TenantScoped, Timestamps, UUIDPk


class CourseStatus(StrEnum):
    DRAFT = "draft"
    IN_REVIEW = "in_review"
    PUBLISHED = "published"
    ARCHIVED = "archived"


class Difficulty(StrEnum):
    BEGINNER = "beginner"
    INTERMEDIATE = "intermediate"
    ADVANCED = "advanced"
    EXPERT = "expert"


class LessonType(StrEnum):
    VIDEO = "video"
    AUDIO = "audio"
    PDF = "pdf"
    POWERPOINT = "powerpoint"
    TEXT = "text"
    INTERACTIVE_HTML = "interactive_html"
    IMAGE = "image"
    INFOGRAPHIC = "infographic"
    CODE = "code"
    QUIZ = "quiz"
    FLASHCARDS = "flashcards"
    SCENARIO = "scenario"
    SIMULATION = "simulation"
    ASSIGNMENT = "assignment"
    AI_TUTOR = "ai_tutor"
    MIXED = "mixed"


course_skills = Table(
    "course_skills",
    Base.metadata,
    Column("course_id", ForeignKey("courses.id", ondelete="CASCADE"), primary_key=True),
    Column("skill_id", ForeignKey("skills.id", ondelete="CASCADE"), primary_key=True),
)


class Course(UUIDPk, Timestamps, SoftDelete, TenantScoped, Base):
    __tablename__ = "courses"
    __table_args__ = (UniqueConstraint("organisation_id", "slug"),)

    slug: Mapped[str] = mapped_column(String(160))
    title: Mapped[str] = mapped_column(String(255))
    subtitle: Mapped[str | None] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str | None] = mapped_column(String(100), index=True)
    difficulty: Mapped[str] = mapped_column(String(16), default=Difficulty.BEGINNER)
    duration_minutes: Mapped[int] = mapped_column(Integer, default=0)
    learning_objectives: Mapped[list[Any]] = mapped_column(default=list)
    prerequisites: Mapped[list[Any]] = mapped_column(default=list)
    target_audience: Mapped[str | None] = mapped_column(Text)
    tags: Mapped[list[Any]] = mapped_column(default=list)
    thumbnail_url: Mapped[str | None] = mapped_column(String(1024))
    status: Mapped[str] = mapped_column(String(16), default=CourseStatus.DRAFT, index=True)
    visibility: Mapped[str] = mapped_column(String(16), default="organisation")  # organisation | public
    instructor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    current_version_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("course_versions.id", ondelete="SET NULL", use_alter=True)
    )
    draft_version_number: Mapped[int] = mapped_column(Integer, default=1)
    certificate_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    pass_threshold: Mapped[float] = mapped_column(Float, default=70.0)  # % required to earn certificate
    ai_tutor_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    ai_generated: Mapped[bool] = mapped_column(Boolean, default=False)
    # When true, lessons unlock in order (each requires the previous required lessons to be completed).
    sequential: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")

    modules: Mapped[list[CourseModule]] = relationship(
        back_populates="course", order_by="CourseModule.position", cascade="all, delete-orphan"
    )
    skills: Mapped[list[Skill]] = relationship(secondary=course_skills, lazy="selectin")


class CourseVersion(UUIDPk, Timestamps, TenantScoped, Base):
    """Immutable published snapshot of the full course tree. Enrolments pin a version."""

    __tablename__ = "course_versions"
    __table_args__ = (UniqueConstraint("course_id", "version_number"),)

    course_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"), index=True)
    version_number: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(16), default="published")  # published | superseded
    snapshot: Mapped[dict[str, Any]] = mapped_column()
    changelog: Mapped[str | None] = mapped_column(Text)
    published_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class CourseModule(UUIDPk, Timestamps, SoftDelete, TenantScoped, Base):
    __tablename__ = "course_modules"

    course_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text)
    position: Mapped[int] = mapped_column(Integer, default=0)

    course: Mapped[Course] = relationship(back_populates="modules")
    lessons: Mapped[list[Lesson]] = relationship(
        back_populates="module", order_by="Lesson.position", cascade="all, delete-orphan"
    )


class Lesson(UUIDPk, Timestamps, SoftDelete, TenantScoped, Base):
    __tablename__ = "lessons"
    __table_args__ = (Index("ix_lessons_course_module_pos", "course_id", "module_id", "position"),)

    course_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"), index=True)
    module_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("course_modules.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(255))
    summary: Mapped[str | None] = mapped_column(Text)
    lesson_type: Mapped[str] = mapped_column(String(32), default=LessonType.TEXT)
    # Type specific payload, e.g. {"body_markdown": ...} | {"video_url": ..., "transcript": ..., "captions_url": ...}
    content: Mapped[dict[str, Any]] = mapped_column(default=dict)
    duration_minutes: Mapped[int] = mapped_column(Integer, default=5)
    position: Mapped[int] = mapped_column(Integer, default=0)
    is_required: Mapped[bool] = mapped_column(Boolean, default=True)
    is_preview: Mapped[bool] = mapped_column(Boolean, default=False)
    # Linked practical items for quiz / assignment / simulation lessons
    assessment_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("assessments.id", ondelete="SET NULL", use_alter=True)
    )
    assignment_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("assignments.id", ondelete="SET NULL", use_alter=True)
    )
    simulation_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("simulations.id", ondelete="SET NULL", use_alter=True)
    )
    skill_ids: Mapped[list[Any]] = mapped_column(default=list)
    ai_generated: Mapped[bool] = mapped_column(Boolean, default=False)

    module: Mapped[CourseModule] = relationship(back_populates="lessons")
    activities: Mapped[list[Activity]] = relationship(
        back_populates="lesson", order_by="Activity.position", cascade="all, delete-orphan"
    )


class Activity(UUIDPk, Timestamps, TenantScoped, Base):
    """A block inside a lesson (mixed lesson types): text, video, image, code, flashcards, callout, check."""

    __tablename__ = "activities"

    lesson_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("lessons.id", ondelete="CASCADE"), index=True)
    activity_type: Mapped[str] = mapped_column(String(32))
    title: Mapped[str | None] = mapped_column(String(255))
    content: Mapped[dict[str, Any]] = mapped_column(default=dict)
    position: Mapped[int] = mapped_column(Integer, default=0)

    lesson: Mapped[Lesson] = relationship(back_populates="activities")


class LearningPath(UUIDPk, Timestamps, SoftDelete, TenantScoped, Base):
    __tablename__ = "learning_paths"

    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), default=CourseStatus.DRAFT)
    is_personalised: Mapped[bool] = mapped_column(Boolean, default=False)
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    items: Mapped[list[LearningPathItem]] = relationship(
        back_populates="path", order_by="LearningPathItem.position", cascade="all, delete-orphan"
    )


class LearningPathItem(UUIDPk, TenantScoped, Base):
    __tablename__ = "learning_path_items"

    path_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("learning_paths.id", ondelete="CASCADE"), index=True)
    course_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"))
    lesson_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("lessons.id", ondelete="CASCADE"))
    position: Mapped[int] = mapped_column(Integer, default=0)
    is_required: Mapped[bool] = mapped_column(Boolean, default=True)
    note: Mapped[str | None] = mapped_column(Text)

    path: Mapped[LearningPath] = relationship(back_populates="items")


class Skill(UUIDPk, Timestamps, TenantScoped, Base):
    __tablename__ = "skills"
    __table_args__ = (UniqueConstraint("organisation_id", "name"),)

    name: Mapped[str] = mapped_column(String(160))
    category: Mapped[str | None] = mapped_column(String(100))
    description: Mapped[str | None] = mapped_column(Text)


class Competency(UUIDPk, Timestamps, TenantScoped, Base):
    """A named competency made up of skill requirements: [{"skill_id": ..., "min_level": 70}]."""

    __tablename__ = "competencies"

    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text)
    requirements: Mapped[list[Any]] = mapped_column(default=list)


class LearnerSkill(UUIDPk, Timestamps, TenantScoped, Base):
    __tablename__ = "learner_skills"
    __table_args__ = (UniqueConstraint("organisation_id", "user_id", "skill_id"),)

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    skill_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("skills.id", ondelete="CASCADE"))
    proficiency: Mapped[float] = mapped_column(Float, default=0.0)  # 0-100, exponentially weighted
    evidence_count: Mapped[int] = mapped_column(Integer, default=0)
    last_assessed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    history: Mapped[list[Any]] = mapped_column(default=list)  # [{source, ref_id, score, at}] (bounded)


class FileScanStatus(StrEnum):
    PENDING = "pending"
    CLEAN = "clean"
    INFECTED = "infected"
    SKIPPED = "skipped"  # no scanner configured — shown to admins


class StoredFile(UUIDPk, Timestamps, SoftDelete, TenantScoped, Base):
    __tablename__ = "files"

    owner_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    storage_key: Mapped[str] = mapped_column(String(512), unique=True)
    filename: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(120))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    purpose: Mapped[str] = mapped_column(String(32))  # lesson_media | submission | knowledge | certificate | report
    scan_status: Mapped[str] = mapped_column(String(16), default=FileScanStatus.PENDING)
    scan_detail: Mapped[str | None] = mapped_column(String(255))
