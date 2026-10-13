"""Pydantic schemas for rubrics, assignments, submissions and grading."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

EvidenceType = Literal["text", "file", "screenshot", "video", "audio", "code", "document", "structured"]
GradingModeLit = Literal["auto", "manual", "ai_assisted", "ai_recommend_human_final"]


# ----------------------------------------------------------------------------- rubrics


class RubricLevel(BaseModel):
    score: float = Field(ge=0, le=1000)
    label: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=5000)


class RubricCriterion(BaseModel):
    id: str | None = Field(default=None, max_length=64)
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    weight: float = Field(gt=0, le=100)
    max_score: float | None = Field(default=None, gt=0, le=1000)
    levels: list[RubricLevel] = Field(default_factory=list, max_length=20)


class RubricIn(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=10_000)
    criteria: list[RubricCriterion] = Field(min_length=1, max_length=50)


class RubricUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=10_000)
    criteria: list[RubricCriterion] | None = Field(default=None, min_length=1, max_length=50)


class RubricOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    description: str | None
    criteria: list[Any]
    total_points: float
    ai_generated: bool
    created_by: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


# ----------------------------------------------------------------------------- assignments


class EvidenceItem(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    label: str = Field(min_length=1, max_length=200)
    type: EvidenceType
    required: bool = True


class StructuredField(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    label: str = Field(min_length=1, max_length=200)
    type: str = Field(default="text", max_length=32)
    help: str | None = Field(default=None, max_length=2000)
    required: bool = True


class Resource(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    url: str | None = Field(default=None, max_length=2048)
    file_id: uuid.UUID | None = None


class AssignmentFields(BaseModel):
    course_id: uuid.UUID | None = None
    scenario: str | None = Field(default=None, max_length=50_000)
    objective: str | None = Field(default=None, max_length=20_000)
    instructions: str | None = Field(default=None, max_length=50_000)
    required_evidence: list[EvidenceItem] | None = Field(default=None, max_length=50)
    structured_fields: list[StructuredField] | None = Field(default=None, max_length=100)
    resources: list[Resource] | None = Field(default=None, max_length=100)
    expected_output: str | None = Field(default=None, max_length=50_000)
    evaluation_criteria: str | None = Field(default=None, max_length=20_000)
    rubric_id: uuid.UUID | None = None
    time_limit_minutes: int | None = Field(default=None, ge=1, le=60 * 24 * 30)
    due_days_after_enrolment: int | None = Field(default=None, ge=0, le=3650)
    passing_score: float | None = Field(default=None, ge=0, le=100)
    grading_mode: GradingModeLit | None = None
    high_stakes: bool | None = None
    max_submissions: int | None = Field(default=None, ge=1, le=100)
    allowed_file_types: list[str] | None = Field(default=None, max_length=50)
    skill_ids: list[uuid.UUID] | None = None


class AssignmentCreate(AssignmentFields):
    title: str = Field(min_length=1, max_length=255)


class AssignmentUpdate(AssignmentFields):
    title: str | None = Field(default=None, min_length=1, max_length=255)


class LearnerAssignmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    course_id: uuid.UUID | None
    title: str
    scenario: str
    objective: str
    instructions: str
    required_evidence: list[Any]
    structured_fields: list[Any]
    resources: list[Any]
    evaluation_criteria: str | None
    rubric_id: uuid.UUID | None
    time_limit_minutes: int | None
    due_days_after_enrolment: int | None
    passing_score: float
    grading_mode: str
    high_stakes: bool
    max_submissions: int | None
    allowed_file_types: list[Any]
    status: str
    skill_ids: list[Any]
    created_at: datetime
    updated_at: datetime
    rubric: RubricOut | None = None


class AssignmentOut(LearnerAssignmentOut):
    expected_output: str | None
    created_by: uuid.UUID | None
    ai_generated: bool


# ----------------------------------------------------------------------------- submissions


class DraftIn(BaseModel):
    text_content: str | None = Field(default=None, max_length=200_000)
    code_content: str | None = Field(default=None, max_length=200_000)
    structured_answers: dict[str, Any] = Field(default_factory=dict)
    file_ids: list[uuid.UUID] = Field(default_factory=list, max_length=50)


class FileRef(BaseModel):
    id: uuid.UUID
    filename: str
    content_type: str
    size_bytes: int
    sha256: str
    scan_status: str


class VersionOut(BaseModel):
    id: uuid.UUID
    version_number: int
    text_content: str | None
    code_content: str | None
    structured_answers: dict[str, Any]
    file_ids: list[Any]
    files: list[FileRef] = []
    is_final: bool
    content_sha256: str | None
    created_at: datetime


class GradeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    target_type: str
    submission_version: int | None
    source: str
    score: float
    max_score: float
    passed: bool | None
    rubric_breakdown: list[Any]
    strengths: list[Any]
    weaknesses: list[Any]
    missing_requirements: list[Any]
    improvements: list[Any]
    summary: str | None
    grader_id: uuid.UUID | None
    ai_model: str | None
    confidence: float | None
    is_final: bool
    overrides_grade_id: uuid.UUID | None
    override_reason: str | None
    created_at: datetime


class SubmissionOut(BaseModel):
    id: uuid.UUID
    assignment_id: uuid.UUID
    user_id: uuid.UUID
    status: str
    current_version: int
    submit_count: int
    submissions_remaining: int | None
    started_at: datetime | None
    submitted_at: datetime | None
    due_at: datetime | None
    late: bool
    final_score: float | None
    passed: bool | None
    graded_at: datetime | None
    review_requested: bool
    review_request_note: str | None
    latest_version: VersionOut | None
    grade: GradeOut | None = None
    returned_feedback: str | None = None


class SubmitResult(SubmissionOut):
    integrity_flagged: bool = False


class RequestReviewIn(BaseModel):
    note: str = Field(min_length=1, max_length=5000)


# ----------------------------------------------------------------------------- grading


class RubricScoreIn(BaseModel):
    criterion_id: str = Field(min_length=1, max_length=64)
    score: float = Field(ge=0)
    comment: str | None = Field(default=None, max_length=5000)


class HumanGradeIn(BaseModel):
    rubric_scores: list[RubricScoreIn] = Field(default_factory=list, max_length=50)
    score: float | None = Field(default=None, ge=0, le=100, description="Percentage; only when no rubric")
    summary: str | None = Field(default=None, max_length=20_000)
    strengths: list[str] = Field(default_factory=list, max_length=50)
    weaknesses: list[str] = Field(default_factory=list, max_length=50)
    improvements: list[str] = Field(default_factory=list, max_length=50)
    missing_requirements: list[str] = Field(default_factory=list, max_length=50)
    override_reason: str | None = Field(default=None, max_length=5000)


class ReturnIn(BaseModel):
    feedback: str = Field(min_length=1, max_length=20_000)


class AIRecommendation(BaseModel):
    grade_id: uuid.UUID
    score: float
    passed: bool | None
    confidence: float | None
    summary: str | None
    ai_model: str | None


class QueueItem(BaseModel):
    submission_id: uuid.UUID
    assignment_id: uuid.UUID
    assignment_title: str
    course_id: uuid.UUID | None
    user_id: uuid.UUID
    learner_name: str
    status: str
    version: int
    submitted_at: datetime | None
    high_stakes: bool
    grading_mode: str
    review_requested: bool
    integrity_flags: int
    ai_recommendation: AIRecommendation | None
    final_score: float | None = None
    passed: bool | None = None
    graded_at: datetime | None = None


class IntegritySignalOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    target_type: str
    target_id: uuid.UUID
    signal_type: str
    score: float
    details: dict[str, Any]
    reviewed_by: uuid.UUID | None
    review_outcome: str | None
    created_at: datetime


class IntegrityReviewIn(BaseModel):
    outcome: Literal["dismissed", "confirmed", "inconclusive"]


class LearnerRef(BaseModel):
    id: uuid.UUID
    full_name: str
    email: str


class GradingDetail(BaseModel):
    submission: SubmissionOut
    assignment: AssignmentOut
    learner: LearnerRef
    versions: list[VersionOut]
    grades: list[GradeOut]
    integrity_signals: list[IntegritySignalOut]
    ai_recommendation: GradeOut | None
