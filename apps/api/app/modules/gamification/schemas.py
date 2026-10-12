from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

from app.modules.gamification.service import CRITERIA_TYPES


class LevelOut(BaseModel):
    level: int
    name: str
    min_points: int
    next_level: int | None
    next_level_name: str | None
    next_level_points: int | None
    points_to_next: int
    progress_pct: float


class StreakOut(BaseModel):
    current: int
    longest: int
    last_active_day: date | None
    active_today: bool


class BadgeOut(BaseModel):
    id: uuid.UUID
    key: str
    name: str
    description: str
    icon: str
    criteria: dict[str, Any]
    earned: bool = False
    awarded_at: datetime | None = None
    earned_count: int | None = None


class PointsEntry(BaseModel):
    points: int
    reason: str
    ref_type: str | None
    ref_id: uuid.UUID | None
    created_at: datetime


class GamificationMeOut(BaseModel):
    enabled: bool
    points: int
    level: LevelOut
    badges: list[BadgeOut]
    available_badges: list[BadgeOut]
    streak: StreakOut
    recent_points: list[PointsEntry]
    rank: int | None


class LeaderboardEntry(BaseModel):
    rank: int
    user_id: uuid.UUID
    full_name: str
    avatar_url: str | None
    points: int
    level: int
    is_me: bool


class LeaderboardMe(BaseModel):
    rank: int | None
    points: int
    opted_out: bool


class LeaderboardOut(BaseModel):
    enabled: bool
    period: Literal["week", "month", "all"]
    department_id: uuid.UUID | None = None
    entries: list[LeaderboardEntry]
    me: LeaderboardMe | None


class BadgeListOut(BaseModel):
    enabled: bool
    items: list[BadgeOut]
    criteria_types: dict[str, str]


def _check_criteria(v: dict[str, Any] | None) -> dict[str, Any] | None:
    if v is None:
        return v
    ctype = v.get("type")
    if ctype not in CRITERIA_TYPES:
        raise ValueError(f"criteria.type must be one of: {', '.join(CRITERIA_TYPES)}")
    if ctype != "manual":
        try:
            count = int(v.get("count", 1))
        except (TypeError, ValueError) as exc:
            raise ValueError("criteria.count must be an integer") from exc
        if count < 1:
            raise ValueError("criteria.count must be at least 1")
    if ctype == "simulation_band" and not v.get("band"):
        raise ValueError("criteria.band is required for simulation_band")
    return v


class BadgeCreate(BaseModel):
    key: str = Field(min_length=2, max_length=64, pattern=r"^[a-z0-9_\-]+$")
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=2000)
    icon: str = Field(default="award", max_length=64)
    criteria: dict[str, Any] = Field(default_factory=lambda: {"type": "manual"})

    @field_validator("criteria")
    @classmethod
    def _criteria(cls, v: dict[str, Any] | None) -> dict[str, Any] | None:
        return _check_criteria(v)


class BadgeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    icon: str | None = Field(default=None, max_length=64)
    criteria: dict[str, Any] | None = None

    @field_validator("criteria")
    @classmethod
    def _criteria(cls, v: dict[str, Any] | None) -> dict[str, Any] | None:
        return _check_criteria(v)


class AwardIn(BaseModel):
    user_id: uuid.UUID


class OptOutIn(BaseModel):
    opt_out: bool
