"""Enrolments (self, assigned, learning path) and the learner course player (pinned snapshot view)."""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import Ctx
from app.core.errors import BadRequest, Conflict, Forbidden, NotFound
from app.core.events import emit
from app.core.pagination import PageParams
from app.models.content import Activity, Course, CourseStatus, CourseVersion
from app.models.identity import User
from app.models.learning import Enrolment, EnrolmentSource, EnrolmentStatus, LessonProgress
from app.models.tenancy import Department, MembershipStatus, OrganisationUser, TeamMember
from app.modules.courses.content_rules import LINKED_TYPES
from app.modules.courses.service import escape_like
from app.modules.courses.snapshot import (
    find_lesson,
    lessons_in_order,
    locked_lesson_ids,
    next_lesson,
    required_lesson_ids,
)
from app.modules.enrolments import schemas as s
from app.modules.progress.service import (
    completed_set,
    get_my_enrolment,
    load_snapshot,
    local_today,
    progress_rows,
    recompute,
)

# ----------------------------------------------------------------------------- enrol helpers


async def get_enrollable_course(db: AsyncSession, org_id: uuid.UUID, course_id: uuid.UUID) -> Course:
    course = await db.scalar(
        select(Course).where(
            Course.id == course_id, Course.organisation_id == org_id, Course.deleted_at.is_(None)
        )
    )
    if course is None:
        raise NotFound("Course not found")
    if course.status != CourseStatus.PUBLISHED or course.current_version_id is None:
        raise BadRequest("Only published courses can be enrolled in", code="course_not_published")
    return course


async def expand_targets(
    db: AsyncSession,
    org_id: uuid.UUID,
    user_ids: list[uuid.UUID],
    department_ids: list[uuid.UUID],
    team_ids: list[uuid.UUID],
) -> list[uuid.UUID]:
    """Resolve users + departments (incl. sub-departments) + teams to active member ids of the org."""
    wanted: set[uuid.UUID] = set(user_ids)
    dept_ids: set[uuid.UUID] = set()
    if department_ids:
        depts = (
            await db.execute(
                select(Department.id, Department.parent_id).where(
                    Department.organisation_id == org_id, Department.deleted_at.is_(None)
                )
            )
        ).all()
        known = {d.id for d in depts}
        missing = set(department_ids) - known
        if missing:
            raise BadRequest(
                "Department not found",
                code="invalid_department",
                details={"department_ids": [str(m) for m in missing]},
            )
        children: dict[uuid.UUID, list[uuid.UUID]] = {}
        for d in depts:
            if d.parent_id:
                children.setdefault(d.parent_id, []).append(d.id)
        stack = list(department_ids)
        while stack:
            d = stack.pop()
            if d not in dept_ids:
                dept_ids.add(d)
                stack.extend(children.get(d, []))
    member_filter = []
    if wanted:
        member_filter.append(OrganisationUser.user_id.in_(wanted))
    if dept_ids:
        member_filter.append(OrganisationUser.department_id.in_(dept_ids))
    if team_ids:
        member_filter.append(
            OrganisationUser.user_id.in_(
                select(TeamMember.user_id).where(
                    TeamMember.organisation_id == org_id, TeamMember.team_id.in_(team_ids)
                )
            )
        )
    if not member_filter:
        return []
    members = list(
        (
            await db.execute(
                select(OrganisationUser.user_id).where(
                    OrganisationUser.organisation_id == org_id,
                    OrganisationUser.status == MembershipStatus.ACTIVE,
                    or_(*member_filter),
                )
            )
        ).scalars()
    )
    unknown = wanted - set(members)
    if unknown:
        raise BadRequest(
            "Some users are not active members of this organisation",
            code="invalid_user",
            details={"user_ids": [str(u) for u in unknown]},
        )
    return sorted(set(members), key=str)


