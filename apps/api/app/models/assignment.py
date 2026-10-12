"""Practical assignments, rubrics, versioned submissions, grade records and integrity signals."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, SoftDelete, StrEnum, TenantScoped, Timestamps, UUIDPk


class Rubric(UUIDPk, Timestamps, SoftDelete, TenantScoped, Base):
    """criteria: [{"id","name","description","weight", "levels":[{"score","label","description"}]}]"""

    __tablename__ = "rubrics"

    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text)
    criteria: Mapped[list[Any]] = mapped_column(default=list)
    total_points: Mapped[float] = mapped_column(Float, default=100.0)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    ai_generated: Mapped[bool] = mapped_column(Boolean, default=False)


class Assignment(UUIDPk, Timestamps, SoftDelete, TenantScoped, Base):
    __tablename__ = "assignments"

    course_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("courses.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(255))
    scenario: Mapped[str] = mapped_column(Text, default="")
    objective: Mapped[str] = mapped_column(Text, default="")
    instructions: Mapped[str] = mapped_column(Text, default="")
    # [{"id","label","type": text|file|screenshot|video|audio|code|document|structured, "required": bool}]
    required_evidence: Mapped[list[Any]] = mapped_column(default=list)
    structured_fields: Mapped[list[Any]] = mapped_column(default=list)  # [{"id","label","type","help"}]
    resources: Mapped[list[Any]] = mapped_column(default=list)  # [{"title","url"|"file_id"}]
    expected_output: Mapped[str | None] = mapped_column(Text)  # instructor-only model answer
    evaluation_criteria: Mapped[str | None] = mapped_column(Text)
    rubric_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("rubrics.id", ondelete="SET NULL"))
    time_limit_minutes: Mapped[int | None] = mapped_column(Integer)
    due_days_after_enrolment: Mapped[int | None] = mapped_column(Integer)
    passing_score: Mapped[float] = mapped_column(Float, default=70.0)
    grading_mode: Mapped[str] = mapped_column(String(32), default="ai_assisted")
    high_stakes: Mapped[bool] = mapped_column(Boolean, default=False)
    max_submissions: Mapped[int | None] = mapped_column(Integer, default=3)
    allowed_file_types: Mapped[list[Any]] = mapped_column(default=list)
    status: Mapped[str] = mapped_column(String(16), default="draft")
    skill_ids: Mapped[list[Any]] = mapped_column(default=list)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    ai_generated: Mapped[bool] = mapped_column(Boolean, default=False)

    rubric: Mapped[Rubric | None] = relationship(lazy="selectin")


class SubmissionStatus(StrEnum):
    DRAFT = "draft"
    SUBMITTED = "submitted"
    AI_GRADING = "ai_grading"
    AI_GRADED = "ai_graded"  # recommendation available, awaiting human (high stakes)
    UNDER_REVIEW = "under_review"
    GRADED = "graded"
    RETURNED = "returned"  # returned for resubmission


class Submission(UUIDPk, Timestamps, TenantScoped, Base):
    __tablename__ = "submissions"
    __table_args__ = (
        UniqueConstraint("assignment_id", "user_id"),
        Index("ix_submissions_org_status", "organisation_id", "status"),
    )

    assignment_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("assignments.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    enrolment_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("enrolments.id", ondelete="SET NULL"))
    status: Mapped[str] = mapped_column(String(16), default=SubmissionStatus.DRAFT)
    current_version: Mapped[int] = mapped_column(Integer, default=0)
    submit_count: Mapped[int] = mapped_column(Integer, default=0)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ai_score: Mapped[float | None] = mapped_column(Float)
    human_score: Mapped[float | None] = mapped_column(Float)
    final_score: Mapped[float | None] = mapped_column(Float)
    passed: Mapped[bool | None] = mapped_column(Boolean)
    graded_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    graded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    review_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    review_request_note: Mapped[str | None] = mapped_column(Text)

    versions: Mapped[list[SubmissionVersion]] = relationship(
        back_populates="submission", order_by="SubmissionVersion.version_number", cascade="all, delete-orphan"
    )


class SubmissionVersion(UUIDPk, Timestamps, TenantScoped, Base):
    __tablename__ = "submission_versions"
    __table_args__ = (UniqueConstraint("submission_id", "version_number"),)

    submission_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("submissions.id", ondelete="CASCADE"), index=True
    )
    version_number: Mapped[int] = mapped_column(Integer)
    text_content: Mapped[str | None] = mapped_column(Text)
    code_content: Mapped[str | None] = mapped_column(Text)
    structured_answers: Mapped[dict[str, Any]] = mapped_column(default=dict)
    file_ids: Mapped[list[Any]] = mapped_column(default=list)
    is_final: Mapped[bool] = mapped_column(Boolean, default=False)  # True once submitted (immutable)
    content_sha256: Mapped[str | None] = mapped_column(String(64))

    submission: Mapped[Submission] = relationship(back_populates="versions")


class GradeSource(StrEnum):
    AUTO = "auto"
    AI = "ai"
    HUMAN = "human"


class Grade(UUIDPk, Timestamps, TenantScoped, Base):
    """Append-only grade record for a submission version or assessment answer/attempt.

    Keeps AI score, human score, assessor, timestamp and override reason for explainability & audit.
    """

    __tablename__ = "grades"
    __table_args__ = (Index("ix_grades_target", "target_type", "target_id"),)

    target_type: Mapped[str] = mapped_column(String(32))  # submission | attempt | attempt_answer
    target_id: Mapped[uuid.UUID] = mapped_column()
    submission_version: Mapped[int | None] = mapped_column(Integer)
    source: Mapped[str] = mapped_column(String(16))
    score: Mapped[float] = mapped_column(Float)
    max_score: Mapped[float] = mapped_column(Float, default=100.0)
    passed: Mapped[bool | None] = mapped_column(Boolean)
    # [{"criterion_id","name","score","max","weight","evidence","comment"}]
    rubric_breakdown: Mapped[list[Any]] = mapped_column(default=list)
    strengths: Mapped[list[Any]] = mapped_column(default=list)
    weaknesses: Mapped[list[Any]] = mapped_column(default=list)
    missing_requirements: Mapped[list[Any]] = mapped_column(default=list)
    improvements: Mapped[list[Any]] = mapped_column(default=list)
    summary: Mapped[str | None] = mapped_column(Text)
    grader_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    ai_model: Mapped[str | None] = mapped_column(String(100))
    confidence: Mapped[float | None] = mapped_column(Float)
    is_final: Mapped[bool] = mapped_column(Boolean, default=False)
    overrides_grade_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("grades.id", ondelete="SET NULL"))
    override_reason: Mapped[str | None] = mapped_column(Text)


class IntegritySignal(UUIDPk, Timestamps, TenantScoped, Base):
    """Supplementary academic-integrity signals. Never an automatic accusation — reviewed by humans."""

    __tablename__ = "integrity_signals"
    __table_args__ = (Index("ix_integrity_target", "target_type", "target_id"),)

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    target_type: Mapped[str] = mapped_column(String(32))  # submission | attempt | simulation_session
    target_id: Mapped[uuid.UUID] = mapped_column()
    signal_type: Mapped[str] = mapped_column(
        String(48)
    )  # similarity | ai_text_likelihood | timing | focus_loss
    score: Mapped[float] = mapped_column(Float)
    details: Mapped[dict[str, Any]] = mapped_column(default=dict)
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    review_outcome: Mapped[str | None] = mapped_column(String(32))  # dismissed | confirmed | inconclusive
