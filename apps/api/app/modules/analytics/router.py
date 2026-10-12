"""/analytics: learner (self / any), course, organisation and platform analytics."""

from __future__ import annotations

import uuid
from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select

from app.auth.deps import Ctx, require_permission, require_superadmin
from app.core.errors import BadRequest, NotFound
from app.models.content import Course
from app.models.tenancy import Department, OrganisationUser
from app.modules.analytics import service
from app.modules.analytics.service import DateRange

router = APIRouter(prefix="/analytics", tags=["analytics"])

_view = require_permission("analytics.view")


def date_range(start: date | None = Query(None, description="Inclusive start date (YYYY-MM-DD)"),
               end: date | None = Query(None, description="Inclusive end date (YYYY-MM-DD)")) -> DateRange:
    if start and end and start > end:
        raise BadRequest("start must be on or before end")
    return DateRange(start, end)


async def ensure_member(ctx: Ctx, user_id: uuid.UUID) -> None:
    exists = await ctx.db.scalar(select(OrganisationUser.id).where(
        OrganisationUser.organisation_id == ctx.org_id, OrganisationUser.user_id == user_id))
    if exists is None:
        raise NotFound("User not found in this organisation")


async def ensure_course(ctx: Ctx, course_id: uuid.UUID) -> None:
    if await ctx.db.scalar(select(Course.id).where(Course.id == course_id, Course.organisation_id == ctx.org_id,
                                                   Course.deleted_at.is_(None))) is None:
        raise NotFound("Course not found")


async def ensure_department(ctx: Ctx, department_id: uuid.UUID | None) -> None:
    if department_id and await ctx.db.scalar(select(Department.id).where(
            Department.id == department_id, Department.organisation_id == ctx.org_id)) is None:
        raise NotFound("Department not found")


@router.get("/learner/me")
async def my_analytics(rng: DateRange = Depends(date_range),
                       ctx: Ctx = Depends(require_permission("learning.access"))) -> dict[str, Any]:
    """Own learning analytics: summary KPIs, courses, scores over time, skills, weak areas, time, attempts and
    simulation performance per dimension."""
    return await service.learner_analytics(ctx.db, ctx.org_id, ctx.user_id, rng)


@router.get("/learner/{user_id}")
async def learner_analytics(user_id: uuid.UUID, rng: DateRange = Depends(date_range),
                            ctx: Ctx = Depends(_view)) -> dict[str, Any]:
    await ensure_member(ctx, user_id)
    return await service.learner_analytics(ctx.db, ctx.org_id, user_id, rng)


@router.get("/courses")
async def courses_overview(rng: DateRange = Depends(date_range), ctx: Ctx = Depends(_view)) -> dict[str, Any]:
    return {"range": rng.as_dict(), "items": await service.courses_overview(ctx.db, ctx.org_id, rng)}


@router.get("/courses/{course_id}")
async def course_analytics(course_id: uuid.UUID, rng: DateRange = Depends(date_range),
                           ctx: Ctx = Depends(_view)) -> dict[str, Any]:
    await ensure_course(ctx, course_id)
    return await service.course_analytics(ctx.db, ctx.org_id, course_id, rng)


@router.get("/organisation")
async def organisation_analytics(department_id: uuid.UUID | None = None, course_id: uuid.UUID | None = None,
                                 rng: DateRange = Depends(date_range), ctx: Ctx = Depends(_view)) -> dict[str, Any]:
    await ensure_department(ctx, department_id)
    if course_id:
        await ensure_course(ctx, course_id)
    return await service.organisation_analytics(ctx.db, ctx.org_id, rng, department_id=department_id,
                                                course_id=course_id)


@router.get("/platform")
async def platform_analytics(rng: DateRange = Depends(date_range),
                             ctx: Ctx = Depends(require_superadmin)) -> dict[str, Any]:
    """Super admin: cross-tenant organisations, users, revenue, courses, activity, AI cost, storage and API usage.
    Defaults to the last 30 days."""
    return await service.platform_analytics(ctx.db, rng)