async def enrol_users(
    db: AsyncSession,
    course: Course,
    user_ids: list[uuid.UUID],
    *,
    source: str,
    assigned_by: uuid.UUID | None = None,
    due_date: date | None = None,
    learning_path_id: uuid.UUID | None = None,
) -> dict[str, list[Any]]:
    """Create enrolments pinned to the course's current version. Existing active enrolments are skipped;
    withdrawn ones are reactivated (keeping their pinned version and progress)."""
    existing = (
        {
            e.user_id: e
            for e in (
                await db.execute(
                    select(Enrolment).where(
                        Enrolment.organisation_id == course.organisation_id,
                        Enrolment.course_id == course.id,
                        Enrolment.user_id.in_(user_ids),
                    )
                )
            ).scalars()
        }
        if user_ids
        else {}
    )
    result: dict[str, list[Any]] = {"created": [], "reactivated": [], "skipped": []}
    for uid in user_ids:
        e = existing.get(uid)
        if e is not None and e.status != EnrolmentStatus.WITHDRAWN:
            if due_date and source != EnrolmentSource.SELF and not e.due_date:
                e.due_date = due_date
            result["skipped"].append(e)
            continue
        if e is not None:
            e.status = EnrolmentStatus.IN_PROGRESS if e.started_at else EnrolmentStatus.NOT_STARTED
            e.source, e.assigned_by = source, assigned_by
            e.due_date = due_date or e.due_date
            e.learning_path_id = learning_path_id or e.learning_path_id
            result["reactivated"].append(e)
        else:
            e = Enrolment(
                organisation_id=course.organisation_id,
                user_id=uid,
                course_id=course.id,
                course_version_id=course.current_version_id,
                source=source,
                assigned_by=assigned_by,
                due_date=due_date,
                learning_path_id=learning_path_id,
                status=EnrolmentStatus.NOT_STARTED,
                progress_pct=0.0,
                time_spent_seconds=0,
                reminders_sent={},
            )
            db.add(e)
            result["created"].append(e)
    await db.flush()
    for e in result["created"] + result["reactivated"]:
        await emit(
            db,
            "enrolment.created",
            {
                "enrolment_id": e.id,
                "course_id": course.id,
                "assigned_by": assigned_by,
                "due_date": e.due_date,
                "source": source,
                "learning_path_id": learning_path_id,
                "organisation_id": course.organisation_id,
                "user_id": e.user_id,
            },
        )
    return result


async def self_enrol(ctx: Ctx, course_id: uuid.UUID) -> Enrolment:
    course = await get_enrollable_course(ctx.db, ctx.org_id, course_id)
    existing = await ctx.db.scalar(
        select(Enrolment).where(
            Enrolment.organisation_id == ctx.org_id,
            Enrolment.user_id == ctx.user_id,
            Enrolment.course_id == course.id,
        )
    )
    if existing is not None and existing.status != EnrolmentStatus.WITHDRAWN:
        raise Conflict(
            "You are already enrolled in this course",
            code="already_enrolled",
            details={"enrolment_id": str(existing.id)},
        )
    res = await enrol_users(ctx.db, course, [ctx.user_id], source=EnrolmentSource.SELF)
    enrolment = (res["created"] + res["reactivated"])[0]
    await ctx.audit("enrolment.self_enrolled", "enrolment", enrolment.id, course_id=str(course.id))
    return enrolment


async def assign(ctx: Ctx, body: s.AssignIn) -> s.AssignOut:
    course = await get_enrollable_course(ctx.db, ctx.org_id, body.course_id)
    user_ids = await expand_targets(ctx.db, ctx.org_id, body.user_ids, body.department_ids, body.team_ids)
    res = await enrol_users(
        ctx.db,
        course,
        user_ids,
        source=EnrolmentSource.ASSIGNED,
        assigned_by=ctx.user_id,
        due_date=body.due_date,
    )
    await ctx.audit(
        "enrolment.assigned",
        "course",
        course.id,
        created=len(res["created"]),
        reactivated=len(res["reactivated"]),
        skipped=len(res["skipped"]),
        due_date=str(body.due_date) if body.due_date else None,
    )
    return s.AssignOut(
        created=len(res["created"]),
        reactivated=len(res["reactivated"]),
        skipped=len(res["skipped"]),
        enrolment_ids=[e.id for e in res["created"] + res["reactivated"]],
    )


