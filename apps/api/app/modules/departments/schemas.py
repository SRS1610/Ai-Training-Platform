from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class DepartmentCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    parent_id: uuid.UUID | None = None
    manager_user_id: uuid.UUID | None = None


class DepartmentUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    parent_id: uuid.UUID | None = None
    manager_user_id: uuid.UUID | None = None


class DepartmentOut(BaseModel):
    id: uuid.UUID
    name: str
    description: str | None
    parent_id: uuid.UUID | None
    manager_user_id: uuid.UUID | None
    member_count: int = 0
    team_count: int = 0
    created_at: datetime


class DepartmentNode(DepartmentOut):
    children: list[DepartmentNode] = Field(default_factory=list)
