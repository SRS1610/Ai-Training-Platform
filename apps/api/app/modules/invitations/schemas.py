from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class InvitationCreate(BaseModel):
    email: EmailStr
    roles: list[str] = Field(default_factory=lambda: ["learner"], min_length=1, max_length=20)
    department_id: uuid.UUID | None = None


class InvitationBulkCreate(BaseModel):
    emails: list[EmailStr] = Field(min_length=1, max_length=500)
    roles: list[str] = Field(default_factory=lambda: ["learner"], min_length=1, max_length=20)
    department_id: uuid.UUID | None = None


class InvitationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    role_keys: list[str]
    department_id: uuid.UUID | None
    invited_by: uuid.UUID | None
    expires_at: datetime
    accepted_at: datetime | None
    revoked_at: datetime | None
    created_at: datetime
    status: str = "pending"


class BulkError(BaseModel):
    email: str
    error: str


class BulkResult(BaseModel):
    invited: list[InvitationOut]
    errors: list[BulkError]


class InvitationLookup(BaseModel):
    organisation_id: uuid.UUID
    organisation_name: str
    organisation_logo_url: str | None
    email: str
    roles: list[str]
    invited_by_name: str | None
    expires_at: datetime
    existing_account: bool


class AcceptIn(BaseModel):
    token: str = Field(min_length=10, max_length=200)
    full_name: str | None = Field(default=None, min_length=1, max_length=200)
    password: str | None = Field(default=None, max_length=256)
    accept_terms: bool = True
    include_refresh_token: bool = False


class AcceptOut(BaseModel):
    organisation_id: uuid.UUID
    user_id: uuid.UUID
    account_created: bool
    access_token: str | None = None
    refresh_token: str | None = None
    csrf_token: str | None = None
    expires_at: datetime | None = None
