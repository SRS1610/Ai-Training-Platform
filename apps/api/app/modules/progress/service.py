"""Lesson progress, time tracking, streak activity and enrolment completion.

Completion rules
* Content lessons are completed by the learner (``POST /progress/lessons/{id}/complete``).
* Quiz / assignment / simulation lessons complete only through grading events (see ``events.py``).
* ``progress_pct`` = completed required lessons / required lessons of the *pinned* snapshot.
* Completing every required lesson completes the enrolment, computes ``final_score`` and emits
  ``course.completed``.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import structlog
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import Ctx
from app.core.errors import BadRequest, Forbidden, NotFound
from app.core.events import emit
from app.models.assessment import AssessmentAttempt, AttemptStatus
from app.models.assignment import Submission
from app.models.content import CourseVersion, Lesson
from app.models.identity import User
from app.models.learning import ActivityDay, Enrolment, EnrolmentStatus, LessonProgress
from app.models.simulation import SimulationSession, SimulationSessionStatus
from app.modules.courses.snapshot import (
    find_lesson,
    is_event_completed,
    linked_ids,
    locked_lesson_ids,
    required_lesson_ids,
)

log = structlog.get_logger(__name__)

MAX_HEARTBEAT_SECONDS = 120  # credited per heartbeat call at most


def now() -> datetime:
    return datetime.now(UTC)


def local_today(tz_name: str | None) -> date:
    try:
        tz = ZoneInfo(tz_name or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        tz = ZoneInfo("UTC")
    return datetime.now(tz).date()


# ----------------------------------------------------------------------------- loading


async def load_snapshot(db: AsyncSession, enrolment: Enrolment) -> dict[str, Any]:
    snap = await db.scalar(
        select(CourseVersion.snapshot).where(CourseVersion.id == enrolment.course_version_id)
    )
    return snap or {}


async def progress_rows(db: AsyncSession, enrolment_id: uuid.UUID) -> dict[str, LessonProgress]:
    rows = (
        await db.execute(select(LessonProgress).where(LessonProgress.enrolment_id == enrolment_id))
    ).scalars()
    return {str(r.lesson_id): r for r in rows}


def completed_set(rows: dict[str, LessonProgress]) -> set[str]:
    return {lid for lid, r in rows.items() if r.status == "completed"}


async def get_my_enrolment(ctx: Ctx, course_id: uuid.UUID, *, for_update: bool = False) -> Enrolment:
    stmt = select(Enrolment).where(
        Enrolment.organisation_id == ctx.org_id,
        Enrolment.user_id == ctx.user_id,
        Enrolment.course_id == course_id,
    )
    if for_update:
        stmt = stmt.with_for_update()
    enrolment = await ctx.db.scalar(stmt)
    if enrolment is None or enrolment.status == EnrolmentStatus.WITHDRAWN:
        raise NotFound("You are not enrolled in this course", code="not_enrolled")
    return enrolment


async def _resolve_lesson(ctx: Ctx, lesson_id: uuid.UUID) -> tuple[Enrolment, dict[str, Any], dict[str, Any]]:
    """Find the caller's enrolment containing ``lesson_id`` in its pinned snapshot."""
    if not ctx.can("learning.access"):
        raise Forbidden("Learner access is required", details={"required": ["learning.access"]})
    course_id = await ctx.db.scalar(
        select(Lesson.course_id).where(Lesson.id == lesson_id, Lesson.organisation_id == ctx.org_id)
    )
    if course_id is None:
        raise NotFound("Lesson not found")
    enrolment = await get_my_enrolment(ctx, course_id, for_update=True)
    snapshot = await load_snapshot(ctx.db, enrolment)
    found = find_lesson(snapshot, str(lesson_id))
    if found is None:
        raise NotFound("This lesson is not part of your course version", code="lesson_not_in_version")
    return enrolment, snapshot, found[1]


# ----------------------------------------------------------------------------- activity days


async def record_activity(
    db: AsyncSession,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    seconds: int = 0,
    events: int = 1,
    tz_name: str | None = None,
) -> None:
    """Upsert today's ActivityDay row (streaks, heatmap, engagement analytics)."""
    if tz_name is None:
        tz_name = await db.scalar(select(User.timezone).where(User.id == user_id))
    day = local_today(tz_name)
    stmt = insert(ActivityDay).values(
        organisation_id=org_id, user_id=user_id, day=day, events=events, seconds=seconds
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=["organisation_id", "user_id", "day"],
        set_={"events": ActivityDay.events + events, "seconds": ActivityDay.seconds + seconds},
    )
    await db.execute(stmt)


# ----------------------------------------------------------------------------- completion


