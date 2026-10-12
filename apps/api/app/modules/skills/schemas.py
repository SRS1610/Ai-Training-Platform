"""Skills, competencies and learner skill profile schemas."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class SkillIn(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    category: str | None = Field(default=None, max_length=100)
    description: str | None = Field(default=None, max_length=5000)


class SkillUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    category: str | None = Field(default=None, max_length=100)
    description: str | None = Field(default=None, max_length=5000)


class SkillOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    category: str | None
    description: str | None
    created_at: datetime


class Requirement(BaseModel):
    skill_id: uuid.UUID
    min_level: float = Field(default=70.0, ge=0, le=100)


class CompetencyIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    requirements: list[Requirement] = Field(default_factory=list, max_length=100)


class CompetencyUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    requirements: list[Requirement] | None = Field(default=None, max_length=100)


class RequirementOut(BaseModel):
    skill_id: uuid.UUID
    skill_name: str | None = None
    min_level: float


class CompetencyOut(BaseModel):
    id: uuid.UUID
    name: str
    description: str | None
    requirements: list[RequirementOut]
    created_at: datetime


class MySkill(BaseModel):
    skill_id: uuid.UUID
    name: str
    category: str | None
    proficiency: float
    evidence_count: int
    last_assessed_at: datetime | None


class RequirementProgress(RequirementOut):
    proficiency: float
    met: bool


class MyCompetency(BaseModel):
    id: uuid.UUID
    name: str
    description: str | None
    attained: bool
    progress_pct: float
    requirements: list[RequirementProgress]


class MySkillsOut(BaseModel):
    skills: list[MySkill]
    competencies: list[MyCompetency]
