from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ApiKeyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    scopes: list[str] = Field(min_length=1, max_length=50, description="Permission codes granted to the key")
    expires_in_days: int | None = Field(default=None, ge=1, le=730)


class ApiKeyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    prefix: str
    scopes: list[str]
    created_by: uuid.UUID | None
    created_at: datetime
    last_used_at: datetime | None
    expires_at: datetime | None
    revoked_at: datetime | None
    status: str = "active"


class ApiKeyCreated(ApiKeyOut):
    key: str = Field(description="The full API key. Shown only once — store it securely.")