async def compute_final_score(
    db: AsyncSession, enrolment: Enrolment, snapshot: dict[str, Any]
) -> float | None:
    """Mean of the learner's best score on each graded component linked from the pinned snapshot."""
    ids = linked_ids(snapshot)
    scores: list[float] = []
    if ids["assessment_id"]:
        rows = await db.execute(
            select(AssessmentAttempt.assessment_id, func.max(AssessmentAttempt.percentage))
            .where(
                AssessmentAttempt.organisation_id == enrolment.organisation_id,
                AssessmentAttempt.user_id == enrolment.user_id,
                AssessmentAttempt.assessment_id.in_([uuid.UUID(i) for i in ids["assessment_id"]]),
                AssessmentAttempt.status == AttemptStatus.GRADED,
                AssessmentAttempt.percentage.is_not(None),
            )
            .group_by(AssessmentAttempt.assessment_id)
        )
        scores.extend(float(r[1]) for r in rows.all() if r[1] is not None)
    if ids["assignment_id"]:
        rows = await db.execute(
            select(Submission.assignment_id, func.max(Submission.final_score))
            .where(
                Submission.organisation_id == enrolment.organisation_id,
                Submission.user_id == enrolment.user_id,
                Submission.assignment_id.in_([uuid.UUID(i) for i in ids["assignment_id"]]),
                Submission.final_score.is_not(None),
            )
            .group_by(Submission.assignment_id)
        )
        scores.extend(float(r[1]) for r in rows.all() if r[1] is not None)
    if ids["simulation_id"]:
        rows = await db.execute(
            select(SimulationSession.simulation_id, func.max(SimulationSession.total_score))
            .where(
                SimulationSession.organisation_id == enrolment.organisation_id,
                SimulationSession.user_id == enrolment.user_id,
                SimulationSession.simulation_id.in_([uuid.UUID(i) for i in ids["simulation_id"]]),
                SimulationSession.status == SimulationSessionStatus.COMPLETED,
                SimulationSession.total_score.is_not(None),
            )
            .group_by(SimulationSession.simulation_id)
        )
        scores.extend(float(r[1]) for r in rows.all() if r[1] is not None)
    if not scores:
        return None
    return round(sum(scores) / len(scores), 2)


async def recompute(
    db: AsyncSession,
    enrolment: Enrolment,
    snapshot: dict[str, Any],
    rows: dict[str, LessonProgress] | None = None,
) -> bool:
    """Refresh progress_pct / status. Returns True when this call completed the enrolment."""
    if rows is None:
        rows = await progress_rows(db, enrolment.id)
    done = completed_set(rows)
    required = required_lesson_ids(snapshot)
    completed_required = sum(1 for lid in required if lid in done)
    enrolment.progress_pct = round(100.0 * completed_required / len(required), 1) if required else 0.0
    if enrolment.status == EnrolmentStatus.WITHDRAWN:
        return False
    if enrolment.status == EnrolmentStatus.COMPLETED:
        enrolment.final_score = await compute_final_score(db, enrolment, snapshot)  # later regrades count
        return False
    if required and completed_required == len(required):
        enrolment.status = EnrolmentStatus.COMPLETED
        enrolment.completed_at = now()
        enrolment.progress_pct = 100.0
        enrolment.started_at = enrolment.started_at or enrolment.completed_at
        enrolment.final_score = await compute_final_score(db, enrolment, snapshot)
        await db.flush()
        await emit(
            db,
            "course.completed",
            {
                "enrolment_id": enrolment.id,
                "course_id": enrolment.course_id,
                "course_version_id": enrolment.course_version_id,
                "final_score": enrolment.final_score,
                "organisation_id": enrolment.organisation_id,
                "user_id": enrolment.user_id,
            },
        )
        return True
    if rows:
        if enrolment.status == EnrolmentStatus.NOT_STARTED:
            enrolment.status = EnrolmentStatus.IN_PROGRESS
            enrolment.started_at = enrolment.started_at or now()
    return False


async def _ensure_progress(
    db: AsyncSession, enrolment: Enrolment, lesson_id: str, rows: dict[str, LessonProgress]
) -> LessonProgress:
    lp = rows.get(lesson_id)
    if lp is None:
        lp = LessonProgress(
            organisation_id=enrolment.organisation_id,
            enrolment_id=enrolment.id,
            user_id=enrolment.user_id,
            lesson_id=uuid.UUID(lesson_id),
            status="in_progress",
            time_spent_seconds=0,
            last_position={},
        )
        db.add(lp)
        rows[lesson_id] = lp
        await db.flush()
    return lp


async def mark_lesson_complete(
    db: AsyncSession, enrolment: Enrolment, snapshot: dict[str, Any], lesson_id: str, *, source: str
) -> bool:
    """Mark a lesson complete (idempotent), emit ``lesson.completed`` and recompute the enrolment.

    Returns True if the lesson was newly completed."""
    rows = await progress_rows(db, enrolment.id)
    lp = await _ensure_progress(db, enrolment, lesson_id, rows)
    newly = lp.status != "completed"
    if newly:
        lp.status = "completed"
        lp.completed_at = now()
        enrolment.last_accessed_at = now()
        enrolment.last_lesson_id = uuid.UUID(lesson_id)
        await db.flush()
        await emit(
            db,
            "lesson.completed",
            {
                "enrolment_id": enrolment.id,
                "course_id": enrolment.course_id,
                "lesson_id": uuid.UUID(lesson_id),
                "organisation_id": enrolment.organisation_id,
                "user_id": enrolment.user_id,
                "source": source,
            },
        )
    await recompute(db, enrolment, snapshot, rows)
    await db.flush()
    return newly


