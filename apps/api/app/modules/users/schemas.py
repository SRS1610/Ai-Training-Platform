from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field


class Ref(BaseModel):
    id: uuid.UUID
    name: str


class MemberOut(BaseModel):
    user_id: uuid.UUID
    membership_id: uuid.UUID
    email: str
    full_name: str
    avatar_url: str | None = None
    status: str  # membership status: active | suspended | invited
    user_status: str
    roles: list[str]
    department_id: uuid.UUID | None = None
    department_name: str | None = None
    job_title: str | None = None
    employee_id: str | None = None
    manager_user_id: uuid.UUID | None = None
    joined_at: datetime | None = None
    last_login_at: datetime | None = None
    mfa_enabled: bool = False
    created_at: datetime


class EnrolmentCounts(BaseModel):
    total: int = 0
    not_started: int = 0
    in_progress: int = 0
    completed: int = 0
    withdrawn: int = 0


class MemberDetail(MemberOut):
    manager: Ref | None = None
    teams: list[Ref] = Field(default_factory=list)
    enrolments: EnrolmentCounts = Field(default_factory=EnrolmentCounts)


class MemberUpdate(BaseModel):
    job_title: str | None = Field(default=None, max_length=200)
    department_id: uuid.UUID | None = None
    manager_user_id: uuid.UUID | None = None
    employee_id: str | None = Field(default=None, max_length=100)


class RolesSet(BaseModel):
    roles: list[str] = Field(min_length=1, max_length=20, description="Role keys, e.g. ['instructor']")


class MemberCreate(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=1, max_length=200)
    roles: list[str] = Field(default_factory=lambda: ["learner"], min_length=1, max_length=20)
    department_id: uuid.UUID | None = None
    job_title: str | None = Field(default=None, max_length=200)
    employee_id: str | None = Field(default=None, max_length=100)
    password: str | None = Field(default=None, max_length=256,
                                 description="Initial password. Omit to generate a temporary password.")
    send_email: bool = True


class MemberCreated(MemberOut):
    temporary_password: str | None = None
    existing_account: bool = False


class ImportRowError(BaseModel):
    row: int
    email: str | None = None
    error: str


class ImportResult(BaseModel):
    invited: int
    invitation_ids: list[uuid.UUID]
    errors: list[ImportRowError]
