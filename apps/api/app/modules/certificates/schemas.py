"""Certificate request / response schemas."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class CertificateOut(BaseModel):
    id: uuid.UUID
    certificate_number: str
    user_id: uuid.UUID
    course_id: uuid.UUID
    course_version_id: uuid.UUID | None
    enrolment_id: uuid.UUID | None
    learner_name: str
    course_title: str
    organisation_name: str
    instructor_name: str | None
    score: float | None
    issued_at: datetime
    expires_at: datetime | None
    revoked_at: datetime | None
    revoke_reason: str | None
    status: str  # valid | revoked | expired
    skills: list[Any]
    issued_by: uuid.UUID | None
    verification_url: str
    pdf_url: str


class IssueIn(BaseModel):
    user_id: uuid.UUID
    course_id: uuid.UUID
    score: float | None = Field(default=None, ge=0, le=100)
    expires_at: datetime | None = None


class RevokeIn(BaseModel):
    reason: str = Field(min_length=3, max_length=2000)


class VerificationOut(BaseModel):
    valid: bool
    status: str  # valid | revoked | expired | invalid (tampered)
    certificate_number: str
    learner_name: str
    course_title: str
    organisation_name: str
    issued_at: datetime
    expires_at: datetime | None
    score: float | None
    instructor_name: str | None
    skills: list[str]
    revoked_at: datetime | None
