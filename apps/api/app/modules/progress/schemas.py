"""Progress tracking schemas."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class HeartbeatIn(BaseModel):
    seconds: int = Field(
        ge=0, le=3600, description="Seconds since the previous heartbeat (capped server side)"
    )
    position: dict[str, Any] | None = Field(
        default=None, description="e.g. {video_seconds: 93} or {activity: 2}"
    )


class LessonProgressOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    lesson_id: uuid.UUID
    status: str
    time_spent_seconds: int
    last_position: dict[str, Any]
    completed_at: datetime | None


class EnrolmentProgressOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    course_id: uuid.UUID
    status: str
    progress_pct: float
    final_score: float | None
    time_spent_seconds: int
    started_at: datetime | None
    completed_at: datetime | None


class ProgressOut(BaseModel):
    enrolment: EnrolmentProgressOut
    lesson: LessonProgressOut
    credited_seconds: int | None = None
