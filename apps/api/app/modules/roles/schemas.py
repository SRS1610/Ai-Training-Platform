from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class PermissionOut(BaseModel):
    code: str
    description: str
    category: str


class RoleOut(BaseModel):
    id: uuid.UUID
    key: str
    name: str
    description: str | None
    is_system: bool
    permissions: list[str]
    member_count: int = 0
    created_at: datetime
    updated_at: datetime


class RoleCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    key: str | None = Field(default=None, pattern=r"^[a-z][a-z0-9_]{1,63}$")
    description: str | None = Field(default=None, max_length=2000)
    permissions: list[str] = Field(default_factory=list, max_length=100)


class RoleUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    permissions: list[str] | None = Field(default=None, max_length=100)
