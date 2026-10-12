"""File metadata schemas."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class FileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    owner_id: uuid.UUID | None
    filename: str
    content_type: str
    size_bytes: int
    sha256: str
    purpose: str
    scan_status: str
    created_at: datetime
    download_url: str = ""
