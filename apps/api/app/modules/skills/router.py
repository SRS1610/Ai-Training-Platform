"""/skills, /competencies and the learner's skill profile (/skills/me)."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, Query, Response

from app.auth.deps import Ctx, get_ctx, require_permission
from app.core.errors import Forbidden
from app.modules.skills import events as _events  # noqa: F401  (registers subscribers)
from app.modules.skills import schemas as s
from app.modules.skills import service as svc

router = APIRouter()
skills = APIRouter(prefix="/skills", tags=["skills"])
competencies = APIRouter(prefix="/competencies", tags=["skills"])
editor = require_permission("courses.edit")
viewer = require_permission("courses.view")


@skills.get("", response_model=list[s.SkillOut])
async def list_skills(
    search: str | None = Query(None, max_length=100), category: str | None = None, ctx: Ctx = Depends(viewer)
) -> Any:
    return await svc.list_skills(ctx, search, category)


@skills.get("/me", response_model=s.MySkillsOut)
async def my_skills(ctx: Ctx = Depends(get_ctx)) -> Any:
    if not ctx.can_any("learning.access", "courses.view"):
        raise Forbidden("Learner access is required")
    return await svc.my_skills(ctx)


@skills.post("", response_model=s.SkillOut, status_code=201)
async def create_skill(body: s.SkillIn, ctx: Ctx = Depends(editor)) -> Any:
    return await svc.create_skill(ctx, body)


@skills.get("/{skill_id}", response_model=s.SkillOut)
async def get_skill(skill_id: uuid.UUID, ctx: Ctx = Depends(viewer)) -> Any:
    return await svc.get_skill(ctx, skill_id)


@skills.patch("/{skill_id}", response_model=s.SkillOut)
async def update_skill(skill_id: uuid.UUID, body: s.SkillUpdate, ctx: Ctx = Depends(editor)) -> Any:
    return await svc.update_skill(ctx, skill_id, body)


@skills.delete("/{skill_id}", status_code=204)
async def delete_skill(skill_id: uuid.UUID, ctx: Ctx = Depends(editor)) -> Response:
    await svc.delete_skill(ctx, skill_id)
    return Response(status_code=204)


@competencies.get("", response_model=list[s.CompetencyOut])
async def list_competencies(ctx: Ctx = Depends(viewer)) -> Any:
    return await svc.list_competencies(ctx)


@competencies.post("", response_model=s.CompetencyOut, status_code=201)
async def create_competency(body: s.CompetencyIn, ctx: Ctx = Depends(editor)) -> Any:
    return await svc.competency_out(ctx, await svc.create_competency(ctx, body))


@competencies.get("/{competency_id}", response_model=s.CompetencyOut)
async def get_competency(competency_id: uuid.UUID, ctx: Ctx = Depends(viewer)) -> Any:
    return await svc.competency_out(ctx, await svc.get_competency(ctx, competency_id))


@competencies.patch("/{competency_id}", response_model=s.CompetencyOut)
async def update_competency(
    competency_id: uuid.UUID, body: s.CompetencyUpdate, ctx: Ctx = Depends(editor)
) -> Any:
    return await svc.competency_out(ctx, await svc.update_competency(ctx, competency_id, body))


@competencies.delete("/{competency_id}", status_code=204)
async def delete_competency(competency_id: uuid.UUID, ctx: Ctx = Depends(editor)) -> Response:
    await svc.delete_competency(ctx, competency_id)
    return Response(status_code=204)


router.include_router(skills)
router.include_router(competencies)
