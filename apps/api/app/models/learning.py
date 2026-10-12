"""Learner progress: enrolments (pinned to a course version) and lesson progress."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import Date, DateTime, Float, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, StrEnum, TenantScoped, Timestamps, UUIDPk


class EnrolmentStatus(StrEnum):
    NOT_STARTED = "not_started"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    WITHDRAWN = "withdrawn"


class EnrolmentSource(StrEnum):
    SELF = "self"
    ASSIGNED = "assigned"
    LEARNING_PATH = "learning_path"


class Enrolment(UUIDPk, Timestamps, TenantScoped, Base):
    __tablename__ = "enrolments"
    __table_args__ = (
        UniqueConstraint("organisation_id", "user_id", "course_id"),
        Index("ix_enrolments_org_status_due", "organisation_id", "status", "due_date"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    course_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"), index=True)
    course_version_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("course_versions.id", ondelete="RESTRICT")
    )
    source: Mapped[str] = mapped_column(String(16), default=EnrolmentSource.SELF)
    learning_path_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("learning_paths.id", ondelete="SET NULL")
    )
    assigned_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    due_date: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(16), default=EnrolmentStatus.NOT_STARTED)
    progress_pct: Mapped[float] = mapped_column(Float, default=0.0)
    final_score: Mapped[float | None] = mapped_column(Float)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_accessed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_lesson_id: Mapped[uuid.UUID | None] = mapped_column()
    time_spent_seconds: Mapped[int] = mapped_column(Integer, default=0)
    reminders_sent: Mapped[dict[str, Any]] = mapped_column(default=dict)


class LessonProgress(UUIDPk, Timestamps, TenantScoped, Base):
    __tablename__ = "lesson_progress"
    __table_args__ = (UniqueConstraint("enrolment_id", "lesson_id"),)

    enrolment_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("enrolments.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    lesson_id: Mapped[uuid.UUID] = mapped_column()  # lesson id from the pinned snapshot
    status: Mapped[str] = mapped_column(String(16), default="in_progress")  # in_progress | completed
    time_spent_seconds: Mapped[int] = mapped_column(Integer, default=0)
    last_position: Mapped[dict[str, Any]] = mapped_column(default=dict)  # e.g. video seconds, activity idx
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ActivityDay(UUIDPk, TenantScoped, Base):
    """One row per learner per active day — powers streaks and engagement analytics."""

    __tablename__ = "activity_days"
    __table_args__ = (UniqueConstraint("organisation_id", "user_id", "day"),)

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    day: Mapped[date] = mapped_column(Date)
    events: Mapped[int] = mapped_column(Integer, default=1)
    seconds: Mapped[int] = mapped_column(Integer, default=0)
