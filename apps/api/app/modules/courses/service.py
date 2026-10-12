"""Course authoring, structure editing, publishing (immutable snapshots, ADR-004) and the catalog."""

from __future__ import annotations

import re
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import Select, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import Ctx
from app.core.errors import BadRequest, Conflict, NotFound
from app.core.pagination import PageParams
from app.models.assessment import Assessment
from app.models.assignment import Assignment
from app.models.content import (
    Activity,
    Course,
    CourseModule,
    CourseStatus,
    CourseVersion,
    Lesson,
    LessonType,
    Skill,
)
from app.models.identity import User
from app.models.learning import Enrolment, EnrolmentStatus
from app.models.simulation import Simulation
from app.modules.billing.plans import check_limit
from app.modules.courses import schemas as s
from app.modules.courses.content_rules import (
    LINK_FIELDS,
    LINKED_TYPES,
    strip_secrets,
    validate_activity_content,
    validate_lesson_content,
)
from app.modules.courses.snapshot import SCHEMA_VERSION, diff_snapshots

AUTHOR_PERMS = ("courses.create", "courses.edit", "courses.publish", "courses.delete", "lessons.manage")
STRUCTURE_PERMS = ("lessons.manage", "courses.edit")


def is_author(ctx: Ctx) -> bool:
    return ctx.can_any(*AUTHOR_PERMS)


def _now() -> datetime:
    return datetime.now(UTC)


def slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return (slug or "course")[:120]


def escape_like(q: str) -> str:
    return q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


# ----------------------------------------------------------------------------- loading


async def get_course(ctx: Ctx, course_id: uuid.UUID, *, for_update: bool = False) -> Course:
    stmt = select(Course).where(Course.id == course_id, Course.organisation_id == ctx.org_id,
                                Course.deleted_at.is_(None))
    if for_update:
        stmt = stmt.with_for_update()
    course = await ctx.db.scalar(stmt)
    if course is None:
        raise NotFound("Course not found")
    return course


async def get_visible_course(ctx: Ctx, course_id: uuid.UUID) -> Course:
    """Authors see every course; everyone else only published courses with a current version."""
    course = await get_course(ctx, course_id)
    if not is_author(ctx) and (course.status != CourseStatus.PUBLISHED or course.current_version_id is None):
        raise NotFound("Course not found")
    return course


async def _get_module(ctx: Ctx, course: Course, module_id: uuid.UUID) -> CourseModule:
    m = await ctx.db.scalar(select(CourseModule).where(
        CourseModule.id == module_id, CourseModule.course_id == course.id,
        CourseModule.organisation_id == ctx.org_id, CourseModule.deleted_at.is_(None)))
    if m is None:
        raise NotFound("Module not found")
    return m


async def _get_lesson(ctx: Ctx, course: Course, lesson_id: uuid.UUID) -> Lesson:
    lsn = await ctx.db.scalar(select(Lesson).where(
        Lesson.id == lesson_id, Lesson.course_id == course.id, Lesson.organisation_id == ctx.org_id,
        Lesson.deleted_at.is_(None)))
    if lsn is None:
        raise NotFound("Lesson not found")
    return lsn


async def _get_activity(ctx: Ctx, course: Course, activity_id: uuid.UUID) -> Activity:
    act = await ctx.db.scalar(
        select(Activity).join(Lesson, Lesson.id == Activity.lesson_id).where(
            Activity.id == activity_id, Activity.organisation_id == ctx.org_id, Lesson.course_id == course.id,
            Lesson.deleted_at.is_(None)))
    if act is None:
        raise NotFound("Activity not found")
    return act


async def _touch(db: AsyncSession, course: Course) -> None:
    """Bump the course's updated_at when its structure changes."""
    await db.execute(update(Course).where(Course.id == course.id).values(updated_at=func.now()))


# ----------------------------------------------------------------------------- course output


async def _counts(db: AsyncSession, course_ids: list[uuid.UUID]) -> dict[uuid.UUID, tuple[int, int, int]]:
    if not course_ids:
        return {}
    mods = dict((await db.execute(
        select(CourseModule.course_id, func.count()).where(
            CourseModule.course_id.in_(course_ids), CourseModule.deleted_at.is_(None))
        .group_by(CourseModule.course_id))).all())
    lessons = dict((await db.execute(
        select(Lesson.course_id, func.count()).where(Lesson.course_id.in_(course_ids), Lesson.deleted_at.is_(None))
        .group_by(Lesson.course_id))).all())
    enrols = dict((await db.execute(
        select(Enrolment.course_id, func.count()).where(
            Enrolment.course_id.in_(course_ids), Enrolment.status != EnrolmentStatus.WITHDRAWN)
        .group_by(Enrolment.course_id))).all())
    return {cid: (mods.get(cid, 0), lessons.get(cid, 0), enrols.get(cid, 0)) for cid in course_ids}


