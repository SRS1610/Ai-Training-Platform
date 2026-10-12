from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class TeamCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    department_id: uuid.UUID | None = None
    lead_user_id: uuid.UUID | None = None


class TeamUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    department_id: uuid.UUID | None = None
    lead_user_id: uuid.UUID | None = None


class TeamOut(BaseModel):
    id: uuid.UUID
    name: str
    description: str | None
    department_id: uuid.UUID | None
    lead_user_id: uuid.UUID | None
    member_count: int = 0
    created_at: datetime


class TeamMemberOut(BaseModel):
    user_id: uuid.UUID
    email: str
    full_name: str
    avatar_url: str | None = None
    job_title: str | None = None


class TeamMembersAdd(BaseModel):
    user_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)
