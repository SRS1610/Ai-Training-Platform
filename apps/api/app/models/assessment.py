"""Assessment engine: question banks, questions, assessments (quizzes / finals), attempts and answers."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, SoftDelete, StrEnum, TenantScoped, Timestamps, UUIDPk


class QuestionType(StrEnum):
    MULTIPLE_CHOICE = "multiple_choice"
    MULTIPLE_SELECT = "multiple_select"
    TRUE_FALSE = "true_false"
    SHORT_ANSWER = "short_answer"
    LONG_ANSWER = "long_answer"
    MATCHING = "matching"
    ORDERING = "ordering"
    FILL_BLANK = "fill_blank"
    CODE = "code"
    FILE_UPLOAD = "file_upload"
    SCENARIO = "scenario"
    DECISION_TREE = "decision_tree"
    PRACTICAL_TASK = "practical_task"
    SIMULATION = "simulation"


AUTO_GRADED_TYPES = {
    QuestionType.MULTIPLE_CHOICE,
    QuestionType.MULTIPLE_SELECT,
    QuestionType.TRUE_FALSE,
    QuestionType.SHORT_ANSWER,
    QuestionType.MATCHING,
    QuestionType.ORDERING,
    QuestionType.FILL_BLANK,
    QuestionType.DECISION_TREE,
}


class GradingMode(StrEnum):
    AUTO = "auto"  # objective items auto-scored, others manual
    MANUAL = "manual"
    AI_ASSISTED = "ai_assisted"  # AI grades, released immediately, human may override
    AI_RECOMMEND_HUMAN_FINAL = "ai_recommend_human_final"  # high-stakes: AI recommends, human decides


class QuestionBank(UUIDPk, Timestamps, SoftDelete, TenantScoped, Base):
    __tablename__ = "question_banks"

    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text)
    course_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("courses.id", ondelete="SET NULL"), index=True
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    questions: Mapped[list[Question]] = relationship(back_populates="bank")


class Question(UUIDPk, Timestamps, SoftDelete, TenantScoped, Base):
    __tablename__ = "questions"
    __table_args__ = (Index("ix_questions_bank_difficulty", "bank_id", "difficulty"),)

    bank_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("question_banks.id", ondelete="SET NULL"))
    question_type: Mapped[str] = mapped_column(String(32))
    prompt: Mapped[str] = mapped_column(Text)
    # Type specific: {"choices":[{"id","text"}]} | {"pairs":[...]} | {"items":[...]} | {"tree": {...}} ...
    options: Mapped[dict[str, Any]] = mapped_column(default=dict)
    # Never sent to learners. {"choice_ids":[..]} | {"value": true} | {"accepted":[..]} | {"order":[..]} ...
    answer_key: Mapped[dict[str, Any]] = mapped_column(default=dict)
    explanation: Mapped[str | None] = mapped_column(Text)
    points: Mapped[float] = mapped_column(Float, default=1.0)
    negative_points: Mapped[float] = mapped_column(Float, default=0.0)
    difficulty: Mapped[int] = mapped_column(Integer, default=2)  # 1 (easy) .. 5 (hard)
    tags: Mapped[list[Any]] = mapped_column(default=list)
    skill_ids: Mapped[list[Any]] = mapped_column(default=list)
    rubric_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("rubrics.id", ondelete="SET NULL"))
    version: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(16), default="active")  # draft | active | retired
    ai_generated: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    bank: Mapped[QuestionBank | None] = relationship(back_populates="questions")


class AssessmentKind(StrEnum):
    QUIZ = "quiz"
    FINAL = "final"
    PRACTICE = "practice"
    SURVEY = "survey"


class Assessment(UUIDPk, Timestamps, SoftDelete, TenantScoped, Base):
    __tablename__ = "assessments"

    course_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("courses.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(String(16), default=AssessmentKind.QUIZ)
    time_limit_minutes: Mapped[int | None] = mapped_column(Integer)
    max_attempts: Mapped[int | None] = mapped_column(Integer, default=3)
    pass_percentage: Mapped[float] = mapped_column(Float, default=70.0)
    shuffle_questions: Mapped[bool] = mapped_column(Boolean, default=True)
    shuffle_options: Mapped[bool] = mapped_column(Boolean, default=True)
    negative_marking: Mapped[bool] = mapped_column(Boolean, default=False)
    grading_mode: Mapped[str] = mapped_column(String(32), default=GradingMode.AUTO)
    high_stakes: Mapped[bool] = mapped_column(Boolean, default=False)
    show_feedback: Mapped[str] = mapped_column(
        String(16), default="after_submit"
    )  # after_submit|after_close|never
    status: Mapped[str] = mapped_column(String(16), default="draft")  # draft | published | archived
    weight_in_course: Mapped[float] = mapped_column(Float, default=1.0)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    items: Mapped[list[AssessmentItem]] = relationship(
        back_populates="assessment", order_by="AssessmentItem.position", cascade="all, delete-orphan"
    )


class AssessmentItem(UUIDPk, TenantScoped, Base):
    """Either a fixed question or a random pool draw from a bank (``bank_id`` + ``draw_count`` + filters)."""

    __tablename__ = "assessment_items"

    assessment_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("assessments.id", ondelete="CASCADE"), index=True
    )
    position: Mapped[int] = mapped_column(Integer, default=0)
    question_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("questions.id", ondelete="CASCADE"))
    bank_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("question_banks.id", ondelete="CASCADE"))
    draw_count: Mapped[int] = mapped_column(Integer, default=1)
    filters: Mapped[dict[str, Any]] = mapped_column(default=dict)  # {"difficulty": [2,3], "tags": [...]}
    weight: Mapped[float] = mapped_column(Float, default=1.0)

    assessment: Mapped[Assessment] = relationship(back_populates="items")


class AttemptStatus(StrEnum):
    IN_PROGRESS = "in_progress"
    SUBMITTED = "submitted"
    NEEDS_REVIEW = "needs_review"
    GRADED = "graded"
    EXPIRED = "expired"


class AssessmentAttempt(UUIDPk, Timestamps, TenantScoped, Base):
    __tablename__ = "assessment_attempts"
    __table_args__ = (
        UniqueConstraint("assessment_id", "user_id", "attempt_number"),
        Index("ix_attempts_org_user", "organisation_id", "user_id"),
    )

    assessment_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("assessments.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    enrolment_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("enrolments.id", ondelete="SET NULL"))
    attempt_number: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(16), default=AttemptStatus.IN_PROGRESS)
    # Frozen copy of the drawn questions incl. answer keys and option order — results never change
    # retroactively when the bank is edited.
    questions_snapshot: Mapped[list[Any]] = mapped_column(default=list)
    settings_snapshot: Mapped[dict[str, Any]] = mapped_column(default=dict)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    score: Mapped[float | None] = mapped_column(Float)
    max_score: Mapped[float | None] = mapped_column(Float)
    percentage: Mapped[float | None] = mapped_column(Float)
    passed: Mapped[bool | None] = mapped_column(Boolean)
    graded_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    graded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    integrity: Mapped[dict[str, Any]] = mapped_column(default=dict)  # focus losses, timing signals

    answers: Mapped[list[AttemptAnswer]] = relationship(
        back_populates="attempt", cascade="all, delete-orphan"
    )


class AttemptAnswer(UUIDPk, Timestamps, TenantScoped, Base):
    __tablename__ = "attempt_answers"
    __table_args__ = (UniqueConstraint("attempt_id", "question_id"),)

    attempt_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("assessment_attempts.id", ondelete="CASCADE"), index=True
    )
    question_id: Mapped[uuid.UUID] = mapped_column()
    response: Mapped[dict[str, Any]] = mapped_column(default=dict)
    is_correct: Mapped[bool | None] = mapped_column(Boolean)
    auto_score: Mapped[float | None] = mapped_column(Float)
    ai_score: Mapped[float | None] = mapped_column(Float)
    manual_score: Mapped[float | None] = mapped_column(Float)
    final_score: Mapped[float | None] = mapped_column(Float)
    feedback: Mapped[str | None] = mapped_column(Text)
    ai_feedback: Mapped[dict[str, Any] | None] = mapped_column()
    graded_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    attempt: Mapped[AssessmentAttempt] = relationship(back_populates="answers")