async def _version_numbers(db: AsyncSession, version_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    if not version_ids:
        return {}
    return dict((await db.execute(
        select(CourseVersion.id, CourseVersion.version_number).where(CourseVersion.id.in_(version_ids)))).all())


def _course_out(course: Course, counts: tuple[int, int, int] = (0, 0, 0), version_number: int | None = None,
                overlay: dict[str, Any] | None = None) -> s.CourseOut:
    out = s.CourseOut.model_validate(course)
    out.module_count, out.lesson_count, out.enrolment_count = counts
    out.current_version_number = version_number
    if overlay:  # learners see the published metadata, never unpublished draft edits
        for key in ("title", "subtitle", "description", "category", "difficulty", "duration_minutes",
                    "learning_objectives", "prerequisites", "target_audience", "tags", "thumbnail_url",
                    "certificate_enabled", "pass_threshold", "ai_tutor_enabled", "sequential"):
            if key in overlay:
                setattr(out, key, overlay[key] if overlay[key] is not None else getattr(out, key))
        out.skills = [s.SkillRef(id=sk["id"], name=sk["name"]) for sk in overlay.get("skills", [])]
    return out


async def course_out(ctx: Ctx, course: Course) -> s.CourseOut:
    counts = (await _counts(ctx.db, [course.id]))[course.id]
    vnum = None
    overlay = None
    if course.current_version_id:
        version = await ctx.db.get(CourseVersion, course.current_version_id)
        if version:
            vnum = version.version_number
            if not is_author(ctx):
                overlay = (version.snapshot or {}).get("course")
                stats = (version.snapshot or {}).get("stats") or {}
                counts = (stats.get("module_count", 0), stats.get("lesson_count", 0), counts[2])
    return _course_out(course, counts, vnum, overlay)


async def list_courses(ctx: Ctx, params: PageParams, *, search: str | None, status: str | None,
                       category: str | None, difficulty: str | None, mine: bool) -> tuple[list[s.CourseOut], int]:
    stmt = select(Course).where(Course.organisation_id == ctx.org_id, Course.deleted_at.is_(None))
    if search:
        like = f"%{escape_like(search)}%"
        stmt = stmt.where(or_(Course.title.ilike(like, escape="\\"), Course.description.ilike(like, escape="\\"),
                              Course.slug.ilike(like, escape="\\")))
    if status:
        stmt = stmt.where(Course.status == status)
    if category:
        stmt = stmt.where(Course.category == category)
    if difficulty:
        stmt = stmt.where(Course.difficulty == difficulty)
    if mine:
        stmt = stmt.where(or_(Course.created_by == ctx.user_id, Course.instructor_id == ctx.user_id))
    total = int(await ctx.db.scalar(select(func.count()).select_from(stmt.subquery())) or 0)
    rows = list((await ctx.db.execute(
        stmt.order_by(Course.updated_at.desc(), Course.id).limit(params.page_size).offset(params.offset)
    )).scalars().all())
    counts = await _counts(ctx.db, [c.id for c in rows])
    vnums = await _version_numbers(ctx.db, [c.current_version_id for c in rows if c.current_version_id])
    return [_course_out(c, counts[c.id], vnums.get(c.current_version_id)) for c in rows], total


async def _unique_slug(db: AsyncSession, org_id: uuid.UUID, base: str, *, exclude: uuid.UUID | None = None) -> str:
    existing = set((await db.execute(select(Course.slug).where(
        Course.organisation_id == org_id, Course.slug.like(f"{escape_like(base)}%", escape="\\"),
        Course.id != exclude if exclude else True))).scalars().all())
    if base not in existing:
        return base
    n = 2
    while f"{base}-{n}" in existing:
        n += 1
    return f"{base}-{n}"


async def _slug_taken(db: AsyncSession, org_id: uuid.UUID, slug: str, exclude: uuid.UUID | None = None) -> bool:
    stmt = select(Course.id).where(Course.organisation_id == org_id, Course.slug == slug)
    if exclude:
        stmt = stmt.where(Course.id != exclude)
    return (await db.scalar(stmt)) is not None


async def _load_skills(ctx: Ctx, skill_ids: list[uuid.UUID]) -> list[Skill]:
    if not skill_ids:
        return []
    ids = list(dict.fromkeys(skill_ids))
    skills = list((await ctx.db.execute(
        select(Skill).where(Skill.id.in_(ids), Skill.organisation_id == ctx.org_id))).scalars().all())
    if len(skills) != len(ids):
        raise BadRequest("One or more skills were not found", code="invalid_skill")
    return skills


async def _check_instructor(ctx: Ctx, user_id: uuid.UUID | None) -> None:
    if user_id is None:
        return
    from app.models.tenancy import OrganisationUser

    ok = await ctx.db.scalar(select(OrganisationUser.id).where(
        OrganisationUser.organisation_id == ctx.org_id, OrganisationUser.user_id == user_id))
    if not ok:
        raise BadRequest("Instructor must be a member of this organisation", code="invalid_instructor")


async def create_course(ctx: Ctx, body: s.CourseCreate) -> Course:
    """Create a draft course (plan limit ``max_courses``)."""
    await check_limit(ctx.db, ctx.org, "max_courses")
    data = body.model_dump(exclude_unset=True, exclude={"skill_ids", "slug"})
    if body.slug:
        if await _slug_taken(ctx.db, ctx.org_id, body.slug):
            raise Conflict("A course with this slug already exists", code="slug_taken")
        slug = body.slug
    else:
        slug = await _unique_slug(ctx.db, ctx.org_id, slugify(body.title))
    await _check_instructor(ctx, body.instructor_id)
    skills = await _load_skills(ctx, body.skill_ids or [])
    data = {k: v for k, v in data.items() if v is not None}
    course = Course(organisation_id=ctx.org_id, slug=slug, created_by=ctx.user_id,
                    instructor_id=data.pop("instructor_id", None) or ctx.user_id,
                    status=CourseStatus.DRAFT, skills=skills, **data)
    course.description = course.description or ""
    ctx.db.add(course)
    await ctx.db.flush()
    await ctx.db.refresh(course)
    await ctx.audit("course.created", "course", course.id, title=course.title)
    return course


async def update_course(ctx: Ctx, course_id: uuid.UUID, body: s.CourseUpdate) -> Course:
    course = await get_course(ctx, course_id)
    data = body.model_dump(exclude_unset=True)
    if "slug" in data and data["slug"] and data["slug"] != course.slug:
        if await _slug_taken(ctx.db, ctx.org_id, data["slug"], exclude=course.id):
            raise Conflict("A course with this slug already exists", code="slug_taken")
    if "status" in data:
        new = data.pop("status")
        if new is not None and new != course.status:
            allowed = {CourseStatus.DRAFT, CourseStatus.IN_REVIEW}
            if new not in allowed or course.status not in allowed:
                raise BadRequest("Use publish / archive / restore to change this status", code="invalid_status")
            course.status = new
    if "skill_ids" in data:
        ids = data.pop("skill_ids")
        course.skills = await _load_skills(ctx, ids or [])
    if "instructor_id" in data:
        await _check_instructor(ctx, data["instructor_id"])
    non_nullable = {"title", "slug", "description", "difficulty", "duration_minutes", "learning_objectives",
                    "prerequisites", "tags", "visibility", "certificate_enabled", "pass_threshold",
                    "ai_tutor_enabled", "sequential"}
    for key, value in data.items():
        if value is None and key in non_nullable:
            continue
        setattr(course, key, value)
    await ctx.db.flush()
    await ctx.db.refresh(course)
    await ctx.audit("course.updated", "course", course.id, fields=sorted(data))
    return course


async def set_course_skills(ctx: Ctx, course_id: uuid.UUID, skill_ids: list[uuid.UUID]) -> Course:
    course = await get_course(ctx, course_id)
    course.skills = await _load_skills(ctx, skill_ids)
    await ctx.db.flush()
    await ctx.db.refresh(course)
    await ctx.audit("course.skills_updated", "course", course.id, skill_ids=[str(i) for i in skill_ids])
    return course


async def delete_course(ctx: Ctx, course_id: uuid.UUID) -> None:
    """Soft delete. The slug is released so it can be reused."""
    course = await get_course(ctx, course_id)
    course.deleted_at = _now()
    course.slug = f"{course.slug[:120]}--deleted-{uuid.uuid4().hex[:8]}"
    await ctx.db.flush()
    await ctx.audit("course.deleted", "course", course.id, title=course.title)


async def archive_course(ctx: Ctx, course_id: uuid.UUID) -> Course:
    course = await get_course(ctx, course_id)
    if course.status == CourseStatus.ARCHIVED:
        raise BadRequest("Course is already archived")
    course.status = CourseStatus.ARCHIVED
    await ctx.db.flush()
    await ctx.db.refresh(course)
    await ctx.audit("course.archived", "course", course.id)
    return course


async def restore_course(ctx: Ctx, course_id: uuid.UUID) -> Course:
    course = await get_course(ctx, course_id)
    if course.status != CourseStatus.ARCHIVED:
        raise BadRequest("Only archived courses can be restored")
    course.status = CourseStatus.PUBLISHED if course.current_version_id else CourseStatus.DRAFT
    await ctx.db.flush()
    await ctx.db.refresh(course)
    await ctx.audit("course.restored", "course", course.id, status=course.status)
    return course


async def duplicate_course(ctx: Ctx, course_id: uuid.UUID, title: str | None) -> Course:
    """Deep copy (modules, lessons, activities, skills) into a new draft course."""
    src = await get_course(ctx, course_id)
    await check_limit(ctx.db, ctx.org, "max_courses")
    new_title = title or f"Copy of {src.title}"[:255]
    copy = Course(
        organisation_id=ctx.org_id, slug=await _unique_slug(ctx.db, ctx.org_id, slugify(new_title)),
        title=new_title, subtitle=src.subtitle, description=src.description, category=src.category,
        difficulty=src.difficulty, duration_minutes=src.duration_minutes,
        learning_objectives=list(src.learning_objectives or []), prerequisites=list(src.prerequisites or []),
        target_audience=src.target_audience, tags=list(src.tags or []), thumbnail_url=src.thumbnail_url,
        status=CourseStatus.DRAFT, visibility=src.visibility, instructor_id=ctx.user_id, created_by=ctx.user_id,
        certificate_enabled=src.certificate_enabled, pass_threshold=src.pass_threshold,
        ai_tutor_enabled=src.ai_tutor_enabled, ai_generated=src.ai_generated, sequential=src.sequential,
        skills=list(src.skills),
    )
    ctx.db.add(copy)
    await ctx.db.flush()
    tree = await load_tree(ctx.db, ctx.org_id, src)
    for m in tree.modules:
        nm = CourseModule(organisation_id=ctx.org_id, course_id=copy.id, title=m.title, description=m.description,
                          position=m.position)
        ctx.db.add(nm)
        await ctx.db.flush()
        for lsn in tree.lessons.get(m.id, []):
            nl = Lesson(organisation_id=ctx.org_id, course_id=copy.id, module_id=nm.id, title=lsn.title,
                        summary=lsn.summary, lesson_type=lsn.lesson_type, content=dict(lsn.content or {}),
                        duration_minutes=lsn.duration_minutes, position=lsn.position, is_required=lsn.is_required,
                        is_preview=lsn.is_preview, assessment_id=lsn.assessment_id,
                        assignment_id=lsn.assignment_id, simulation_id=lsn.simulation_id,
                        skill_ids=list(lsn.skill_ids or []), ai_generated=lsn.ai_generated)
            ctx.db.add(nl)
            await ctx.db.flush()
            for a in tree.activities.get(lsn.id, []):
                ctx.db.add(Activity(organisation_id=ctx.org_id, lesson_id=nl.id, activity_type=a.activity_type,
                                    title=a.title, content=dict(a.content or {}), position=a.position))
    await ctx.db.flush()
    await ctx.db.refresh(copy)
    await ctx.audit("course.duplicated", "course", copy.id, source_course_id=str(src.id))
    return copy


# ----------------------------------------------------------------------------- tree


@dataclass
class Tree:
    modules: list[CourseModule]
    lessons: dict[uuid.UUID, list[Lesson]]
    activities: dict[uuid.UUID, list[Activity]]
    linked: dict[tuple[str, uuid.UUID], dict[str, Any]] = field(default_factory=dict)


async def _linked_items(db: AsyncSession, org_id: uuid.UUID, lessons: list[Lesson]) -> dict[tuple[str, uuid.UUID],
                                                                                          dict[str, Any]]:
    """Fetch titles / learner-safe settings of referenced assessments, assignments and simulations."""
    ids: dict[str, set[uuid.UUID]] = defaultdict(set)
    for lsn in lessons:
        for f in LINK_FIELDS:
            if getattr(lsn, f):
                ids[f].add(getattr(lsn, f))
    out: dict[tuple[str, uuid.UUID], dict[str, Any]] = {}
    if ids["assessment_id"]:
        for r in (await db.execute(select(
                Assessment.id, Assessment.title, Assessment.status, Assessment.kind, Assessment.pass_percentage,
                Assessment.time_limit_minutes, Assessment.max_attempts, Assessment.deleted_at).where(
                Assessment.id.in_(ids["assessment_id"]), Assessment.organisation_id == org_id))).all():
            out[("assessment_id", r.id)] = {
                "type": "assessment", "id": str(r.id), "title": r.title, "status": r.status, "kind": r.kind,
                "pass_percentage": r.pass_percentage, "time_limit_minutes": r.time_limit_minutes,
                "max_attempts": r.max_attempts, "deleted": r.deleted_at is not None}
    if ids["assignment_id"]:
        for r in (await db.execute(select(
                Assignment.id, Assignment.title, Assignment.status, Assignment.passing_score,
                Assignment.time_limit_minutes, Assignment.due_days_after_enrolment, Assignment.deleted_at).where(
                Assignment.id.in_(ids["assignment_id"]), Assignment.organisation_id == org_id))).all():
            out[("assignment_id", r.id)] = {
                "type": "assignment", "id": str(r.id), "title": r.title, "status": r.status,
                "passing_score": r.passing_score, "time_limit_minutes": r.time_limit_minutes,
                "due_days_after_enrolment": r.due_days_after_enrolment, "deleted": r.deleted_at is not None}
    if ids["simulation_id"]:
        for r in (await db.execute(select(
                Simulation.id, Simulation.title, Simulation.status, Simulation.difficulty,
                Simulation.estimated_minutes, Simulation.deleted_at).where(
                Simulation.id.in_(ids["simulation_id"]), Simulation.organisation_id == org_id))).all():
            out[("simulation_id", r.id)] = {
                "type": "simulation", "id": str(r.id), "title": r.title, "status": r.status,
                "difficulty": r.difficulty, "estimated_minutes": r.estimated_minutes,
                "deleted": r.deleted_at is not None}
    return out


async def load_tree(db: AsyncSession, org_id: uuid.UUID, course: Course) -> Tree:
    modules = list((await db.execute(select(CourseModule).where(
        CourseModule.course_id == course.id, CourseModule.organisation_id == org_id,
        CourseModule.deleted_at.is_(None)).order_by(CourseModule.position, CourseModule.created_at))).scalars())
    module_ids = {m.id for m in modules}
    lessons = list((await db.execute(select(Lesson).where(
        Lesson.course_id == course.id, Lesson.organisation_id == org_id, Lesson.deleted_at.is_(None))
        .order_by(Lesson.position, Lesson.created_at))).scalars())
    by_module: dict[uuid.UUID, list[Lesson]] = defaultdict(list)
    for lsn in lessons:
        if lsn.module_id in module_ids:
            by_module[lsn.module_id].append(lsn)
    acts: dict[uuid.UUID, list[Activity]] = defaultdict(list)
    lesson_ids = [lsn.id for lsn in lessons]
    if lesson_ids:
        for a in (await db.execute(select(Activity).where(Activity.lesson_id.in_(lesson_ids))
                                   .order_by(Activity.position, Activity.created_at))).scalars():
            acts[a.lesson_id].append(a)
    linked = await _linked_items(db, org_id, lessons)
    return Tree(modules, by_module, acts, linked)


def _lesson_linked(tree: Tree, lsn: Lesson) -> dict[str, Any] | None:
    f = LINKED_TYPES.get(lsn.lesson_type)
    if not f or not getattr(lsn, f):
        return None
    return tree.linked.get((f, getattr(lsn, f)))


def _lesson_out(tree: Tree, lsn: Lesson) -> s.LessonOut:
    out = s.LessonOut.model_validate(lsn, from_attributes=True)
    out.activities = [s.ActivityOut.model_validate(a) for a in tree.activities.get(lsn.id, [])]
    linked = _lesson_linked(tree, lsn)
    if linked:
        out.linked = s.LinkedItem(type=linked["type"], id=linked["id"], title=linked["title"],
                                  status="deleted" if linked["deleted"] else linked["status"])
    return out


def build_snapshot(course: Course, tree: Tree) -> dict[str, Any]:
    """Freeze the full tree as learner-safe JSON (answer keys / expected outputs are stripped)."""
    modules = []
    lesson_count = required = duration = 0
    for m in tree.modules:
        lessons = []
        for lsn in tree.lessons.get(m.id, []):
            linked = _lesson_linked(tree, lsn)
            link_info = None
            if linked:
                link_info = {k: v for k, v in linked.items() if k not in ("deleted", "status")}
            lessons.append({
                "id": str(lsn.id), "module_id": str(m.id), "title": lsn.title, "summary": lsn.summary,
                "lesson_type": lsn.lesson_type, "content": strip_secrets(lsn.content or {}),
                "duration_minutes": lsn.duration_minutes, "position": lsn.position,
                "is_required": lsn.is_required, "is_preview": lsn.is_preview,
                "assessment_id": str(lsn.assessment_id) if lsn.assessment_id else None,
                "assignment_id": str(lsn.assignment_id) if lsn.assignment_id else None,
                "simulation_id": str(lsn.simulation_id) if lsn.simulation_id else None,
                "linked": link_info, "skill_ids": [str(x) for x in lsn.skill_ids or []],
                "activities": [
                    {"id": str(a.id), "activity_type": a.activity_type, "title": a.title,
                     "content": strip_secrets(a.content or {}), "position": a.position}
                    for a in tree.activities.get(lsn.id, [])
                ],
            })
            lesson_count += 1
            required += 1 if lsn.is_required else 0
            duration += lsn.duration_minutes or 0
        modules.append({"id": str(m.id), "title": m.title, "description": m.description, "position": m.position,
                        "lessons": lessons})
    return {
        "schema_version": SCHEMA_VERSION,
        "course": {
            "id": str(course.id), "slug": course.slug, "title": course.title, "subtitle": course.subtitle,
            "description": course.description, "category": course.category, "difficulty": course.difficulty,
            "duration_minutes": course.duration_minutes or duration,
            "learning_objectives": list(course.learning_objectives or []),
            "prerequisites": list(course.prerequisites or []), "target_audience": course.target_audience,
            "tags": list(course.tags or []), "thumbnail_url": course.thumbnail_url, "sequential": course.sequential,
            "certificate_enabled": course.certificate_enabled, "pass_threshold": course.pass_threshold,
            "ai_tutor_enabled": course.ai_tutor_enabled,
            "skills": [{"id": str(sk.id), "name": sk.name} for sk in course.skills],
        },
        "modules": modules,
        "stats": {"module_count": len(modules), "lesson_count": lesson_count, "required_lesson_count": required,
                  "duration_minutes": duration},
    }


def _comparable(snapshot: dict[str, Any]) -> dict[str, Any]:
    return {"course": snapshot.get("course"), "modules": snapshot.get("modules")}


async def get_structure(ctx: Ctx, course_id: uuid.UUID) -> s.StructureOut:
    course = await get_course(ctx, course_id)
    tree = await load_tree(ctx.db, ctx.org_id, course)
    changed = True
    vnum = None
    if course.current_version_id:
        version = await ctx.db.get(CourseVersion, course.current_version_id)
        if version:
            vnum = version.version_number
            changed = _comparable(build_snapshot(course, tree)) != _comparable(version.snapshot or {})
    n_lessons = sum(len(v) for v in tree.lessons.values())
    enrols = (await _counts(ctx.db, [course.id]))[course.id][2]
    return s.StructureOut(
        course=_course_out(course, (len(tree.modules), n_lessons, enrols), vnum),
        modules=[
            s.StructureModuleOut(**s.ModuleOut.model_validate(m).model_dump(),
                                 lessons=[_lesson_out(tree, lsn) for lsn in tree.lessons.get(m.id, [])])
            for m in tree.modules
        ],
        has_unpublished_changes=changed,
    )


# ----------------------------------------------------------------------------- modules


async def create_module(ctx: Ctx, course_id: uuid.UUID, body: s.ModuleCreate) -> CourseModule:
    course = await get_course(ctx, course_id)
    position = body.position
    if position is None:
        position = int(await ctx.db.scalar(select(func.coalesce(func.max(CourseModule.position) + 1, 0)).where(
            CourseModule.course_id == course.id, CourseModule.deleted_at.is_(None))) or 0)
    m = CourseModule(organisation_id=ctx.org_id, course_id=course.id, title=body.title,
                     description=body.description, position=position)
    ctx.db.add(m)
    await _touch(ctx.db, course)
    await ctx.db.flush()
    await ctx.audit("course.module_created", "course_module", m.id, course_id=str(course.id))
    return m


async def update_module(ctx: Ctx, course_id: uuid.UUID, module_id: uuid.UUID, body: s.ModuleUpdate) -> CourseModule:
    course = await get_course(ctx, course_id)
    m = await _get_module(ctx, course, module_id)
    for k, v in body.model_dump(exclude_unset=True).items():
        if v is None and k in ("title", "position"):
            continue
        setattr(m, k, v)
    await _touch(ctx.db, course)
    await ctx.db.flush()
    await ctx.db.refresh(m)
    return m


async def delete_module(ctx: Ctx, course_id: uuid.UUID, module_id: uuid.UUID) -> None:
    """Soft delete a module and its lessons (published snapshots are unaffected)."""
    course = await get_course(ctx, course_id)
    m = await _get_module(ctx, course, module_id)
    now = _now()
    m.deleted_at = now
    await ctx.db.execute(update(Lesson).where(Lesson.module_id == m.id, Lesson.deleted_at.is_(None))
                         .values(deleted_at=now))
    await _touch(ctx.db, course)
    await ctx.db.flush()
    await ctx.audit("course.module_deleted", "course_module", m.id, course_id=str(course.id))


# ----------------------------------------------------------------------------- lessons


async def _validate_links(ctx: Ctx, lesson_type: str, links: dict[str, uuid.UUID | None]) -> dict[str, Any]:
    """Quiz / assignment / simulation lessons must reference an item of the same organisation."""
    required = LINKED_TYPES.get(lesson_type)
    result: dict[str, Any] = dict.fromkeys(LINK_FIELDS)
    if not required:
        return result
    ref = links.get(required)
    if ref is None:
        raise BadRequest(f"'{required}' is required for {lesson_type} lessons", code="invalid_content",
                         details={"field": required})
    model = {"assessment_id": Assessment, "assignment_id": Assignment, "simulation_id": Simulation}[required]
    found = await ctx.db.scalar(select(model.id).where(model.id == ref, model.organisation_id == ctx.org_id,
                                                       model.deleted_at.is_(None)))
    if not found:
        raise BadRequest(f"Linked {required.removesuffix('_id')} not found", code="invalid_link",
                         details={"field": required})
    result[required] = ref
    return result


async def _validate_lesson_skills(ctx: Ctx, skill_ids: list[uuid.UUID]) -> list[str]:
    await _load_skills(ctx, skill_ids)
    return [str(x) for x in dict.fromkeys(skill_ids)]


async def create_lesson(ctx: Ctx, course_id: uuid.UUID, module_id: uuid.UUID, body: s.LessonCreate) -> Lesson:
    course = await get_course(ctx, course_id)
    m = await _get_module(ctx, course, module_id)
    content = validate_lesson_content(body.lesson_type, body.content)
    links = await _validate_links(ctx, body.lesson_type, {f: getattr(body, f) for f in LINK_FIELDS})
    position = body.position
    if position is None:
        position = int(await ctx.db.scalar(select(func.coalesce(func.max(Lesson.position) + 1, 0)).where(
            Lesson.module_id == m.id, Lesson.deleted_at.is_(None))) or 0)
    lsn = Lesson(organisation_id=ctx.org_id, course_id=course.id, module_id=m.id, title=body.title,
                 summary=body.summary, lesson_type=body.lesson_type, content=content,
                 duration_minutes=body.duration_minutes, position=position, is_required=body.is_required,
                 is_preview=body.is_preview, skill_ids=await _validate_lesson_skills(ctx, body.skill_ids), **links)
    ctx.db.add(lsn)
    await _touch(ctx.db, course)
    await ctx.db.flush()
    await ctx.db.refresh(lsn)
    await ctx.audit("course.lesson_created", "lesson", lsn.id, course_id=str(course.id), type=lsn.lesson_type)
    return lsn


async def update_lesson(ctx: Ctx, course_id: uuid.UUID, lesson_id: uuid.UUID, body: s.LessonUpdate) -> Lesson:
    course = await get_course(ctx, course_id)
    lsn = await _get_lesson(ctx, course, lesson_id)
    data = body.model_dump(exclude_unset=True)
    lesson_type = data.get("lesson_type") or lsn.lesson_type
    content = data["content"] if data.get("content") is not None else lsn.content
    if "lesson_type" in data or "content" in data:
        lsn.content = validate_lesson_content(lesson_type, content)
        lsn.lesson_type = lesson_type
    if "lesson_type" in data or any(f in data for f in LINK_FIELDS):
        current = {f: data[f] if f in data else getattr(lsn, f) for f in LINK_FIELDS}
        for f, v in (await _validate_links(ctx, lesson_type, current)).items():
            setattr(lsn, f, v)
    if data.get("module_id") and data["module_id"] != lsn.module_id:
        await _get_module(ctx, course, data["module_id"])
        lsn.module_id = data["module_id"]
    if "skill_ids" in data and data["skill_ids"] is not None:
        lsn.skill_ids = await _validate_lesson_skills(ctx, data["skill_ids"])
    for k in ("title", "summary", "duration_minutes", "position", "is_required", "is_preview"):
        if k in data and (data[k] is not None or k == "summary"):
            setattr(lsn, k, data[k])
    await _touch(ctx.db, course)
    await ctx.db.flush()
    await ctx.db.refresh(lsn)
    return lsn


async def delete_lesson(ctx: Ctx, course_id: uuid.UUID, lesson_id: uuid.UUID) -> None:
    course = await get_course(ctx, course_id)
    lsn = await _get_lesson(ctx, course, lesson_id)
    lsn.deleted_at = _now()
    await _touch(ctx.db, course)
    await ctx.db.flush()
    await ctx.audit("course.lesson_deleted", "lesson", lsn.id, course_id=str(course.id))


async def lesson_out(ctx: Ctx, course_id: uuid.UUID, lesson_id: uuid.UUID) -> s.LessonOut:
    course = await get_course(ctx, course_id)
    lsn = await _get_lesson(ctx, course, lesson_id)
    acts = list((await ctx.db.execute(select(Activity).where(Activity.lesson_id == lsn.id)
                                      .order_by(Activity.position, Activity.created_at))).scalars())
    tree = Tree([], {}, {lsn.id: acts}, await _linked_items(ctx.db, ctx.org_id, [lsn]))
    return _lesson_out(tree, lsn)


# ----------------------------------------------------------------------------- activities


async def create_activity(ctx: Ctx, course_id: uuid.UUID, lesson_id: uuid.UUID, body: s.ActivityCreate) -> Activity:
    course = await get_course(ctx, course_id)
    lsn = await _get_lesson(ctx, course, lesson_id)
    content = validate_activity_content(body.activity_type, body.content)
    position = body.position
    if position is None:
        position = int(await ctx.db.scalar(select(func.coalesce(func.max(Activity.position) + 1, 0)).where(
            Activity.lesson_id == lsn.id)) or 0)
    act = Activity(organisation_id=ctx.org_id, lesson_id=lsn.id, activity_type=body.activity_type,
                   title=body.title, content=content, position=position)
    ctx.db.add(act)
    await _touch(ctx.db, course)
    await ctx.db.flush()
    return act


async def update_activity(ctx: Ctx, course_id: uuid.UUID, activity_id: uuid.UUID,
                          body: s.ActivityUpdate) -> Activity:
    course = await get_course(ctx, course_id)
    act = await _get_activity(ctx, course, activity_id)
    data = body.model_dump(exclude_unset=True)
    if "activity_type" in data or "content" in data:
        atype = data.get("activity_type") or act.activity_type
        content = data["content"] if data.get("content") is not None else act.content
        act.content = validate_activity_content(atype, content)
        act.activity_type = atype
    if "title" in data:
        act.title = data["title"]
    if data.get("position") is not None:
        act.position = data["position"]
    await _touch(ctx.db, course)
    await ctx.db.flush()
    await ctx.db.refresh(act)
    return act


async def delete_activity(ctx: Ctx, course_id: uuid.UUID, activity_id: uuid.UUID) -> None:
    course = await get_course(ctx, course_id)
    act = await _get_activity(ctx, course, activity_id)
    await ctx.db.delete(act)
    await _touch(ctx.db, course)
    await ctx.db.flush()


async def reorder_activities(ctx: Ctx, course_id: uuid.UUID, lesson_id: uuid.UUID,
                             activity_ids: list[uuid.UUID]) -> list[Activity]:
    course = await get_course(ctx, course_id)
    lsn = await _get_lesson(ctx, course, lesson_id)
    acts = {a.id: a for a in (await ctx.db.execute(select(Activity).where(Activity.lesson_id == lsn.id))).scalars()}
    if set(activity_ids) != set(acts) or len(activity_ids) != len(acts):
        raise BadRequest("activity_ids must list every activity of the lesson exactly once")
    for i, aid in enumerate(activity_ids):
        acts[aid].position = i
    await _touch(ctx.db, course)
    await ctx.db.flush()
    return [acts[a] for a in activity_ids]


# ----------------------------------------------------------------------------- reorder


async def reorder_structure(ctx: Ctx, course_id: uuid.UUID, body: s.ReorderIn) -> s.StructureOut:
    """Bulk drag-and-drop update: module positions, lesson positions and lesson moves between modules."""
    course = await get_course(ctx, course_id)
    modules = {m.id: m for m in (await ctx.db.execute(select(CourseModule).where(
        CourseModule.course_id == course.id, CourseModule.organisation_id == ctx.org_id,
        CourseModule.deleted_at.is_(None)))).scalars()}
    lessons = {lsn.id: lsn for lsn in (await ctx.db.execute(select(Lesson).where(
        Lesson.course_id == course.id, Lesson.organisation_id == ctx.org_id, Lesson.deleted_at.is_(None)))).scalars()}
    unknown_m = [str(m.id) for m in body.modules if m.id not in modules]
    unknown_l = [str(lsn.id) for m in body.modules for lsn in m.lessons
                 if lsn.id not in lessons or (lsn.module_id and lsn.module_id not in modules)]
    if unknown_m or unknown_l:
        raise BadRequest("Structure references modules or lessons outside this course", code="invalid_structure",
                         details={"modules": unknown_m, "lessons": unknown_l})
    for m in body.modules:
        modules[m.id].position = m.position
        for item in m.lessons:
            lsn = lessons[item.id]
            lsn.module_id = item.module_id or m.id
            lsn.position = item.position
    await _touch(ctx.db, course)
    await ctx.db.flush()
    await ctx.audit("course.structure_reordered", "course", course.id)
    return await get_structure(ctx, course.id)


# ----------------------------------------------------------------------------- publish & versions


def _publish_problems(tree: Tree) -> list[dict[str, Any]]:
    problems: list[dict[str, Any]] = []
    if not tree.modules:
        problems.append({"code": "no_modules", "message": "Add at least one module"})
    all_lessons = [lsn for m in tree.modules for lsn in tree.lessons.get(m.id, [])]
    if not all_lessons:
        problems.append({"code": "no_lessons", "message": "Add at least one lesson"})
    for lsn in all_lessons:
        ref = {"lesson_id": str(lsn.id), "lesson_title": lsn.title}
        try:
            validate_lesson_content(lsn.lesson_type, lsn.content)
        except BadRequest as exc:
            problems.append({"code": "invalid_content", "message": exc.message, **ref})
        f = LINKED_TYPES.get(lsn.lesson_type)
        if f:
            linked = tree.linked.get((f, getattr(lsn, f))) if getattr(lsn, f) else None
            if not linked or linked["deleted"]:
                problems.append({"code": "missing_link", "message": f"Linked {f.removesuffix('_id')} is missing",
                                 **ref})
        if lsn.lesson_type == LessonType.MIXED and not tree.activities.get(lsn.id):
            problems.append({"code": "empty_lesson", "message": "Mixed lessons need at least one activity", **ref})
    return problems


def _version_summary(v: CourseVersion, names: dict[uuid.UUID, str] | None = None) -> s.VersionSummary:
    return s.VersionSummary(
        id=v.id, version_number=v.version_number, status=v.status, changelog=v.changelog,
        published_by=v.published_by, published_by_name=(names or {}).get(v.published_by) if v.published_by else None,
        published_at=v.published_at, stats=(v.snapshot or {}).get("stats") or {})


async def publish_course(ctx: Ctx, course_id: uuid.UUID, changelog: str | None) -> tuple[Course, CourseVersion]:
    """Validate, freeze the tree into a new immutable CourseVersion and make it current."""
    course = await get_course(ctx, course_id, for_update=True)
    tree = await load_tree(ctx.db, ctx.org_id, course)
    problems = _publish_problems(tree)
    if problems:
        raise BadRequest("The course is not ready to publish", code="publish_validation_failed",
                         details={"problems": problems})
    last = int(await ctx.db.scalar(select(func.coalesce(func.max(CourseVersion.version_number), 0)).where(
        CourseVersion.course_id == course.id)) or 0)
    await ctx.db.execute(update(CourseVersion).where(
        CourseVersion.course_id == course.id, CourseVersion.status == "published").values(status="superseded"))
    version = CourseVersion(organisation_id=ctx.org_id, course_id=course.id, version_number=last + 1,
                            status="published", snapshot=build_snapshot(course, tree), changelog=changelog,
                            published_by=ctx.user_id, published_at=_now())
    ctx.db.add(version)
    await ctx.db.flush()
    course.current_version_id = version.id
    course.status = CourseStatus.PUBLISHED
    course.draft_version_number = version.version_number + 1
    await ctx.db.flush()
    await ctx.db.refresh(course)
    await ctx.audit("course.published", "course", course.id, version_number=version.version_number,
                    version_id=str(version.id), changelog=changelog)
    return course, version


async def list_versions(ctx: Ctx, course_id: uuid.UUID) -> list[s.VersionSummary]:
    course = await get_course(ctx, course_id)
    versions = list((await ctx.db.execute(select(CourseVersion).where(
        CourseVersion.course_id == course.id, CourseVersion.organisation_id == ctx.org_id)
        .order_by(CourseVersion.version_number.desc()))).scalars())
    user_ids = {v.published_by for v in versions if v.published_by}
    names = dict((await ctx.db.execute(select(User.id, User.full_name).where(User.id.in_(user_ids)))).all()) \
        if user_ids else {}
    return [_version_summary(v, names) for v in versions]


async def get_version(ctx: Ctx, course_id: uuid.UUID, number: int) -> CourseVersion:
    course = await get_course(ctx, course_id)
    v = await ctx.db.scalar(select(CourseVersion).where(
        CourseVersion.course_id == course.id, CourseVersion.organisation_id == ctx.org_id,
        CourseVersion.version_number == number))
    if v is None:
        raise NotFound("Version not found")
    return v


async def diff_versions(ctx: Ctx, course_id: uuid.UUID, from_n: int, to: str) -> dict[str, Any]:
    """Diff two published versions; ``to="draft"`` compares against the current authoring tree."""
    old = await get_version(ctx, course_id, from_n)
    if to == "draft":
        course = await get_course(ctx, course_id)
        new_snap = build_snapshot(course, await load_tree(ctx.db, ctx.org_id, course))
        to_label: Any = "draft"
    else:
        try:
            to_n = int(to)
        except ValueError as exc:
            raise BadRequest("'to' must be a version number or 'draft'") from exc
        new_snap = (await get_version(ctx, course_id, to_n)).snapshot
        to_label = to_n
    return {"from": from_n, "to": to_label, **diff_snapshots(old.snapshot or {}, new_snap)}


# ----------------------------------------------------------------------------- catalog


def _catalog_stmt(ctx: Ctx) -> Select[Any]:
    return (
        select(Course.id, Course.slug, CourseVersion.version_number, CourseVersion.published_at,
               CourseVersion.snapshot["course"].label("meta"), CourseVersion.snapshot["stats"].label("stats"))
        .join(CourseVersion, CourseVersion.id == Course.current_version_id)
        .where(Course.organisation_id == ctx.org_id, Course.deleted_at.is_(None),
               Course.status == CourseStatus.PUBLISHED)
    )


async def _enrolment_states(ctx: Ctx, course_ids: list[uuid.UUID]) -> dict[uuid.UUID, s.EnrolmentState]:
    if not course_ids or not ctx.principal.user:
        return {}
    rows = (await ctx.db.execute(select(Enrolment).where(
        Enrolment.organisation_id == ctx.org_id, Enrolment.user_id == ctx.user_id,
        Enrolment.course_id.in_(course_ids)))).scalars()
    return {e.course_id: s.EnrolmentState(id=e.id, status=e.status, progress_pct=e.progress_pct,
                                          due_date=e.due_date) for e in rows}


def _catalog_item(row: Any, enrol: s.EnrolmentState | None, cls: type[s.CatalogItem] = s.CatalogItem,
                  **extra: Any) -> Any:
    meta, stats = row.meta or {}, row.stats or {}
    fields = {k: meta.get(k) for k in ("subtitle", "category", "difficulty", "thumbnail_url")}
    return cls(id=row.id, slug=row.slug, title=meta.get("title", ""), description=meta.get("description") or "",
               duration_minutes=meta.get("duration_minutes") or 0, tags=meta.get("tags") or [],
               skills=meta.get("skills") or [], lesson_count=stats.get("lesson_count", 0),
               module_count=stats.get("module_count", 0), version_number=row.version_number,
               published_at=row.published_at, enrolment=enrol, **fields, **extra)


async def catalog(ctx: Ctx, params: PageParams, *, search: str | None, category: str | None,
                  difficulty: str | None, skill_id: uuid.UUID | None,
                  enrolled: bool | None) -> tuple[list[s.CatalogItem], int]:
    stmt = _catalog_stmt(ctx)
    meta = CourseVersion.snapshot["course"]
    if search:
        like = f"%{escape_like(search)}%"
        stmt = stmt.where(or_(meta["title"].astext.ilike(like, escape="\\"),
                              meta["subtitle"].astext.ilike(like, escape="\\"),
                              meta["description"].astext.ilike(like, escape="\\"),
                              meta["tags"].astext.ilike(like, escape="\\")))
    if category:
        stmt = stmt.where(meta["category"].astext == category)
    if difficulty:
        stmt = stmt.where(meta["difficulty"].astext == difficulty)
    if skill_id:
        stmt = stmt.where(meta["skills"].contains([{"id": str(skill_id)}]))
    if enrolled is not None and ctx.principal.user:
        mine = select(Enrolment.course_id).where(
            Enrolment.organisation_id == ctx.org_id, Enrolment.user_id == ctx.user_id,
            Enrolment.status != EnrolmentStatus.WITHDRAWN)
        stmt = stmt.where(Course.id.in_(mine) if enrolled else Course.id.not_in(mine))
    total = int(await ctx.db.scalar(select(func.count()).select_from(stmt.subquery())) or 0)
    rows = (await ctx.db.execute(stmt.order_by(CourseVersion.published_at.desc(), Course.id)
                                 .limit(params.page_size).offset(params.offset))).all()
    states = await _enrolment_states(ctx, [r.id for r in rows])
    return [_catalog_item(r, states.get(r.id)) for r in rows], total


async def catalog_detail(ctx: Ctx, course_id: uuid.UUID) -> s.CatalogDetail:
    row = (await ctx.db.execute(_catalog_stmt(ctx).where(Course.id == course_id))).first()
    if row is None:
        raise NotFound("Course not found")
    version = await ctx.db.scalar(select(CourseVersion.snapshot).where(CourseVersion.version_number ==
                                                                       row.version_number,
                                                                       CourseVersion.course_id == course_id))
    meta = row.meta or {}
    outline = [
        {"id": m["id"], "title": m["title"], "description": m.get("description"),
         "lessons": [{"id": lsn["id"], "title": lsn["title"], "lesson_type": lsn["lesson_type"],
                      "duration_minutes": lsn.get("duration_minutes", 0), "is_preview": lsn.get("is_preview", False),
                      "is_required": lsn.get("is_required", True)} for lsn in m.get("lessons", [])]}
        for m in (version or {}).get("modules", [])
    ]
    states = await _enrolment_states(ctx, [course_id])
    return _catalog_item(row, states.get(course_id), s.CatalogDetail,
                         learning_objectives=meta.get("learning_objectives") or [],
                         prerequisites=meta.get("prerequisites") or [],
                         target_audience=meta.get("target_audience"),
                         certificate_enabled=meta.get("certificate_enabled", True), outline=outline)


async def catalog_categories(ctx: Ctx) -> list[s.CategoryCount]:
    sub = _catalog_stmt(ctx).subquery()
    rows = (await ctx.db.execute(
        select(sub.c.meta["category"].astext.label("category"), func.count())
        .where(sub.c.meta["category"].astext.is_not(None)).group_by("category").order_by("category"))).all()
    return [s.CategoryCount(category=r[0], count=r[1]) for r in rows if r[0]]
