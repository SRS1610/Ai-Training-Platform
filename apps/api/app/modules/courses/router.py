"""/courses (authoring, structure, publishing, versions) and /catalog (learner browse)."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, Query, Response

from app.auth.deps import Ctx, require_permission
from app.core.pagination import Page, PageParams, page_params
from app.models.content import CourseStatus
from app.modules.courses import schemas as s
from app.modules.courses import service as svc
from app.modules.courses.service import AUTHOR_PERMS, STRUCTURE_PERMS

router = APIRouter()
courses = APIRouter(prefix="/courses", tags=["courses"])
catalog = APIRouter(prefix="/catalog", tags=["catalog"])

author = require_permission(*AUTHOR_PERMS, any_of=True)
structure_editor = require_permission(*STRUCTURE_PERMS, any_of=True)


# ----------------------------------------------------------------------------- courses


@courses.get("", response_model=Page[s.CourseOut])
async def list_courses(
    search: str | None = Query(None, max_length=200),
    status: CourseStatus | None = None,
    category: str | None = None,
    difficulty: str | None = None,
    mine: bool = False,
    params: PageParams = Depends(page_params),
    ctx: Ctx = Depends(require_permission("courses.view")),
) -> Any:
    """Authors see every course (drafts included). Learners get published courses only (catalog view)."""
    if not svc.is_author(ctx):
        items, total = await svc.catalog(
            ctx, params, search=search, category=category, difficulty=difficulty, skill_id=None, enrolled=None
        )
        outs = await svc.published_course_outs(ctx, [i.id for i in items])
        return Page(items=outs, total=total, page=params.page, page_size=params.page_size)
    items, total = await svc.list_courses(
        ctx, params, search=search, status=status, category=category, difficulty=difficulty, mine=mine
    )
    return Page(items=items, total=total, page=params.page, page_size=params.page_size)


@courses.post("", response_model=s.CourseOut, status_code=201)
async def create_course(
    body: s.CourseCreate, ctx: Ctx = Depends(require_permission("courses.create"))
) -> Any:
    return await svc.course_out(ctx, await svc.create_course(ctx, body))


@courses.get("/{course_id}", response_model=s.CourseOut)
async def get_course(course_id: uuid.UUID, ctx: Ctx = Depends(require_permission("courses.view"))) -> Any:
    return await svc.course_out(ctx, await svc.get_visible_course(ctx, course_id))


@courses.patch("/{course_id}", response_model=s.CourseOut)
async def update_course(
    course_id: uuid.UUID, body: s.CourseUpdate, ctx: Ctx = Depends(require_permission("courses.edit"))
) -> Any:
    return await svc.course_out(ctx, await svc.update_course(ctx, course_id, body))


@courses.delete("/{course_id}", status_code=204)
async def delete_course(
    course_id: uuid.UUID, ctx: Ctx = Depends(require_permission("courses.delete"))
) -> Response:
    await svc.delete_course(ctx, course_id)
    return Response(status_code=204)


@courses.post("/{course_id}/archive", response_model=s.CourseOut)
async def archive_course(
    course_id: uuid.UUID, ctx: Ctx = Depends(require_permission("courses.delete"))
) -> Any:
    return await svc.course_out(ctx, await svc.archive_course(ctx, course_id))


@courses.post("/{course_id}/restore", response_model=s.CourseOut)
async def restore_course(
    course_id: uuid.UUID, ctx: Ctx = Depends(require_permission("courses.delete"))
) -> Any:
    return await svc.course_out(ctx, await svc.restore_course(ctx, course_id))


@courses.post("/{course_id}/duplicate", response_model=s.CourseOut, status_code=201)
async def duplicate_course(
    course_id: uuid.UUID,
    body: s.DuplicateIn | None = None,
    ctx: Ctx = Depends(require_permission("courses.create")),
) -> Any:
    return await svc.course_out(ctx, await svc.duplicate_course(ctx, course_id, body.title if body else None))


@courses.put("/{course_id}/skills", response_model=s.CourseOut)
async def set_skills(
    course_id: uuid.UUID, body: s.CourseSkillsIn, ctx: Ctx = Depends(require_permission("courses.edit"))
) -> Any:
    return await svc.course_out(ctx, await svc.set_course_skills(ctx, course_id, body.skill_ids))


# ----------------------------------------------------------------------------- structure


@courses.get("/{course_id}/structure", response_model=s.StructureOut)
async def get_structure(course_id: uuid.UUID, ctx: Ctx = Depends(author)) -> Any:
    return await svc.get_structure(ctx, course_id)


@courses.put("/{course_id}/structure", response_model=s.StructureOut)
async def reorder_structure(
    course_id: uuid.UUID, body: s.ReorderIn, ctx: Ctx = Depends(structure_editor)
) -> Any:
    return await svc.reorder_structure(ctx, course_id, body)


@courses.post("/{course_id}/modules", response_model=s.ModuleOut, status_code=201)
async def create_module(
    course_id: uuid.UUID, body: s.ModuleCreate, ctx: Ctx = Depends(structure_editor)
) -> Any:
    return await svc.create_module(ctx, course_id, body)


@courses.patch("/{course_id}/modules/{module_id}", response_model=s.ModuleOut)
async def update_module(
    course_id: uuid.UUID, module_id: uuid.UUID, body: s.ModuleUpdate, ctx: Ctx = Depends(structure_editor)
) -> Any:
    return await svc.update_module(ctx, course_id, module_id, body)


@courses.delete("/{course_id}/modules/{module_id}", status_code=204)
async def delete_module(
    course_id: uuid.UUID, module_id: uuid.UUID, ctx: Ctx = Depends(structure_editor)
) -> Response:
    await svc.delete_module(ctx, course_id, module_id)
    return Response(status_code=204)


@courses.post("/{course_id}/modules/{module_id}/lessons", response_model=s.LessonOut, status_code=201)
async def create_lesson(
    course_id: uuid.UUID, module_id: uuid.UUID, body: s.LessonCreate, ctx: Ctx = Depends(structure_editor)
) -> Any:
    lesson = await svc.create_lesson(ctx, course_id, module_id, body)
    return await svc.lesson_out(ctx, course_id, lesson.id)


@courses.get("/{course_id}/lessons/{lesson_id}", response_model=s.LessonOut)
async def get_lesson(course_id: uuid.UUID, lesson_id: uuid.UUID, ctx: Ctx = Depends(author)) -> Any:
    return await svc.lesson_out(ctx, course_id, lesson_id)


@courses.patch("/{course_id}/lessons/{lesson_id}", response_model=s.LessonOut)
async def update_lesson(
    course_id: uuid.UUID, lesson_id: uuid.UUID, body: s.LessonUpdate, ctx: Ctx = Depends(structure_editor)
) -> Any:
    await svc.update_lesson(ctx, course_id, lesson_id, body)
    return await svc.lesson_out(ctx, course_id, lesson_id)


@courses.delete("/{course_id}/lessons/{lesson_id}", status_code=204)
async def delete_lesson(
    course_id: uuid.UUID, lesson_id: uuid.UUID, ctx: Ctx = Depends(structure_editor)
) -> Response:
    await svc.delete_lesson(ctx, course_id, lesson_id)
    return Response(status_code=204)


@courses.post("/{course_id}/lessons/{lesson_id}/activities", response_model=s.ActivityOut, status_code=201)
async def create_activity(
    course_id: uuid.UUID, lesson_id: uuid.UUID, body: s.ActivityCreate, ctx: Ctx = Depends(structure_editor)
) -> Any:
    return await svc.create_activity(ctx, course_id, lesson_id, body)


@courses.put("/{course_id}/lessons/{lesson_id}/activities/order", response_model=list[s.ActivityOut])
async def reorder_activities(
    course_id: uuid.UUID, lesson_id: uuid.UUID, body: s.ActivityOrderIn, ctx: Ctx = Depends(structure_editor)
) -> Any:
    return await svc.reorder_activities(ctx, course_id, lesson_id, body.activity_ids)


@courses.patch("/{course_id}/activities/{activity_id}", response_model=s.ActivityOut)
async def update_activity(
    course_id: uuid.UUID, activity_id: uuid.UUID, body: s.ActivityUpdate, ctx: Ctx = Depends(structure_editor)
) -> Any:
    return await svc.update_activity(ctx, course_id, activity_id, body)


@courses.delete("/{course_id}/activities/{activity_id}", status_code=204)
async def delete_activity(
    course_id: uuid.UUID, activity_id: uuid.UUID, ctx: Ctx = Depends(structure_editor)
) -> Response:
    await svc.delete_activity(ctx, course_id, activity_id)
    return Response(status_code=204)


# ----------------------------------------------------------------------------- publish & versions


@courses.post("/{course_id}/publish", response_model=s.PublishOut)
async def publish(
    course_id: uuid.UUID,
    body: s.PublishIn | None = None,
    ctx: Ctx = Depends(require_permission("courses.publish")),
) -> Any:
    course, version = await svc.publish_course(ctx, course_id, body.changelog if body else None)
    return s.PublishOut(course=await svc.course_out(ctx, course), version=svc._version_summary(version))


@courses.get("/{course_id}/versions", response_model=list[s.VersionSummary])
async def list_versions(course_id: uuid.UUID, ctx: Ctx = Depends(author)) -> Any:
    return await svc.list_versions(ctx, course_id)


@courses.get("/{course_id}/versions/diff")
async def diff_versions(
    course_id: uuid.UUID,
    from_: int = Query(..., alias="from", ge=1),
    to: str = Query(..., description="Version number or 'draft'"),
    ctx: Ctx = Depends(author),
) -> dict[str, Any]:
    return await svc.diff_versions(ctx, course_id, from_, to)


@courses.get("/{course_id}/versions/{number}", response_model=s.VersionOut)
async def get_version(course_id: uuid.UUID, number: int, ctx: Ctx = Depends(author)) -> Any:
    v = await svc.get_version(ctx, course_id, number)
    return s.VersionOut(**svc._version_summary(v).model_dump(), snapshot=v.snapshot)


# ----------------------------------------------------------------------------- catalog


@catalog.get("", response_model=Page[s.CatalogItem])
async def browse(
    search: str | None = Query(None, max_length=200),
    category: str | None = None,
    difficulty: str | None = None,
    skill_id: uuid.UUID | None = None,
    enrolled: bool | None = None,
    params: PageParams = Depends(page_params),
    ctx: Ctx = Depends(require_permission("courses.view")),
) -> Any:
    items, total = await svc.catalog(
        ctx,
        params,
        search=search,
        category=category,
        difficulty=difficulty,
        skill_id=skill_id,
        enrolled=enrolled,
    )
    return Page(items=items, total=total, page=params.page, page_size=params.page_size)


@catalog.get("/categories", response_model=list[s.CategoryCount])
async def categories(ctx: Ctx = Depends(require_permission("courses.view"))) -> Any:
    return await svc.catalog_categories(ctx)


@catalog.get("/{course_id}", response_model=s.CatalogDetail)
async def catalog_detail(course_id: uuid.UUID, ctx: Ctx = Depends(require_permission("courses.view"))) -> Any:
    return await svc.catalog_detail(ctx, course_id)


router.include_router(courses)
router.include_router(catalog)
