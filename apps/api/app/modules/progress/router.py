"""/progress: learner lesson start / heartbeat / complete."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends

from app.auth.deps import Ctx, require_permission
from app.modules.progress import events as _events  # noqa: F401  (registers event subscribers)
from app.modules.progress import service as svc
from app.modules.progress.schemas import EnrolmentProgressOut, HeartbeatIn, LessonProgressOut, ProgressOut

router = APIRouter(prefix="/progress", tags=["progress"])
learner = require_permission("learning.access")


def _out(enrolment: Any, lp: Any, credited: int | None = None) -> ProgressOut:
    return ProgressOut(
        enrolment=EnrolmentProgressOut.model_validate(enrolment),
        lesson=LessonProgressOut.model_validate(lp),
        credited_seconds=credited,
    )


@router.post("/lessons/{lesson_id}/start", response_model=ProgressOut)
async def start(lesson_id: uuid.UUID, ctx: Ctx = Depends(learner)) -> Any:
    enrolment, lp = await svc.start_lesson(ctx, lesson_id)
    await ctx.db.refresh(enrolment)
    await ctx.db.refresh(lp)
    return _out(enrolment, lp)


@router.post("/lessons/{lesson_id}/heartbeat", response_model=ProgressOut)
async def heartbeat(lesson_id: uuid.UUID, body: HeartbeatIn, ctx: Ctx = Depends(learner)) -> Any:
    enrolment, lp, credited = await svc.heartbeat(ctx, lesson_id, body.seconds, body.position)
    await ctx.db.refresh(enrolment)
    await ctx.db.refresh(lp)
    return _out(enrolment, lp, credited)


@router.post("/lessons/{lesson_id}/complete", response_model=ProgressOut)
async def complete(lesson_id: uuid.UUID, ctx: Ctx = Depends(learner)) -> Any:
    enrolment, lp = await svc.complete_lesson(ctx, lesson_id)
    await ctx.db.refresh(enrolment)
    await ctx.db.refresh(lp)
    return _out(enrolment, lp)
