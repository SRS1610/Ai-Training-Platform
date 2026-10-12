"""/recommendations: the learner's personalised recommendations and study plan (``learning.access``)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select

from app.auth.deps import Ctx, get_ctx
from app.core.errors import NotFound
from app.models.platform import Recommendation
from app.modules.recommendations import events as _events  # noqa: F401 - registers event subscribers
from app.modules.recommendations import service

router = APIRouter(prefix="/recommendations", tags=["recommendations"])


class RecommendationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    kind: str
    target_type: str | None
    target_id: uuid.UUID | None
    course_id: uuid.UUID | None
    title: str
    reason: str
    priority: float
    skill_id: uuid.UUID | None
    status: str
    data: dict[str, Any]
    created_at: datetime


class SkillOut(BaseModel):
    skill_id: uuid.UUID
    name: str
    proficiency: float
    evidence_count: int
    last_assessed_at: datetime | None
    trend: list[float | None]


class MyRecommendations(BaseModel):
    items: list[RecommendationOut]
    skills: list[SkillOut]


class Activity(BaseModel):
    title: str
    type: str
    target_id: str | None = None
    reason: str = ""


class Step(BaseModel):
    week: int
    focus: str
    activities: list[Activity]


class PlanOut(BaseModel):
    summary: str
    strengths: list[str]
    focus_areas: list[str]
    difficulty_adjustment: dict[str, str]
    steps: list[Step]
    generated_by: str
    model: str | None
    offline: bool
    pace: str | None
    avg_score: float | None


def _learner(ctx: Ctx) -> Ctx:
    ctx.require("learning.access")
    return ctx


async def _mine(ctx: Ctx) -> MyRecommendations:
    items = await service.list_active(ctx.db, ctx.org_id, ctx.user_id)
    skills = await service.skills_summary(ctx.db, ctx.org_id, ctx.user_id)
    return MyRecommendations(
        items=[RecommendationOut.model_validate(r) for r in items], skills=[SkillOut(**s) for s in skills]
    )


@router.get("/me", response_model=MyRecommendations)
async def my_recommendations(ctx: Ctx = Depends(get_ctx)) -> MyRecommendations:
    _learner(ctx)
    return await _mine(ctx)


@router.post("/me/refresh", response_model=MyRecommendations)
async def refresh(ctx: Ctx = Depends(get_ctx)) -> MyRecommendations:
    _learner(ctx)
    await service.refresh(ctx.db, ctx.org_id, ctx.user_id)
    return await _mine(ctx)


@router.get("/me/plan", response_model=PlanOut)
async def my_plan(ctx: Ctx = Depends(get_ctx)) -> PlanOut:
    """AI-written personalised pathway + difficulty adjustment.

    Falls back to a deterministic plan when AI is unavailable."""
    _learner(ctx)
    return PlanOut.model_validate(await service.personalised_plan(ctx.db, ctx.org_id, ctx.user_id))


@router.post("/{recommendation_id}/dismiss", response_model=RecommendationOut)
async def dismiss(recommendation_id: uuid.UUID, ctx: Ctx = Depends(get_ctx)) -> RecommendationOut:
    _learner(ctx)
    rec = await ctx.db.scalar(
        select(Recommendation).where(
            Recommendation.id == recommendation_id,
            Recommendation.organisation_id == ctx.org_id,
            Recommendation.user_id == ctx.user_id,
        )
    )
    if rec is None:
        raise NotFound("Recommendation not found")
    rec.status = "dismissed"
    await ctx.db.flush()
    return RecommendationOut.model_validate(rec)
