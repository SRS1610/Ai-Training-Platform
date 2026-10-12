"""Global search across courses, lessons, assignments, simulations, knowledge documents and users.

Ranking combines ILIKE matches (prefix > substring) with ``pg_trgm`` similarity when the extension is installed,
so typos still match. Visibility follows permissions: drafts need ``courses.edit`` (or the matching manage
permission), users need ``users.view`` and knowledge documents need ``knowledge.manage``/``ai.manage``. Semantic
results from the AI gateway (``app.modules.ai.gateway.semantic_search``) are merged in as type ``knowledge``.
"""

from __future__ import annotations

import inspect
from dataclasses import dataclass
from typing import Any

import structlog
from sqlalchemy import Float, String, and_, case, cast, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import Ctx
from app.models.ai import KnowledgeDocument
from app.models.assignment import Assignment
from app.models.content import Course, CourseStatus, Lesson
from app.models.identity import User
from app.models.simulation import Simulation
from app.models.tenancy import OrganisationUser

log = structlog.get_logger(__name__)

TYPES = ("courses", "lessons", "assignments", "simulations", "documents", "users", "knowledge")
LABELS = {
    "courses": "Courses",
    "lessons": "Lessons",
    "assignments": "Assignments",
    "simulations": "Simulations",
    "documents": "Knowledge base",
    "users": "People",
    "knowledge": "From your knowledge base",
}
TRGM_THRESHOLD = 0.2
_trgm_available: bool | None = None


async def trgm_available(db: AsyncSession) -> bool:
    global _trgm_available
    if _trgm_available is None:
        _trgm_available = bool(await db.scalar(text("SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'")))
    return _trgm_available


def escape_like(q: str) -> str:
    return q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


@dataclass
class Matcher:
    q: str
    trgm: bool

    @property
    def contains(self) -> str:
        return f"%{escape_like(self.q)}%"

    @property
    def prefix(self) -> str:
        return f"{escape_like(self.q)}%"

    def where(self, primary: Any, *secondary: Any) -> Any:
        conds = [primary.ilike(self.contains, escape="\\")]
        conds += [cast(c, String).ilike(self.contains, escape="\\") for c in secondary]
        if self.trgm:
            conds.append(func.word_similarity(self.q, primary) > TRGM_THRESHOLD + 0.2)
            conds.append(func.similarity(primary, self.q) > TRGM_THRESHOLD)
        return or_(*conds)

    def score(self, primary: Any, *secondary: Any) -> Any:
        parts = [
            case((func.lower(primary) == self.q.lower(), 1.0), else_=0.0),
            case((primary.ilike(self.prefix, escape="\\"), 0.6), else_=0.0),
            case((primary.ilike(self.contains, escape="\\"), 0.4), else_=0.0),
        ]
        parts += [
            case((cast(c, String).ilike(self.contains, escape="\\"), 0.15), else_=0.0) for c in secondary
        ]
        if self.trgm:
            parts.append(
                func.greatest(func.similarity(primary, self.q), func.word_similarity(self.q, primary))
            )
        total = parts[0]
        for p in parts[1:]:
            total = total + p
        return cast(total, Float).label("score")