# ----------------------------------------------------------------------------- learner actions


def _assert_unlocked(snapshot: dict[str, Any], rows: dict[str, LessonProgress], lesson_id: str) -> None:
    if lesson_id in locked_lesson_ids(snapshot, completed_set(rows)):
        raise Forbidden("Complete the earlier lessons first", code="lesson_locked")


async def start_lesson(ctx: Ctx, lesson_id: uuid.UUID) -> tuple[Enrolment, LessonProgress]:
    enrolment, snapshot, lesson = await _resolve_lesson(ctx, lesson_id)
    rows = await progress_rows(ctx.db, enrolment.id)
    _assert_unlocked(snapshot, rows, lesson["id"])
    lp = await _ensure_progress(ctx.db, enrolment, lesson["id"], rows)
    enrolment.last_accessed_at = now()
    enrolment.last_lesson_id = lesson_id
    await recompute(ctx.db, enrolment, snapshot, rows)
    await record_activity(ctx.db, ctx.org_id, ctx.user_id, events=1, tz_name=ctx.user.timezone)
    await ctx.db.flush()
    return enrolment, lp


async def heartbeat(
    ctx: Ctx, lesson_id: uuid.UUID, seconds: int, position: dict[str, Any] | None
) -> tuple[Enrolment, LessonProgress, int]:
    """Credit learning time (capped per call) and remember the playback / reading position."""
    enrolment, snapshot, lesson = await _resolve_lesson(ctx, lesson_id)
    rows = await progress_rows(ctx.db, enrolment.id)
    _assert_unlocked(snapshot, rows, lesson["id"])
    credited = max(0, min(int(seconds), MAX_HEARTBEAT_SECONDS))
    lp = await _ensure_progress(ctx.db, enrolment, lesson["id"], rows)
    lp.time_spent_seconds = (lp.time_spent_seconds or 0) + credited
    if position is not None:
        lp.last_position = position
    enrolment.time_spent_seconds = (enrolment.time_spent_seconds or 0) + credited
    enrolment.last_accessed_at = now()
    enrolment.last_lesson_id = lesson_id
    await recompute(ctx.db, enrolment, snapshot, rows)
    await record_activity(
        ctx.db, ctx.org_id, ctx.user_id, seconds=credited, events=1, tz_name=ctx.user.timezone
    )
    await ctx.db.flush()
    return enrolment, lp, credited


async def complete_lesson(ctx: Ctx, lesson_id: uuid.UUID) -> tuple[Enrolment, LessonProgress]:
    enrolment, snapshot, lesson = await _resolve_lesson(ctx, lesson_id)
    if is_event_completed(lesson):
        raise BadRequest(
            "This lesson completes automatically when its quiz, assignment or simulation is passed",
            code="completion_by_grading",
        )
    rows = await progress_rows(ctx.db, enrolment.id)
    _assert_unlocked(snapshot, rows, lesson["id"])
    await mark_lesson_complete(ctx.db, enrolment, snapshot, lesson["id"], source="learner")
    await record_activity(ctx.db, ctx.org_id, ctx.user_id, events=1, tz_name=ctx.user.timezone)
    await ctx.db.flush()
    rows = await progress_rows(ctx.db, enrolment.id)
    return enrolment, rows[lesson["id"]]


# ----------------------------------------------------------------------------- event-driven completion


def _same(a: Any, b: Any) -> bool:
    return a is not None and b is not None and str(a) == str(b)


async def complete_linked_lessons(
    db: AsyncSession, payload: dict[str, Any], *, field: str, item_key: str
) -> int:
    """Complete every lesson linked to the passed item across the learner's enrolments.

    ``field`` is the snapshot lesson field (``assessment_id`` …), ``item_key`` the payload key."""
    item_id = payload.get(item_key)
    org_id, user_id = payload.get("organisation_id"), payload.get("user_id")
    if not item_id or not org_id or not user_id:
        return 0
    stmt = select(Enrolment).where(
        Enrolment.organisation_id == org_id,
        Enrolment.user_id == user_id,
        Enrolment.status != EnrolmentStatus.WITHDRAWN,
    )
    if payload.get("course_id"):
        stmt = stmt.where(Enrolment.course_id == payload["course_id"])
    completed = 0
    for enrolment in (await db.execute(stmt.with_for_update())).scalars().all():
        snapshot = await load_snapshot(db, enrolment)
        targets = [
            lesson["id"]
            for module in snapshot.get("modules") or []
            for lesson in module.get("lessons") or []
            if is_event_completed(lesson) and _same(lesson.get(field), item_id)
        ]
        if not targets:
            continue
        if not payload.get("passed"):
            # Not passed: still refresh the final score of completed enrolments (best-score semantics).
            await recompute(db, enrolment, snapshot)
            continue
        for lid in targets:
            if await mark_lesson_complete(db, enrolment, snapshot, lid, source=item_key.removesuffix("_id")):
                completed += 1
    await db.flush()
    log.info("progress.linked_completion", item=item_key, item_id=str(item_id), completed=completed)
    return completed
