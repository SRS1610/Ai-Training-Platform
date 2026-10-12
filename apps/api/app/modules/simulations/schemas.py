"""Request/response models for simulations, scenario versions, the builder and learner sessions."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

Difficulty = Literal["beginner", "intermediate", "advanced", "expert"]


class SimulationBase(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: str = Field("", max_length=20_000)
    industry: str = Field("it", max_length=64)
    environment_type: str = Field("helpdesk", max_length=64)
    difficulty: Difficulty = "intermediate"
    estimated_minutes: int = Field(20, ge=1, le=600)
    course_id: uuid.UUID | None = None
    is_graded: bool = True
    max_attempts: int | None = Field(None, ge=1, le=100)
    skill_ids: list[uuid.UUID] = Field(default_factory=list)


class SimulationCreate(BaseModel):
    """Create from scratch (starter definition), from a packaged template, or from a full definition."""

    title: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = Field(None, max_length=20_000)
    industry: str | None = Field(None, max_length=64)
    environment_type: str | None = Field(None, max_length=64)
    difficulty: Difficulty | None = None
    estimated_minutes: int | None = Field(None, ge=1, le=600)
    course_id: uuid.UUID | None = None
    is_graded: bool = True
    max_attempts: int | None = Field(None, ge=1, le=100)
    skill_ids: list[uuid.UUID] = Field(default_factory=list)
    template_key: str | None = None
    definition: dict[str, Any] | None = None


class FromTemplate(BaseModel):
    template_key: str
    title: str | None = Field(None, min_length=1, max_length=255)
    course_id: uuid.UUID | None = None


class SimulationUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = Field(None, max_length=20_000)
    industry: str | None = Field(None, max_length=64)
    environment_type: str | None = Field(None, max_length=64)
    difficulty: Difficulty | None = None
    estimated_minutes: int | None = Field(None, ge=1, le=600)
    course_id: uuid.UUID | None = None
    is_graded: bool | None = None
    max_attempts: int | None = Field(None, ge=1, le=100)
    skill_ids: list[uuid.UUID] | None = None


class SimulationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    description: str
    industry: str
    environment_type: str
    difficulty: str
    estimated_minutes: int
    course_id: uuid.UUID | None
    status: str
    is_graded: bool
    max_attempts: int | None
    current_scenario_id: uuid.UUID | None
    skill_ids: list[Any]
    ai_generated: bool
    created_by: uuid.UUID | None
    created_at: datetime
    updated_at: datetime
    published_version: int | None = None
    draft_version: int | None = None


class TemplateOut(BaseModel):
    key: str
    title: str
    description: str
    industry: str | None
    environment_type: str | None
    difficulty: str | None
    estimated_minutes: int | None
    learner_role: str
    tags: list[str]
    actions: int
    phases: list[str]


class ValidationIssue(BaseModel):
    code: str
    path: str
    message: str


class ValidationOut(BaseModel):
    valid: bool
    errors: list[ValidationIssue]
    warnings: list[ValidationIssue]
    stats: dict[str, Any] = Field(default_factory=dict)


class DraftIn(BaseModel):
    definition: dict[str, Any]


class DraftOut(BaseModel):
    simulation_id: uuid.UUID
    scenario_id: uuid.UUID
    version: int
    status: str
    definition: dict[str, Any]
    validation: ValidationOut
    updated_at: datetime


class GraphIn(BaseModel):
    graph: dict[str, Any]


class GraphOut(BaseModel):
    simulation_id: uuid.UUID
    scenario_id: uuid.UUID
    version: int
    graph: dict[str, Any]
    validation: ValidationOut


class ValidateIn(BaseModel):
    definition: dict[str, Any] | None = None


class VersionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    version: int
    status: str
    published_at: datetime | None
    published_by: uuid.UUID | None
    created_by: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


class VersionDetail(VersionOut):
    definition: dict[str, Any]


class PublishOut(BaseModel):
    simulation: SimulationOut
    published: VersionOut
    validation: ValidationOut


class AIBuildIn(BaseModel):
    description: str = Field(min_length=10, max_length=4000)
    industry: str | None = Field(None, max_length=64)
    difficulty: Difficulty | None = None
    learner_role: str | None = Field(None, max_length=120)
    title: str | None = Field(None, min_length=1, max_length=255)
    course_id: uuid.UUID | None = None


class AIBuildOut(BaseModel):
    simulation: SimulationOut
    scenario_id: uuid.UUID
    validation: ValidationOut
    source: Literal["ai", "fallback"]
    repairs: list[str]


# ---------------------------------------------------------------------------------------------- sessions


class SessionStart(BaseModel):
    seed: int | None = Field(
        None, ge=0, le=2**31 - 1
    )  # honoured for simulation managers (testing variations)


class SessionSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    simulation_id: uuid.UUID
    scenario_id: uuid.UUID
    user_id: uuid.UUID
    attempt_number: int
    status: str
    phase: str
    action_count: int
    sim_minutes_elapsed: float
    total_score: float | None
    band: str | None
    passed: bool | None
    started_at: datetime
    completed_at: datetime | None
    last_activity_at: datetime | None


class SessionOut(BaseModel):
    id: uuid.UUID
    simulation_id: uuid.UUID
    scenario_id: uuid.UUID
    status: str
    attempt_number: int
    is_graded: bool
    show_feedback: bool
    started_at: datetime
    completed_at: datetime | None
    expires_at: datetime | None
    phase: str
    sim_minutes: float
    action_count: int
    next_seq: int
    resumed: bool = False
    view: dict[str, Any]
    result: dict[str, Any] | None = None


class ActionIn(BaseModel):
    """Either an explicit ``action_id`` (buttons, choices, documents) or free ``input.text`` resolved
    against ``tool`` (typed commands) / ``character`` (chat)."""

    action_id: str | None = Field(None, max_length=128)
    tool: str | None = Field(None, max_length=64)
    character: str | None = Field(None, max_length=64)
    input: dict[str, Any] | str | None = None
    client_seq: int = Field(ge=1)


class ChatIn(BaseModel):
    character_id: str = Field(min_length=1, max_length=64)
    message: str = Field(min_length=1, max_length=2000)
    client_seq: int | None = Field(None, ge=1)


class StepOut(BaseModel):
    session_id: uuid.UUID
    seq: int
    replayed: bool = False
    accepted: bool
    outcome: dict[str, Any]
    reply: dict[str, Any] | None = None  # chat only
    status: str
    phase: str
    sim_minutes: float
    ended: bool
    next_seq: int
    view: dict[str, Any]
    result: dict[str, Any] | None = None


class ResultOut(BaseModel):
    session_id: uuid.UUID
    simulation_id: uuid.UUID
    status: str
    attempt_number: int
    total_score: float | None
    band: str | None
    passed: bool | None
    dimensions: list[dict[str, Any]]
    feedback: dict[str, Any]
    narrative: str | None
    end_reason: str | None
    sim_minutes: float
    target_minutes: float | None
    started_at: datetime
    completed_at: datetime | None


class ReplayOut(BaseModel):
    session: SessionSummary
    actions: list[dict[str, Any]]
    states: list[dict[str, Any]]
    transcript: list[dict[str, Any]]
