"""/enrolments (self-enrol, assign, withdraw, list) and /learn (course player over the pinned snapshot)."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, Query

from app.auth.deps import Ctx, require_permission
from app.core.pagination import Page, PageParams, page_params
from app.models.learning import EnrolmentStatus
from app.modules.enrolments import schemas as s
from app.modules.enrolments import service as svc
from app.modules.progress import events as _progress_events  # noqa: F401  (registers subscribers)

router = APIRouter()
enrolments = APIRouter(prefix="/enrolments", tags=["enrolments"])
learn = APIRouter(prefix="/learn", tags=["learn"])

learner = require_permission("learning.access")
manager = require_permission("enrolments.manage")


@enrolments.post("", response_model=s.EnrolmentOut, status_code=201)
async def self_enrol(body: s.SelfEnrolIn, ctx: Ctx = Depends(learner)) -> Any:
    """Self-enrol in a published course (pins the current version)."""
    e = await svc.self_enrol(ctx, body.course_id)
    await ctx.db.refresh(e)
    return s.EnrolmentOut.model_validate(e)


@enrolments.post("/assign", response_model=s.AssignOut)
async def assign(body: s.AssignIn, ctx: Ctx = Depends(manager)) -> Any:
    return await svc.assign(ctx, body)


@enrolments.get("", response_model=Page[s.EnrolmentOut])
async def list_enrolments(
    course_id: uuid.UUID | None = None,
    user_id: uuid.UUID | None = None,
    status: EnrolmentStatus | None = None,
    department_id: uuid.UUID | None = None,
    team_id: uuid.UUID | None = None,
    overdue: bool | None = None,
    search: str | None = Query(None, max_length=200),
    params: PageParams = Depends(page_params),
    ctx: Ctx = Depends(manager),
) -> Any:
    items, total = await svc.list_enrolments(
        ctx,
        params,
        course_id=course_id,
        user_id=user_id,
        status=status,
        department_id=department_id,
        team_id=team_id,
        overdue=overdue,
        search=search,
    )
    return Page(items=items, total=total, page=params.page, page_size=params.page_size)


@enrolments.get("/me", response_model=list[s.MyEnrolmentOut])
async def my_enrolments(status: EnrolmentStatus | None = None, ctx: Ctx = Depends(learner)) -> Any:
    return await svc.my_enrolments(ctx, status)


@enrolments.patch("/{enrolment_id}", response_model=s.EnrolmentOut)
async def update_enrolment(
    enrolment_id: uuid.UUID, body: s.EnrolmentUpdate, ctx: Ctx = Depends(manager)
) -> Any:
    return s.EnrolmentOut.model_validate(await svc.update_enrolment(ctx, enrolment_id, body))


@enrolments.post("/{enrolment_id}/withdraw", response_model=s.EnrolmentOut)
async def withdraw(
    enrolment_id: uuid.UUID,
    ctx: Ctx = Depends(require_permission("enrolments.manage", "learning.access", any_of=True)),
) -> Any:
    return s.EnrolmentOut.model_validate(await svc.withdraw(ctx, enrolment_id))


@learn.get("/{course_id}", response_model=s.LearnCourseOut)
async def learn_course(course_id: uuid.UUID, ctx: Ctx = Depends(learner)) -> Any:
    return await svc.learn_course(ctx, course_id)


@learn.get("/{course_id}/lessons/{lesson_id}", response_model=s.LearnLessonOut)
async def learn_lesson(course_id: uuid.UUID, lesson_id: uuid.UUID, ctx: Ctx = Depends(learner)) -> Any:
    return await svc.learn_lesson(ctx, course_id, lesson_id)


@learn.post("/{course_id}/upgrade", response_model=s.LearnCourseOut)
async def upgrade(course_id: uuid.UUID, ctx: Ctx = Depends(learner)) -> Any:
    return await svc.upgrade(ctx, course_id)


@learn.post("/{course_id}/activities/{activity_id}/check", response_model=s.CheckOut)
async def check_activity(
    course_id: uuid.UUID, activity_id: uuid.UUID, body: s.CheckIn, ctx: Ctx = Depends(learner)
) -> Any:
    return await svc.check_activity(ctx, course_id, activity_id, body.answer_ids)


router.include_router(enrolments)
router.include_router(learn)