async def _get_enrolment(ctx: Ctx, enrolment_id: uuid.UUID) -> Enrolment:
    e = await ctx.db.scalar(
        select(Enrolment).where(Enrolment.id == enrolment_id, Enrolment.organisation_id == ctx.org_id)
    )
    if e is None:
        raise NotFound("Enrolment not found")
    return e


async def withdraw(ctx: Ctx, enrolment_id: uuid.UUID) -> Enrolment:
    """Managers can withdraw any enrolment; learners only their own self-enrolments."""
    e = await _get_enrolment(ctx, enrolment_id)
    if not ctx.can("enrolments.manage"):
        if e.user_id != ctx.principal.user_id:
            raise NotFound("Enrolment not found")
        if e.source != EnrolmentSource.SELF:
            raise Forbidden("Assigned training can only be withdrawn by a manager", code="assigned_enrolment")
    if e.status == EnrolmentStatus.WITHDRAWN:
        raise BadRequest("Enrolment is already withdrawn")
    if e.status == EnrolmentStatus.COMPLETED:
        raise BadRequest("Completed enrolments cannot be withdrawn", code="enrolment_completed")
    e.status = EnrolmentStatus.WITHDRAWN
    await ctx.db.flush()
    await ctx.db.refresh(e)
    await ctx.audit(
        "enrolment.withdrawn", "enrolment", e.id, user_id=str(e.user_id), course_id=str(e.course_id)
    )
    return e


async def update_enrolment(ctx: Ctx, enrolment_id: uuid.UUID, body: s.EnrolmentUpdate) -> Enrolment:
    e = await _get_enrolment(ctx, enrolment_id)
    if "due_date" in body.model_fields_set:
        e.due_date = body.due_date
        e.reminders_sent = {}
    await ctx.db.flush()
    await ctx.db.refresh(e)
    await ctx.audit("enrolment.updated", "enrolment", e.id, due_date=str(e.due_date) if e.due_date else None)
    return e


def _is_overdue(e: Enrolment, today: date) -> bool:
    return bool(
        e.due_date
        and e.due_date < today
        and e.status in (EnrolmentStatus.NOT_STARTED, EnrolmentStatus.IN_PROGRESS)
    )


async def list_enrolments(
    ctx: Ctx,
    params: PageParams,
    *,
    course_id: uuid.UUID | None,
    user_id: uuid.UUID | None,
    status: str | None,
    department_id: uuid.UUID | None,
    team_id: uuid.UUID | None,
    overdue: bool | None,
    search: str | None,
) -> tuple[list[s.EnrolmentOut], int]:
    stmt = (
        select(Enrolment, User.full_name, User.email, Course.title, CourseVersion.version_number)
        .join(User, User.id == Enrolment.user_id)
        .join(Course, Course.id == Enrolment.course_id)
        .join(CourseVersion, CourseVersion.id == Enrolment.course_version_id)
        .where(Enrolment.organisation_id == ctx.org_id)
    )
    today = datetime.now(UTC).date()
    if course_id:
        stmt = stmt.where(Enrolment.course_id == course_id)
    if user_id:
        stmt = stmt.where(Enrolment.user_id == user_id)
    if status:
        stmt = stmt.where(Enrolment.status == status)
    if department_id:
        stmt = stmt.where(
            Enrolment.user_id.in_(
                select(OrganisationUser.user_id).where(
                    OrganisationUser.organisation_id == ctx.org_id,
                    OrganisationUser.department_id == department_id,
                )
            )
        )
    if team_id:
        stmt = stmt.where(
            Enrolment.user_id.in_(
                select(TeamMember.user_id).where(
                    TeamMember.organisation_id == ctx.org_id, TeamMember.team_id == team_id
                )
            )
        )
    if overdue is not None:
        cond = (Enrolment.due_date < today) & Enrolment.status.in_(
            [EnrolmentStatus.NOT_STARTED, EnrolmentStatus.IN_PROGRESS]
        )
        stmt = stmt.where(cond if overdue else ~cond | Enrolment.due_date.is_(None))
    if search:
        like = f"%{escape_like(search)}%"
        stmt = stmt.where(or_(User.full_name.ilike(like, escape="\\"), User.email.ilike(like, escape="\\")))
    total = int(await ctx.db.scalar(select(func.count()).select_from(stmt.subquery())) or 0)
    rows = (
        await ctx.db.execute(
            stmt.order_by(Enrolment.created_at.desc(), Enrolment.id)
            .limit(params.page_size)
            .offset(params.offset)
        )
    ).all()
    out = []
    for e, name, email, title, vnum in rows:
        item = s.EnrolmentOut.model_validate(e)
        item.version_number = vnum
        item.is_overdue = _is_overdue(e, today)
        item.user = s.UserBrief(id=e.user_id, full_name=name, email=email)
        item.course = s.CourseBrief(id=e.course_id, title=title)
        out.append(item)
    return out, total


