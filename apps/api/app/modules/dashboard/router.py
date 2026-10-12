"""/dashboard: learner home and instructor overview."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query

from app.auth.deps import Ctx, get_ctx, require_permission
from app.core.errors import Forbidden
from app.modules.dashboard import schemas as s
from app.modules.dashboard import service as svc

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/learner", response_model=s.LearnerDashboard)
async def learner(ctx: Ctx = Depends(get_ctx)) -> Any:
    if not ctx.can_any("learning.access", "courses.view"):
        raise Forbidden("Learner access is required")
    return await svc.learner_dashboard(ctx)


@router.get("/instructor", response_model=s.InstructorDashboard)
async def instructor(
    scope: str = Query("mine", pattern="^(mine|all)$"),
    ctx: Ctx = Depends(require_permission("courses.edit", "submissions.review", any_of=True)),
) -> Any:
    return await svc.instructor_dashboard(ctx, scope)
