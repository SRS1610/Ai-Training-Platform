"""Learning paths: ordered sets of courses, bulk enrolment into every course, learner path progress."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import Ctx
from app.core.errors import BadRequest, NotFound
from app.core.pagination import PageParams
from app.models.content import Course, CourseStatus, CourseVersion, LearningPath, LearningPathItem, Lesson
from app.models.learning import Enrolment, EnrolmentSource, EnrolmentStatus
from app.modules.enrolments.service import enrol_users, expand_targets
from app.modules.learning_paths import schemas as s


async def get_path(ctx: Ctx, path_id: uuid.UUID) -> LearningPath:
    p = await ctx.db.scalar(
        select(LearningPath).where(
            LearningPath.id == path_id,
            LearningPath.organisation_id == ctx.org_id,
            LearningPath.deleted_at.is_(None),
        )
    )
    if p is None:
        raise NotFound("Learning path not found")
    return p


async def _items(db: AsyncSession, path_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[LearningPathItem]]:
    out: dict[uuid.UUID, list[LearningPathItem]] = {pid: [] for pid in path_ids}
    if not path_ids:
        return out
    for it in (
        await db.execute(
            select(LearningPathItem)
            .where(LearningPathItem.path_id.in_(path_ids))
            .order_by(LearningPathItem.position)
        )
    ).scalars():
        out[it.path_id].append(it)
    return out


async def _courses(
    db: AsyncSession, org_id: uuid.UUID, course_ids: set[uuid.UUID]
) -> dict[uuid.UUID, Course]:
    if not course_ids:
        return {}
    rows = (
        await db.execute(
            select(Course).where(
                Course.id.in_(course_ids), Course.organisation_id == org_id, Course.deleted_at.is_(None)
            )
        )
    ).scalars()
    return {c.id: c for c in rows}


async def to_out(ctx: Ctx, paths: list[LearningPath]) -> list[s.PathOut]:
    ids = [p.id for p in paths]
    items = await _items(ctx.db, ids)
    courses = await _courses(
        ctx.db, ctx.org_id, {i.course_id for its in items.values() for i in its if i.course_id}
    )
    counts = (
        dict(
            (
                await ctx.db.execute(
                    select(Enrolment.learning_path_id, func.count(func.distinct(Enrolment.user_id)))
                    .where(Enrolment.learning_path_id.in_(ids), Enrolment.status != EnrolmentStatus.WITHDRAWN)
                    .group_by(Enrolment.learning_path_id)
                )
            ).all()
        )
        if ids
        else {}
    )
    out = []
    for p in paths:
        out.append(
            s.PathOut(
                id=p.id,
                title=p.title,
                description=p.description,
                status=p.status,
                is_personalised=p.is_personalised,
                owner_user_id=p.owner_user_id,
                created_by=p.created_by,
                created_at=p.created_at,
                updated_at=p.updated_at,
                enrolled_users=counts.get(p.id, 0),
                items=[
                    s.PathItemOut(
                        id=i.id,
                        course_id=i.course_id,
                        lesson_id=i.lesson_id,
                        position=i.position,
                        is_required=i.is_required,
                        note=i.note,
                        course_title=courses[i.course_id].title if i.course_id in courses else None,
                        course_status=courses[i.course_id].status if i.course_id in courses else None,
                    )
                    for i in items[p.id]
                ],
            )
        )
    return out


async def _validate_items(ctx: Ctx, items: list[s.PathItemIn]) -> None:
    course_ids = {i.course_id for i in items}
    found = await _courses(ctx.db, ctx.org_id, course_ids)
    if set(found) != course_ids:
        raise BadRequest(
            "One or more courses were not found",
            code="invalid_course",
            details={"course_ids": [str(c) for c in course_ids - set(found)]},
        )
    lesson_ids = {i.lesson_id for i in items if i.lesson_id}
    if lesson_ids:
        rows = dict(
            (
                await ctx.db.execute(
                    select(Lesson.id, Lesson.course_id).where(
                        Lesson.id.in_(lesson_ids), Lesson.organisation_id == ctx.org_id
                    )
                )
            ).all()
        )
        bad = [str(i.lesson_id) for i in items if i.lesson_id and rows.get(i.lesson_id) != i.course_id]
        if bad:
            raise BadRequest(
                "Lessons must belong to the item's course", code="invalid_lesson", details={"lesson_ids": bad}
            )


def _replace_items(ctx: Ctx, path: LearningPath, items: list[s.PathItemIn]) -> list[LearningPathItem]:
    rows = [
        LearningPathItem(
            organisation_id=ctx.org_id,
            path_id=path.id,
            course_id=i.course_id,
            lesson_id=i.lesson_id,
            position=n,
            is_required=i.is_required,
            note=i.note,
        )
        for n, i in enumerate(items)
    ]
    ctx.db.add_all(rows)
    return rows


async def list_paths(
    ctx: Ctx, params: PageParams, status: str | None, search: str | None
) -> tuple[list[s.PathOut], int]:
    stmt = select(LearningPath).where(
        LearningPath.organisation_id == ctx.org_id, LearningPath.deleted_at.is_(None)
    )
    if not ctx.can("enrolments.manage"):
        stmt = stmt.where(
            LearningPath.status == CourseStatus.PUBLISHED, LearningPath.is_personalised.is_(False)
        )
    elif status:
        stmt = stmt.where(LearningPath.status == status)
    if search:
        stmt = stmt.where(LearningPath.title.ilike(f"%{search}%"))
    total = int(await ctx.db.scalar(select(func.count()).select_from(stmt.subquery())) or 0)
    rows = list(
        (
            await ctx.db.execute(
                stmt.order_by(LearningPath.updated_at.desc()).limit(params.page_size).offset(params.offset)
            )
        ).scalars()
    )
    return await to_out(ctx, rows), total


async def visible_path(ctx: Ctx, path_id: uuid.UUID) -> LearningPath:
    p = await get_path(ctx, path_id)
    if ctx.can("enrolments.manage") or p.owner_user_id == ctx.principal.user_id:
        return p
    if p.status == CourseStatus.PUBLISHED and not p.is_personalised:
        return p
    raise NotFound("Learning path not found")


async def create_path(ctx: Ctx, body: s.PathIn) -> LearningPath:
    await _validate_items(ctx, body.items)
    p = LearningPath(
        organisation_id=ctx.org_id,
        title=body.title,
        description=body.description,
        status=body.status,
        created_by=ctx.user_id,
    )
    ctx.db.add(p)
    await ctx.db.flush()
    _replace_items(ctx, p, body.items)
    await ctx.db.flush()
    await ctx.db.refresh(p)
    await ctx.audit("learning_path.created", "learning_path", p.id, title=p.title)
    return p


async def update_path(ctx: Ctx, path_id: uuid.UUID, body: s.PathUpdate) -> LearningPath:
    p = await get_path(ctx, path_id)
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        if v is None and k in ("title", "status"):
            continue
        setattr(p, k, v)
    await ctx.db.flush()
    await ctx.db.refresh(p)
    await ctx.audit("learning_path.updated", "learning_path", p.id, fields=sorted(data))
    return p


async def set_items(ctx: Ctx, path_id: uuid.UUID, items: list[s.PathItemIn]) -> LearningPath:
    """Replace the ordered item list (drag-and-drop ordering, add, remove)."""
    p = await get_path(ctx, path_id)
    await _validate_items(ctx, items)
    for old in (
        await ctx.db.execute(select(LearningPathItem).where(LearningPathItem.path_id == p.id))
    ).scalars():
        await ctx.db.delete(old)
    await ctx.db.flush()
    _replace_items(ctx, p, items)
    p.updated_at = datetime.now(UTC)
    await ctx.db.flush()
    await ctx.db.refresh(p)
    await ctx.audit("learning_path.items_updated", "learning_path", p.id, count=len(items))
    return p


async def delete_path(ctx: Ctx, path_id: uuid.UUID) -> None:
    p = await get_path(ctx, path_id)
    p.deleted_at = datetime.now(UTC)
    await ctx.db.flush()
    await ctx.audit("learning_path.deleted", "learning_path", p.id)


async def _enrol_in_path(
    ctx: Ctx,
    p: LearningPath,
    user_ids: list[uuid.UUID],
    *,
    source: str,
    assigned_by: uuid.UUID | None,
    due_date: Any,
) -> s.PathEnrolOut:
    items = (await _items(ctx.db, [p.id]))[p.id]
    course_ids = list(dict.fromkeys(i.course_id for i in items if i.course_id))
    courses = await _courses(ctx.db, ctx.org_id, set(course_ids))
    totals = {"created": 0, "reactivated": 0, "skipped": 0}
    skipped_courses: list[dict[str, str]] = []
    for cid in course_ids:
        course = courses.get(cid)
        if course is None or course.status != CourseStatus.PUBLISHED or course.current_version_id is None:
            skipped_courses.append({"course_id": str(cid), "reason": "not_published"})
            continue
        res = await enrol_users(
            ctx.db,
            course,
            user_ids,
            source=source,
            assigned_by=assigned_by,
            due_date=due_date,
            learning_path_id=p.id,
        )
        for k in totals:
            totals[k] += len(res[k])
        # Existing enrolments become part of the path too (progress is shared).
        for e in res["skipped"]:
            e.learning_path_id = e.learning_path_id or p.id
    await ctx.db.flush()
    return s.PathEnrolOut(users=len(user_ids), courses_skipped=skipped_courses, **totals)


async def enrol(ctx: Ctx, path_id: uuid.UUID, body: s.PathEnrolIn) -> s.PathEnrolOut:
    p = await get_path(ctx, path_id)
    if p.status != CourseStatus.PUBLISHED:
        raise BadRequest("Publish the learning path before enrolling learners", code="path_not_published")
    users = await expand_targets(ctx.db, ctx.org_id, body.user_ids, body.department_ids, body.team_ids)
    out = await _enrol_in_path(
        ctx, p, users, source=EnrolmentSource.LEARNING_PATH, assigned_by=ctx.user_id, due_date=body.due_date
    )
    await ctx.audit("learning_path.enrolled", "learning_path", p.id, users=len(users), created=out.created)
    return out


async def join(ctx: Ctx, path_id: uuid.UUID) -> s.PathEnrolOut:
    p = await visible_path(ctx, path_id)
    if p.status != CourseStatus.PUBLISHED:
        raise BadRequest("This learning path is not open for enrolment", code="path_not_published")
    out = await _enrol_in_path(
        ctx, p, [ctx.user_id], source=EnrolmentSource.LEARNING_PATH, assigned_by=None, due_date=None
    )
    await ctx.audit("learning_path.joined", "learning_path", p.id)
    return out


async def my_paths(ctx: Ctx) -> list[s.MyPath]:
    """Paths the caller is enrolled in (or owns, for personalised paths) with course-level progress."""
    enrolled_path_ids = select(Enrolment.learning_path_id).where(
        Enrolment.organisation_id == ctx.org_id,
        Enrolment.user_id == ctx.user_id,
        Enrolment.learning_path_id.is_not(None),
        Enrolment.status != EnrolmentStatus.WITHDRAWN,
    )
    paths = list(
        (
            await ctx.db.execute(
                select(LearningPath)
                .where(
                    LearningPath.organisation_id == ctx.org_id,
                    LearningPath.deleted_at.is_(None),
                    or_(LearningPath.id.in_(enrolled_path_ids), LearningPath.owner_user_id == ctx.user_id),
                )
                .order_by(LearningPath.title)
            )
        ).scalars()
    )
    items = await _items(ctx.db, [p.id for p in paths])
    course_ids = {i.course_id for its in items.values() for i in its if i.course_id}
    courses = await _courses(ctx.db, ctx.org_id, course_ids)
    metas = {}
    version_ids = [c.current_version_id for c in courses.values() if c.current_version_id]
    if version_ids:
        metas = {
            r.id: r.meta or {}
            for r in (
                await ctx.db.execute(
                    select(CourseVersion.id, CourseVersion.snapshot["course"].label("meta")).where(
                        CourseVersion.id.in_(version_ids)
                    )
                )
            ).all()
        }
    enrolments = (
        {
            e.course_id: e
            for e in (
                await ctx.db.execute(
                    select(Enrolment).where(
                        Enrolment.organisation_id == ctx.org_id,
                        Enrolment.user_id == ctx.user_id,
                        Enrolment.course_id.in_(course_ids),
                        Enrolment.status != EnrolmentStatus.WITHDRAWN,
                    )
                )
            ).scalars()
        }
        if course_ids
        else {}
    )
    out = []
    for p in paths:
        seen: set[uuid.UUID] = set()
        rows: list[s.MyPathCourse] = []
        for it in items[p.id]:
            c = courses.get(it.course_id) if it.course_id else None
            if c is None or c.id in seen:
                continue
            seen.add(c.id)
            meta = metas.get(c.current_version_id, {})
            e = enrolments.get(c.id)
            rows.append(
                s.MyPathCourse(
                    item_id=it.id,
                    course_id=c.id,
                    title=meta.get("title") or c.title,
                    thumbnail_url=meta.get("thumbnail_url", c.thumbnail_url),
                    is_required=it.is_required,
                    enrolment_id=e.id if e else None,
                    status=e.status if e else None,
                    progress_pct=e.progress_pct if e else 0.0,
                )
            )
        required = [r for r in rows if r.is_required] or rows
        done = sum(1 for r in required if r.status == EnrolmentStatus.COMPLETED)
        pct = (
            round(
                sum(100.0 if r.status == "completed" else r.progress_pct for r in required) / len(required), 1
            )
            if required
            else 0.0
        )
        status = (
            "completed"
            if required and done == len(required)
            else (
                "in_progress"
                if any(r.status in ("in_progress", "completed") for r in rows)
                else "not_started"
            )
        )
        nxt = next((r.course_id for r in rows if r.status != EnrolmentStatus.COMPLETED), None)
        out.append(
            s.MyPath(
                id=p.id,
                title=p.title,
                description=p.description,
                status=status,
                progress_pct=pct,
                completed_courses=done,
                required_courses=len(required),
                next_course_id=nxt,
                courses=rows,
            )
        )
    return out