def _snippet(text_value: str | None, q: str, width: int = 140) -> str | None:
    if not text_value:
        return None
    t = " ".join(str(text_value).split())
    idx = t.lower().find(q.lower())
    if idx < 0:
        return t[:width] + ("…" if len(t) > width else "")
    start = max(0, idx - width // 3)
    end = min(len(t), start + width)
    return ("…" if start else "") + t[start:end] + ("…" if end < len(t) else "")


def _can_see_drafts(ctx: Ctx, manage_perm: str) -> bool:
    return ctx.can_any("courses.edit", manage_perm)


async def _courses(ctx: Ctx, m: Matcher, limit: int) -> list[dict[str, Any]]:
    editor = _can_see_drafts(ctx, "courses.edit")
    conds = [
        Course.organisation_id == ctx.org_id,
        Course.deleted_at.is_(None),
        m.where(Course.title, Course.description, Course.category, Course.tags),
    ]
    if not editor:
        conds.append(Course.status == CourseStatus.PUBLISHED)
    score = m.score(Course.title, Course.description, Course.tags)
    rows = (
        await ctx.db.execute(
            select(Course, score).where(*conds).order_by(text("score DESC"), Course.title).limit(limit)
        )
    ).all()
    return [
        {
            "id": c.id,
            "type": "course",
            "title": c.title,
            "subtitle": c.category or c.difficulty,
            "snippet": _snippet(c.subtitle or c.description, m.q),
            "status": c.status,
            "link": f"/app/instructor/courses/{c.id}"
            if editor and c.status != CourseStatus.PUBLISHED
            else f"/app/learn/{c.id}",
            "score": round(float(s), 4),
            "meta": {"difficulty": c.difficulty},
        }
        for c, s in rows
    ]


async def _lessons(ctx: Ctx, m: Matcher, limit: int) -> list[dict[str, Any]]:
    editor = _can_see_drafts(ctx, "lessons.manage")
    conds = [
        Lesson.organisation_id == ctx.org_id,
        Lesson.deleted_at.is_(None),
        Course.deleted_at.is_(None),
        m.where(Lesson.title, Lesson.summary),
    ]
    if not editor:
        conds.append(Course.status == CourseStatus.PUBLISHED)
    score = m.score(Lesson.title, Lesson.summary)
    rows = (
        await ctx.db.execute(
            select(Lesson, Course.title, Course.status, score)
            .join(Course, Course.id == Lesson.course_id)
            .where(*conds)
            .order_by(text("score DESC"), Lesson.title)
            .limit(limit)
        )
    ).all()
    return [
        {
            "id": lesson.id,
            "type": "lesson",
            "title": lesson.title,
            "subtitle": course_title,
            "snippet": _snippet(lesson.summary, m.q),
            "status": course_status,
            "link": f"/app/learn/{lesson.course_id}/lesson/{lesson.id}",
            "score": round(float(s), 4),
            "meta": {"course_id": str(lesson.course_id), "lesson_type": lesson.lesson_type},
        }
        for lesson, course_title, course_status, s in rows
    ]


async def _assignments(ctx: Ctx, m: Matcher, limit: int) -> list[dict[str, Any]]:
    editor = _can_see_drafts(ctx, "assignments.manage")
    conds = [
        Assignment.organisation_id == ctx.org_id,
        Assignment.deleted_at.is_(None),
        m.where(Assignment.title, Assignment.scenario, Assignment.objective),
    ]
    if not editor:
        conds.append(Assignment.status == "published")
    score = m.score(Assignment.title, Assignment.objective)
    rows = (
        await ctx.db.execute(
            select(Assignment, score)
            .where(*conds)
            .order_by(text("score DESC"), Assignment.title)
            .limit(limit)
        )
    ).all()
    return [
        {
            "id": a.id,
            "type": "assignment",
            "title": a.title,
            "subtitle": None,
            "snippet": _snippet(a.objective or a.scenario, m.q),
            "status": a.status,
            "link": f"/app/instructor/assignments/{a.id}"
            if editor and a.status != "published"
            else f"/app/assignments/{a.id}",
            "score": round(float(s), 4),
            "meta": {"course_id": str(a.course_id) if a.course_id else None},
        }
        for a, s in rows
    ]


async def _simulations(ctx: Ctx, m: Matcher, limit: int) -> list[dict[str, Any]]:
    editor = _can_see_drafts(ctx, "simulations.manage")
    conds = [
        Simulation.organisation_id == ctx.org_id,
        Simulation.deleted_at.is_(None),
        m.where(Simulation.title, Simulation.description, Simulation.industry),
    ]
    if not editor:
        conds.append(Simulation.status == "published")
    score = m.score(Simulation.title, Simulation.description)
    rows = (
        await ctx.db.execute(
            select(Simulation, score)
            .where(*conds)
            .order_by(text("score DESC"), Simulation.title)
            .limit(limit)
        )
    ).all()
    return [
        {
            "id": sim.id,
            "type": "simulation",
            "title": sim.title,
            "subtitle": sim.industry,
            "snippet": _snippet(sim.description, m.q),
            "status": sim.status,
            "link": f"/app/instructor/simulations/{sim.id}/builder"
            if editor and sim.status != "published"
            else f"/app/simulations/{sim.id}",
            "score": round(float(s), 4),
            "meta": {"difficulty": sim.difficulty, "environment_type": sim.environment_type},
        }
        for sim, s in rows
    ]


async def _documents(ctx: Ctx, m: Matcher, limit: int) -> list[dict[str, Any]]:
    conds = [
        KnowledgeDocument.organisation_id == ctx.org_id,
        KnowledgeDocument.deleted_at.is_(None),
        m.where(KnowledgeDocument.title, KnowledgeDocument.category),
    ]
    score = m.score(KnowledgeDocument.title, KnowledgeDocument.category)
    rows = (
        await ctx.db.execute(
            select(KnowledgeDocument, score)
            .where(*conds)
            .order_by(text("score DESC"), KnowledgeDocument.title)
            .limit(limit)
        )
    ).all()
    return [
        {
            "id": d.id,
            "type": "document",
            "title": d.title,
            "subtitle": d.category or d.source_type,
            "snippet": None,
            "status": d.status,
            "link": f"/app/instructor/knowledge?document={d.id}",
            "score": round(float(s), 4),
            "meta": {"approved": d.approved, "source_type": d.source_type},
        }
        for d, s in rows
    ]


async def _users(ctx: Ctx, m: Matcher, limit: int) -> list[dict[str, Any]]:
    conds = [
        OrganisationUser.organisation_id == ctx.org_id,
        User.deleted_at.is_(None),
        or_(
            m.where(User.full_name),
            User.email.ilike(m.contains, escape="\\"),
            OrganisationUser.job_title.ilike(m.contains, escape="\\"),
        ),
    ]
    score = m.score(User.full_name, User.email)
    rows = (
        await ctx.db.execute(
            select(User, OrganisationUser.job_title, OrganisationUser.status, score)
            .join(OrganisationUser, and_(OrganisationUser.user_id == User.id))
            .where(*conds)
            .order_by(text("score DESC"), User.full_name)
            .limit(limit)
        )
    ).all()
    return [
        {
            "id": u.id,
            "type": "user",
            "title": u.full_name,
            "subtitle": job_title or u.email,
            "snippet": u.email,
            "status": status,
            "link": f"/app/admin/users/{u.id}",
            "score": round(float(s), 4),
            "meta": {"avatar_url": u.avatar_url},
        }
        for u, job_title, status, s in rows
    ]


def _field(item: Any, *names: str) -> Any:
    for n in names:
        value = item.get(n) if isinstance(item, dict) else getattr(item, n, None)
        if value is not None:
            return value
    return None


async def _semantic(ctx: Ctx, q: str, limit: int) -> list[dict[str, Any]]:
    try:
        from app.modules.ai import gateway as ai_gateway  # built concurrently; optional
    except ImportError:
        return []
    fn = getattr(ai_gateway, "semantic_search", None)
    if fn is None:
        return []
    try:
        async with ctx.db.begin_nested():
            result = fn(ctx.db, organisation_id=ctx.org_id, query=q, k=limit)
            hits = await result if inspect.isawaitable(result) else result
    except Exception:
        log.warning("search.semantic_failed", exc_info=True)
        return []
    out = []
    for hit in hits or []:
        doc_id = _field(hit, "document_id", "id")
        course_id = _field(hit, "course_id")
        content = _field(hit, "content", "snippet", "text")
        out.append(
            {
                "id": doc_id,
                "type": "knowledge",
                "title": _field(hit, "title", "document_title", "heading") or "Knowledge base",
                "subtitle": _field(hit, "heading"),
                "snippet": _snippet(content, q, 220),
                "status": None,
                "link": f"/app/tutor?course={course_id}" if course_id else "/app/tutor",
                "score": round(float(_field(hit, "score", "similarity") or 0.0), 4),
                "meta": {
                    "chunk_id": str(_field(hit, "chunk_id")) if _field(hit, "chunk_id") else None,
                    "course_id": str(course_id) if course_id else None,
                },
            }
        )
    return out


def allowed_types(ctx: Ctx) -> list[str]:
    allowed = []
    if ctx.can_any("courses.view", "learning.access", "courses.edit"):
        allowed += ["courses", "lessons", "assignments", "simulations"]
    if ctx.can_any("knowledge.manage", "ai.manage"):
        allowed.append("documents")
    if ctx.can("users.view"):
        allowed.append("users")
    if ctx.can_any("learning.access", "knowledge.manage"):
        allowed.append("knowledge")
    return allowed


async def search(ctx: Ctx, q: str, types: list[str] | None, limit: int, semantic: bool) -> dict[str, Any]:
    q = " ".join(q.split())[:200]
    allowed = allowed_types(ctx)
    wanted = [t for t in (types or TYPES) if t in allowed]
    m = Matcher(q=q, trgm=await trgm_available(ctx.db))
    runners = {
        "courses": _courses,
        "lessons": _lessons,
        "assignments": _assignments,
        "simulations": _simulations,
        "documents": _documents,
        "users": _users,
    }
    groups = []
    for t in wanted:
        if t == "knowledge":
            items = await _semantic(ctx, q, limit) if semantic else []
        else:
            items = await runners[t](ctx, m, limit)
        if items:
            groups.append({"type": t, "label": LABELS[t], "items": items})
    return {
        "query": q,
        "total": sum(len(g["items"]) for g in groups),
        "groups": groups,
        "types_searched": wanted,
        "fuzzy": m.trgm,
    }
