from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class PlatformOrgOut(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    kind: str
    status: str
    plan_code: str
    member_count: int
    course_count: int
    custom_domain: str | None
    feature_overrides: dict[str, bool]
    created_at: datetime
    deleted_at: datetime | None = None


class UserRef(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str


class SubscriptionSummary(BaseModel):
    plan_code: str
    status: str
    seats: int
    billing_interval: str
    current_period_end: datetime | None
    cancel_at_period_end: bool


class PlatformOrgDetail(PlatformOrgOut):
    settings: dict[str, Any]
    admins: list[UserRef]
    subscription: SubscriptionSummary | None
    storage_bytes: int
    ai_cost_30d_usd: float
    enrolment_count: int


class PlanChange(BaseModel):
    plan_code: str | None = Field(default=None, max_length=32)
    feature_overrides: dict[str, bool | None] | None = Field(
        default=None, description="Feature -> true/false to override the plan; null removes an override"
    )
    seats: int | None = Field(default=None, ge=1, le=1_000_000)


class StatusChange(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


class PlatformUserOut(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str
    status: str
    is_superadmin: bool
    mfa_enabled: bool
    organisation_count: int
    created_at: datetime
    last_login_at: datetime | None


class SuperadminSet(BaseModel):
    is_superadmin: bool


class HealthOut(BaseModel):
    status: str
    database: dict[str, Any]
    redis: dict[str, Any]
    queue: dict[str, Any]
    storage: dict[str, Any]
    ai: dict[str, Any]
    totals: dict[str, int]
    metrics: dict[str, Any]
