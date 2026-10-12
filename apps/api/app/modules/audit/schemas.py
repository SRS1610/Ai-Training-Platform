from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class AuditLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    created_at: datetime
    organisation_id: uuid.UUID | None
    actor_user_id: uuid.UUID | None
    actor_type: str
    actor_label: str | None
    action: str
    entity_type: str | None
    entity_id: str | None
    ip_address: str | None
    user_agent: str | None
    request_id: str | None
    meta: dict[str, Any]
    hash: str
    prev_hash: str | None


class ChainVerification(BaseModel):
    valid: bool
    checked: int
    broken_at: str | None = None