async def my_enrolments(ctx: Ctx, status: str | None) -> list[s.MyEnrolmentOut]:
    stmt = (
        select(Enrolment, CourseVersion.version_number, CourseVersion.snapshot, Course.current_version_id)
        .join(CourseVersion, CourseVersion.id == Enrolment.course_version_id)
        .join(Course, Course.id == Enrolment.course_id)
        .where(
            Enrolment.organisation_id == ctx.org_id,
            Enrolment.user_id == ctx.user_id,
            Course.deleted_at.is_(None),
        )
    )
    if status:
        stmt = stmt.where(Enrolment.status == status)
    else:
        stmt = stmt.where(Enrolment.status != EnrolmentStatus.WITHDRAWN)
    rows = (
        await ctx.db.execute(
            stmt.order_by(Enrolment.last_accessed_at.desc().nulls_last(), Enrolment.created_at.desc())
        )
    ).all()
    latest = await _latest_numbers(ctx.db, [r[3] for r in rows if r[3]])
    done = await _completed_by_enrolment(ctx.db, [r[0].id for r in rows])
    today = local_today(ctx.user.timezone)
    out = []
    for e, vnum, snapshot, current_vid in rows:
        meta = (snapshot or {}).get("course") or {}
        nxt = next_lesson(snapshot or {}, done.get(e.id, set()))
        item = s.MyEnrolmentOut(
            **s.EnrolmentOut.model_validate(e).model_dump(exclude={"version_number", "is_overdue"}),
            version_number=vnum,
            is_overdue=_is_overdue(e, today),
            title=meta.get("title", ""),
            thumbnail_url=meta.get("thumbnail_url"),
            category=meta.get("category"),
            difficulty=meta.get("difficulty"),
            latest_version_number=latest.get(current_vid),
            upgrade_available=bool(
                current_vid and current_vid != e.course_version_id and e.status != EnrolmentStatus.COMPLETED
            ),
            next_lesson=s.NextLesson(
                id=nxt["id"],
                title=nxt["title"],
                lesson_type=nxt["lesson_type"],
                module_id=nxt.get("module_id"),
            )
            if nxt and e.status != "completed"
            else None,
        )
        out.append(item)
    return out


