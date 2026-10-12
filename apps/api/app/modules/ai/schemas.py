"""AI configuration and usage API schemas."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

ProviderName = Literal["openai", "anthropic", "azure_openai", "google", "local", "offline"]
FEATURE_KEYS = ("tutor", "content_generation", "grading", "simulation_ai", "recommendations")


class AIConfigOut(BaseModel):
    provider: str
    effective_provider: str
    offline: bool
    model: str
    effective_model: str
    embedding_model: str
    temperature: float
    max_output_tokens: int
    features: dict[str, bool]
    monthly_budget_usd: float | None
    plan_budget_usd: float | None
    effective_budget_usd: float | None
    hard_limit: bool
    alert_thresholds: list[int]
    per_user_daily_requests: int | None
    tutor_behaviour: dict[str, Any]
    grading_mode: str
    knowledge_only: bool
    server_keys: dict[str, bool]
    plan_features: dict[str, bool]
    updated_at: datetime | None = None


class AIConfigUpdate(BaseModel):
    provider: ProviderName | None = None
    model: str | None = Field(default=None, max_length=100)
    embedding_model: str | None = Field(default=None, max_length=100)
    temperature: float | None = Field(default=None, ge=0, le=2)
    max_output_tokens: int | None = Field(default=None, ge=64, le=32000)
    features: dict[str, bool] | None = None
    monthly_budget_usd: float | None = Field(default=None, ge=0, le=1_000_000)
    clear_budget: bool = False  # set true to fall back to the plan's budget
    hard_limit: bool | None = None
    alert_thresholds: list[int] | None = None
    per_user_daily_requests: int | None = Field(default=None, ge=0, le=100_000)
    tutor_behaviour: dict[str, Any] | None = None
    grading_mode: Literal["ai_assisted", "ai_recommend_human_final", "manual"] | None = None
    knowledge_only: bool | None = None

    @field_validator("features")
    @classmethod
    def _features(cls, v: dict[str, bool] | None) -> dict[str, bool] | None:
        if v is None:
            return v
        unknown = set(v) - set(FEATURE_KEYS)
        if unknown:
            raise ValueError(f"Unknown features: {', '.join(sorted(unknown))}")
        return v

    @field_validator("alert_thresholds")
    @classmethod
    def _thresholds(cls, v: list[int] | None) -> list[int] | None:
        if v is None:
            return v
        if any(t <= 0 or t > 100 for t in v):
            raise ValueError("Thresholds must be between 1 and 100")
        return sorted(set(v))

    @field_validator("tutor_behaviour")
    @classmethod
    def _behaviour(cls, v: dict[str, Any] | None) -> dict[str, Any] | None:
        if v is None:
            return v
        allowed = {"tone", "socratic", "citations", "cite_sources", "language", "max_hint_level"}
        return {k: val for k, val in v.items() if k in allowed}


class UsageTotals(BaseModel):
    requests: int
    failures: int
    tokens_in: int
    tokens_out: int
    cost_usd: float


class UsageBucket(BaseModel):
    key: str | None
    label: str | None = None
    requests: int
    tokens_in: int
    tokens_out: int
    cost_usd: float


class DailyPoint(BaseModel):
    date: date
    requests: int
    cost_usd: float
    tokens: int


class BudgetOut(BaseModel):
    budget_usd: float | None
    spent_usd: float
    pct_used: float | None
    hard_limit: bool
    alert_thresholds: list[int]
    remaining_usd: float | None


class AlertOut(BaseModel):
    period: str
    threshold: int
    spend_usd: float
    created_at: datetime


class UsageOut(BaseModel):
    period: str
    period_start: datetime
    totals: UsageTotals
    by_feature: list[UsageBucket]
    by_model: list[UsageBucket]
    by_user: list[UsageBucket]
    by_course: list[UsageBucket]
    daily: list[DailyPoint]
    budget: BudgetOut
    alerts: list[AlertOut]
    offline: bool


class ProviderInfo(BaseModel):
    id: str
    name: str
    configured: bool
    default_model: str
    models: list[str]
    supports_embeddings: bool
    notes: str | None = None


class BudgetCheckOut(BaseModel):
    organisation_id: uuid.UUID
    new_alerts: list[int]
