from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Purpose = Literal["terms", "privacy_policy", "marketing", "ai_processing", "analytics"]


class ConsentIn(BaseModel):
    purpose: Purpose
    granted: bool
    policy_version: str = Field(default="2026-01", min_length=1, max_length=32)


class ConsentsUpdate(BaseModel):
    consents: list[ConsentIn] = Field(min_length=1, max_length=10)


class ConsentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    purpose: str
    policy_version: str
    granted: bool
    organisation_id: uuid.UUID | None
    created_at: datetime


class ConsentsOut(BaseModel):
    current: dict[str, ConsentOut]
    history: list[ConsentOut]


class DataRequestOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    kind: str
    status: str
    created_at: datetime
    completed_at: datetime | None
    error: str | None
    download_url: str | None = None


class DeleteAccountIn(BaseModel):
    password: str | None = Field(default=None, max_length=256)
    confirm_email: str | None = Field(
        default=None,
        max_length=320,
        description="Required instead of a password for accounts without one (SSO)",
    )


class RetentionOut(BaseModel):
    retention_days: int
    applies_to: list[str] = ["notifications", "ai_messages"]
    note: str = "Audit logs are never deleted by retention."


class RetentionIn(BaseModel):
    retention_days: int = Field(ge=30, le=3650)


class RetentionRunOut(BaseModel):
    notifications_deleted: int
    ai_messages_deleted: int
    ai_sessions_deleted: int
    cutoff: datetime