async def _latest_numbers(db: AsyncSession, version_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    if not version_ids:
        return {}
    return dict(
        (
            await db.execute(
                select(CourseVersion.id, CourseVersion.version_number).where(
                    CourseVersion.id.in_(set(version_ids))
                )
            )
        ).all()
    )


async def _completed_by_enrolment(
    db: AsyncSession, enrolment_ids: list[uuid.UUID]
) -> dict[uuid.UUID, set[str]]:
    out: dict[uuid.UUID, set[str]] = {}
    if not enrolment_ids:
        return out
    for eid, lid in (
        await db.execute(
            select(LessonProgress.enrolment_id, LessonProgress.lesson_id).where(
                LessonProgress.enrolment_id.in_(enrolment_ids), LessonProgress.status == "completed"
            )
        )
    ).all():
        out.setdefault(eid, set()).add(str(lid))
    return out


# ----------------------------------------------------------------------------- course player


def _completes_via(lesson: dict[str, Any]) -> str:
    field = LINKED_TYPES.get(lesson.get("lesson_type", ""))
    return field.removesuffix("_id") if field else "learner"


def _state(lp: LessonProgress | None) -> s.LessonState:
    if lp is None:
        return s.LessonState()
    return s.LessonState(
        status=lp.status,
        time_spent_seconds=lp.time_spent_seconds,
        completed_at=lp.completed_at,
        last_position=lp.last_position or {},
    )


async def learn_course(ctx: Ctx, course_id: uuid.UUID) -> s.LearnCourseOut:
    enrolment = await get_my_enrolment(ctx, course_id)
    version = await ctx.db.get(CourseVersion, enrolment.course_version_id)
    if version is None:
        raise NotFound("Course version not found")
    snapshot = version.snapshot or {}
    rows = await progress_rows(ctx.db, enrolment.id)
    done = completed_set(rows)
    locked = locked_lesson_ids(snapshot, done)
    current = await ctx.db.scalar(select(Course.current_version_id).where(Course.id == course_id))
    latest = (await _latest_numbers(ctx.db, [current])).get(current) if current else None
    modules = [
        s.OutlineModule(
            id=m["id"],
            title=m["title"],
            description=m.get("description"),
            position=m.get("position", 0),
            lessons=[
                s.OutlineLesson(
                    id=lsn["id"],
                    title=lsn["title"],
                    summary=lsn.get("summary"),
                    lesson_type=lsn["lesson_type"],
                    duration_minutes=lsn.get("duration_minutes") or 0,
                    position=lsn.get("position", 0),
                    is_required=lsn.get("is_required", True),
                    is_preview=lsn.get("is_preview", False),
                    linked=lsn.get("linked"),
                    completes_via=_completes_via(lsn),
                    progress=_state(rows.get(lsn["id"])),
                    locked=lsn["id"] in locked,
                )
                for lsn in m.get("lessons") or []
            ],
        )
        for m in snapshot.get("modules") or []
    ]
    nxt = next_lesson(snapshot, done) if enrolment.status != EnrolmentStatus.COMPLETED else None
    required = required_lesson_ids(snapshot)
    return s.LearnCourseOut(
        enrolment=s.LearnEnrolment.model_validate(enrolment, from_attributes=True),
        course=snapshot.get("course") or {},
        version=s.VersionInfo(
            id=version.id, version_number=version.version_number, published_at=version.published_at
        ),
        latest_version_number=latest,
        upgrade_available=bool(current and current != version.id and enrolment.status != "completed"),
        modules=modules,
        next_lesson=s.NextLesson(
            id=nxt["id"], title=nxt["title"], lesson_type=nxt["lesson_type"], module_id=nxt.get("module_id")
        )
        if nxt
        else None,
        stats=s.LearnStats(
            total_lessons=len(lessons_in_order(snapshot)),
            required_lessons=len(required),
            completed_lessons=len(done & {lsn["id"] for lsn in lessons_in_order(snapshot)}),
            completed_required=len(done & set(required)),
        ),
    )


async def learn_lesson(ctx: Ctx, course_id: uuid.UUID, lesson_id: uuid.UUID) -> s.LearnLessonOut:
    """Full lesson content from the pinned snapshot. Non-enrolled members may open preview lessons of the
    current published version."""
    enrolment = await ctx.db.scalar(
        select(Enrolment).where(
            Enrolment.organisation_id == ctx.org_id,
            Enrolment.user_id == ctx.user_id,
            Enrolment.course_id == course_id,
            Enrolment.status != EnrolmentStatus.WITHDRAWN,
        )
    )
    preview = enrolment is None
    if preview:
        course = await ctx.db.scalar(
            select(Course).where(
                Course.id == course_id,
                Course.organisation_id == ctx.org_id,
                Course.deleted_at.is_(None),
                Course.status == CourseStatus.PUBLISHED,
            )
        )
        if course is None or course.current_version_id is None:
            raise NotFound("Course not found")
        snapshot = (await ctx.db.get(CourseVersion, course.current_version_id)).snapshot or {}
        rows: dict[str, LessonProgress] = {}
    else:
        snapshot = await load_snapshot(ctx.db, enrolment)
        rows = await progress_rows(ctx.db, enrolment.id)
    found = find_lesson(snapshot, str(lesson_id))
    if found is None:
        raise NotFound("Lesson not found")
    module, lesson = found
    if preview and not lesson.get("is_preview"):
        raise NotFound("You are not enrolled in this course", code="not_enrolled")
    locked = (not preview) and lesson["id"] in locked_lesson_ids(snapshot, completed_set(rows))
    if locked:
        raise Forbidden("Complete the earlier lessons first", code="lesson_locked")
    order = [lsn["id"] for lsn in lessons_in_order(snapshot)]
    idx = order.index(lesson["id"])
    return s.LearnLessonOut(
        course_id=course_id,
        enrolment_id=enrolment.id if enrolment else None,
        module={"id": module["id"], "title": module["title"]},
        lesson=lesson,
        progress=_state(rows.get(lesson["id"])),
        locked=False,
        completes_via=_completes_via(lesson),
        previous_lesson_id=order[idx - 1] if idx > 0 else None,
        next_lesson_id=order[idx + 1] if idx + 1 < len(order) else None,
        preview=preview,
    )


async def upgrade(ctx: Ctx, course_id: uuid.UUID) -> s.LearnCourseOut:
    """Learner opt-in: re-pin to the latest version, keeping progress of lessons that still exist."""
    enrolment = await get_my_enrolment(ctx, course_id, for_update=True)
    if enrolment.status == EnrolmentStatus.COMPLETED:
        raise BadRequest(
            "Completed enrolments keep the version they were completed on", code="enrolment_completed"
        )
    course = await ctx.db.scalar(
        select(Course).where(
            Course.id == course_id, Course.organisation_id == ctx.org_id, Course.deleted_at.is_(None)
        )
    )
    if course is None or course.current_version_id is None:
        raise NotFound("Course not found")
    if course.current_version_id == enrolment.course_version_id:
        raise BadRequest("You are already on the latest version", code="already_latest")
    old_version_id = enrolment.course_version_id
    new_snapshot = (await ctx.db.get(CourseVersion, course.current_version_id)).snapshot or {}
    keep = {lsn["id"] for lsn in lessons_in_order(new_snapshot)}
    rows = await progress_rows(ctx.db, enrolment.id)
    for lid, lp in list(rows.items()):
        if lid not in keep:
            await ctx.db.delete(lp)
            rows.pop(lid)
    enrolment.course_version_id = course.current_version_id
    await ctx.db.flush()
    await recompute(ctx.db, enrolment, new_snapshot, rows)
    await ctx.db.flush()
    await ctx.audit(
        "enrolment.upgraded",
        "enrolment",
        enrolment.id,
        from_version_id=str(old_version_id),
        to_version_id=str(course.current_version_id),
    )
    return await learn_course(ctx, course_id)


async def check_activity(
    ctx: Ctx, course_id: uuid.UUID, activity_id: uuid.UUID, answer_ids: list[str]
) -> s.CheckOut:
    """Evaluate an ungraded knowledge-check activity. Answer keys are never part of the snapshot, so they
    are read from the authoring row (only if the activity is part of the learner's pinned version)."""
    enrolment = await get_my_enrolment(ctx, course_id)
    snapshot = await load_snapshot(ctx.db, enrolment)
    in_version = any(
        a["id"] == str(activity_id) and a["activity_type"] == "check"
        for lsn in lessons_in_order(snapshot)
        for a in lsn.get("activities") or []
    )
    if not in_version:
        raise NotFound("Activity not found")
    act = await ctx.db.scalar(
        select(Activity).where(Activity.id == activity_id, Activity.organisation_id == ctx.org_id)
    )
    if act is None or act.activity_type != "check":
        raise Conflict("This knowledge check is no longer available", code="check_unavailable")
    correct = sorted(str(a) for a in (act.content or {}).get("answer_ids") or [])
    return s.CheckOut(
        correct=sorted(set(answer_ids)) == correct,
        correct_ids=correct,
        explanation=(act.content or {}).get("explanation"),
    )
