"""Pydantic schemas for question banks, questions, assessments, attempts and manual grading."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

QuestionTypeLit = Literal[
    "multiple_choice", "multiple_select", "true_false", "short_answer", "long_answer", "matching", "ordering",
    "fill_blank", "code", "file_upload", "scenario", "decision_tree", "practical_task", "simulation",
]
GradingModeLit = Literal["auto", "manual", "ai_assisted", "ai_recommend_human_final"]
ShowFeedbackLit = Literal["after_submit", "after_close", "never"]


# ----------------------------------------------------------------------------- banks


class BankCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=10_000)
    course_id: uuid.UUID | None = None


class BankUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=10_000)
    course_id: uuid.UUID | None = None


class BankOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    description: str | None
    course_id: uuid.UUID | None
    created_by: uuid.UUID | None
    created_at: datetime
    updated_at: datetime
    question_count: int = 0


# ----------------------------------------------------------------------------- questions


class QuestionIn(BaseModel):
    bank_id: uuid.UUID | None = None
    question_type: QuestionTypeLit
    prompt: str = Field(min_length=1, max_length=20_000)
    options: dict[str, Any] = Field(default_factory=dict)
    answer_key: dict[str, Any] = Field(default_factory=dict)
    explanation: str | None = Field(default=None, max_length=20_000)
    points: float = Field(default=1.0, ge=0, le=1000)
    negative_points: float = Field(default=0.0, ge=0, le=1000)
    difficulty: int = Field(default=2, ge=1, le=5)
    tags: list[str] = Field(default_factory=list, max_length=50)
    skill_ids: list[uuid.UUID] = Field(default_factory=list)
    rubric_id: uuid.UUID | None = None
    status: Literal["draft", "active", "retired"] = "active"


class QuestionUpdate(BaseModel):
    bank_id: uuid.UUID | None = None
    question_type: QuestionTypeLit | None = None
    prompt: str | None = Field(default=None, min_length=1, max_length=20_000)
    options: dict[str, Any] | None = None
    answer_key: dict[str, Any] | None = None
    explanation: str | None = Field(default=None, max_length=20_000)
    points: float | None = Field(default=None, ge=0, le=1000)
    negative_points: float | None = Field(default=None, ge=0, le=1000)
    difficulty: int | None = Field(default=None, ge=1, le=5)
    tags: list[str] | None = None
    skill_ids: list[uuid.UUID] | None = None
    rubric_id: uuid.UUID | None = None
    status: Literal["draft", "active", "retired"] | None = None


class QuestionOut(BaseModel):
    """Staff view (includes the answer key)."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    bank_id: uuid.UUID | None
    question_type: str
    prompt: str
    options: dict[str, Any]
    answer_key: dict[str, Any]
    explanation: str | None
    points: float
    negative_points: float
    difficulty: int
    tags: list[Any]
    skill_ids: list[Any]
    rubric_id: uuid.UUID | None
    version: int
    status: str
    ai_generated: bool
    created_at: datetime
    updated_at: datetime


class QuestionImport(BaseModel):
    questions: list[QuestionIn] = Field(min_length=1, max_length=1000)


class ImportResult(BaseModel):
    imported: int
    question_ids: list[uuid.UUID]


class BankExport(BaseModel):
    format: str = "praxis.question_bank.v1"
    bank: dict[str, Any]
    questions: list[dict[str, Any]]


# ----------------------------------------------------------------------------- assessments


class ItemIn(BaseModel):
    question_id: uuid.UUID | None = None
    bank_id: uuid.UUID | None = None
    draw_count: int = Field(default=1, ge=1, le=500)
    filters: dict[str, Any] = Field(default_factory=dict)  # {"difficulty": [2,3], "tags": ["network"]}
    weight: float = Field(default=1.0, gt=0, le=100)


class ItemOut(ItemIn):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    position: int


class AssessmentSettings(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=20_000)
    course_id: uuid.UUID | None = None
    kind: Literal["quiz", "final", "practice", "survey"] | None = None
    time_limit_minutes: int | None = Field(default=None, ge=1, le=24 * 60)
    max_attempts: int | None = Field(default=None, ge=1, le=100)
    pass_percentage: float | None = Field(default=None, ge=0, le=100)
    shuffle_questions: bool | None = None
    shuffle_options: bool | None = None
    negative_marking: bool | None = None
    grading_mode: GradingModeLit | None = None
    high_stakes: bool | None = None
    show_feedback: ShowFeedbackLit | None = None
    weight_in_course: float | None = Field(default=None, ge=0, le=100)


class AssessmentCreate(AssessmentSettings):
    title: str = Field(min_length=1, max_length=255)
    items: list[ItemIn] = Field(default_factory=list, max_length=500)


class AssessmentUpdate(AssessmentSettings):
    """PATCH: only fields that are explicitly set are applied (``null`` clears time limit / max attempts)."""


class ItemsReplace(BaseModel):
    items: list[ItemIn] = Field(max_length=500)


class AssessmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    course_id: uuid.UUID | None
    title: str
    description: str | None
    kind: str
    time_limit_minutes: int | None
    max_attempts: int | None
    pass_percentage: float
    shuffle_questions: bool
    shuffle_options: bool
    negative_marking: bool
    grading_mode: str
    high_stakes: bool
    show_feedback: str
    status: str
    weight_in_course: float
    created_by: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


class AssessmentDetail(AssessmentOut):
    items: list[ItemOut] = []
    question_count: int = 0


class LearnerAssessment(BaseModel):
    id: uuid.UUID
    course_id: uuid.UUID | None
    title: str
    description: str | None
    kind: str
    time_limit_minutes: int | None
    max_attempts: int | None
    pass_percentage: float
    question_count: int
    high_stakes: bool
    show_feedback: str


class AttemptSummary(BaseModel):
    id: uuid.UUID
    attempt_number: int
    status: str
    started_at: datetime
    submitted_at: datetime | None
    expires_at: datetime | None
    score: float | None
    max_score: float | None
    percentage: float | None
    passed: bool | None


class Overview(BaseModel):
    assessment: LearnerAssessment
    attempts_used: int
    attempts_remaining: int | None
    best_percentage: float | None
    passed: bool
    can_start: bool
    reason: str | None
    in_progress_attempt_id: uuid.UUID | None
    attempts: list[AttemptSummary]


# ----------------------------------------------------------------------------- attempts


class AttemptQuestion(BaseModel):
    id: str
    position: int
    question_type: str
    prompt: str
    options: dict[str, Any]
    points: float


class AttemptOut(BaseModel):
    id: uuid.UUID
    assessment_id: uuid.UUID
    title: str
    attempt_number: int
    status: str
    started_at: datetime
    expires_at: datetime | None
    submitted_at: datetime | None
    remaining_seconds: int | None
    server_time: datetime
    questions: list[AttemptQuestion]
    responses: dict[str, dict[str, Any]]


class AnswerIn(BaseModel):
    response: dict[str, Any]


class AnswerSaved(BaseModel):
    question_id: str
    saved_at: datetime
    remaining_seconds: int | None


class IntegrityEventIn(BaseModel):
    event: Literal["focus_lost", "focus_returned", "paste", "copy", "visibility_hidden", "fullscreen_exit",
                   "devtools_open", "resize", "other"]
    detail: str | None = Field(default=None, max_length=500)
    question_id: str | None = Field(default=None, max_length=64)


class ResultQuestion(BaseModel):
    id: str
    position: int
    question_type: str
    prompt: str
    options: dict[str, Any]
    max_score: float
    response: dict[str, Any]
    score: float | None
    is_correct: bool | None
    pending_review: bool
    feedback: str | None = None
    ai_feedback: dict[str, Any] | None = None
    correct_answer: dict[str, Any] | None = None
    explanation: str | None = None


class AttemptResult(BaseModel):
    id: uuid.UUID
    assessment_id: uuid.UUID
    user_id: uuid.UUID
    title: str
    attempt_number: int
    status: str
    started_at: datetime
    submitted_at: datetime | None
    score: float | None
    max_score: float | None
    percentage: float | None
    passed: bool | None
    pass_percentage: float
    late: bool
    feedback_available: bool
    questions: list[ResultQuestion]
    integrity: dict[str, Any] | None = None


class ManualGradeIn(BaseModel):
    score: float = Field(ge=0)
    feedback: str | None = Field(default=None, max_length=20_000)
    override_reason: str | None = Field(default=None, max_length=5000)


class ReviewQueueItem(BaseModel):
    attempt_id: uuid.UUID
    assessment_id: uuid.UUID
    assessment_title: str
    course_id: uuid.UUID | None
    user_id: uuid.UUID
    learner_name: str
    attempt_number: int
    submitted_at: datetime | None
    pending_questions: int
    high_stakes: bool
    grading_mode: str


class QuestionStat(BaseModel):
    question_id: str
    prompt: str
    question_type: str
    responses: int
    answered: int
    mean_score_pct: float | None
    correct_rate: float | None
    discrimination: float | None
    choice_distribution: dict[str, int] = {}


class AssessmentStats(BaseModel):
    assessment_id: uuid.UUID
    attempts: int
    graded_attempts: int
    mean_percentage: float | None
    pass_rate: float | None
    questions: list[QuestionStat]
