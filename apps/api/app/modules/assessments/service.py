"""Assessment engine services: banks, questions, assessments, attempts, grading and statistics.

Public contract (called by the AI grading worker): :func:`finalize_attempt`.
"""

from __future__ import annotations

import json
import secrets
import uuid
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from typing import Any

import structlog
from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import array
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import Ctx
from app.core.errors import BadRequest, Conflict, Forbidden, NotFound, Unprocessable
from app.core.events import emit
from app.models.assessment import (
    Assessment,
    AssessmentAttempt,
    AssessmentItem,
    AttemptAnswer,
    AttemptStatus,
    GradingMode,
    Question,
    QuestionBank,
)
from app.models.assignment import Grade, GradeSource, Rubric
from app.models.content import Course
from app.models.identity import User
from app.models.learning import Enrolment, EnrolmentStatus
from app.models.simulation import SimulationSession
from app.modules.assessments import grading
from app.modules.assessments.schemas import (
    AssessmentCreate,
    AssessmentUpdate,
    ItemIn,
    QuestionIn,
    QuestionUpdate,
)
from app.modules.assessments.validation import validate_question
from app.workers import enqueue

log = structlog.get_logger(__name__)

AUTOSAVE_GRACE = timedelta(seconds=5)  # network latency allowance for autosave at the deadline
SUBMIT_GRACE = timedelta(seconds=60)  # submissions later than expiry + grace are flagged late
MAX_RESPONSE_BYTES = 100_000
MAX_INTEGRITY_EVENTS = 1000
STAFF_PERMS = ("assessments.manage", "submissions.review")
AI_MODES = {GradingMode.AI_ASSISTED.value, GradingMode.AI_RECOMMEND_HUMAN_FINAL.value}


def utcnow() -> datetime:
    return datetime.now(UTC)


# ============================================================================= loaders


async def _course_in_org(ctx: Ctx, course_id: uuid.UUID | None) -> None:
    if course_id is None:
        return
    found = await ctx.db.scalar(
        select(Course.id).where(
            Course.id == course_id, Course.organisation_id == ctx.org_id, Course.deleted_at.is_(None)
        )
    )
    if not found:
        raise NotFound("Course not found")


async def get_bank(ctx: Ctx, bank_id: uuid.UUID) -> QuestionBank:
    bank = await ctx.db.scalar(
        select(QuestionBank).where(
            QuestionBank.id == bank_id,
            QuestionBank.organisation_id == ctx.org_id,
            QuestionBank.deleted_at.is_(None),
        )
    )
    if not bank:
        raise NotFound("Question bank not found")
    return bank


async def get_question(ctx: Ctx, question_id: uuid.UUID) -> Question:
    q = await ctx.db.scalar(
        select(Question).where(
            Question.id == question_id, Question.organisation_id == ctx.org_id, Question.deleted_at.is_(None)
        )
    )
    if not q:
        raise NotFound("Question not found")
    return q


async def get_assessment(ctx: Ctx, assessment_id: uuid.UUID) -> Assessment:
    a = await ctx.db.scalar(
        select(Assessment).where(
            Assessment.id == assessment_id,
            Assessment.organisation_id == ctx.org_id,
            Assessment.deleted_at.is_(None),
        )
    )
    if not a:
        raise NotFound("Assessment not found")
    return a


async def get_items(db: AsyncSession, assessment_id: uuid.UUID) -> list[AssessmentItem]:
    return list(
        (
            await db.execute(
                select(AssessmentItem)
                .where(AssessmentItem.assessment_id == assessment_id)
                .order_by(AssessmentItem.position)
            )
        ).scalars()
    )


async def get_attempt(ctx: Ctx, attempt_id: uuid.UUID) -> AssessmentAttempt:
    att = await ctx.db.scalar(
        select(AssessmentAttempt).where(
            AssessmentAttempt.id == attempt_id, AssessmentAttempt.organisation_id == ctx.org_id
        )
    )
    if not att:
        raise NotFound("Attempt not found")
    return att


async def _answers(db: AsyncSession, attempt_id: uuid.UUID) -> dict[str, AttemptAnswer]:
    rows = (await db.execute(select(AttemptAnswer).where(AttemptAnswer.attempt_id == attempt_id))).scalars()
    return {str(r.question_id): r for r in rows}


# ============================================================================= banks


async def list_banks(ctx: Ctx, course_id: uuid.UUID | None, q: str | None):  # noqa: ANN201
    count_sq = (
        select(func.count())
        .where(Question.bank_id == QuestionBank.id, Question.deleted_at.is_(None))
        .correlate(QuestionBank)
        .scalar_subquery()
    )
    stmt = (
        select(QuestionBank, count_sq.label("n"))
        .where(QuestionBank.organisation_id == ctx.org_id, QuestionBank.deleted_at.is_(None))
        .order_by(QuestionBank.created_at.desc())
    )
    if course_id:
        stmt = stmt.where(QuestionBank.course_id == course_id)
    if q:
        stmt = stmt.where(QuestionBank.title.ilike(f"%{q}%"))
    return stmt


async def bank_question_count(db: AsyncSession, bank_id: uuid.UUID) -> int:
    return int(
        await db.scalar(
            select(func.count())
            .select_from(Question)
            .where(Question.bank_id == bank_id, Question.deleted_at.is_(None))
        )
        or 0
    )


async def create_bank(
    ctx: Ctx, title: str, description: str | None, course_id: uuid.UUID | None
) -> QuestionBank:
    await _course_in_org(ctx, course_id)
    bank = QuestionBank(
        organisation_id=ctx.org_id,
        title=title,
        description=description,
        course_id=course_id,
        created_by=ctx.principal.user_id,
    )
    ctx.db.add(bank)
    await ctx.db.flush()
    await ctx.audit("question_bank.created", "question_bank", bank.id, title=title)
    return bank


async def update_bank(ctx: Ctx, bank: QuestionBank, changes: dict[str, Any]) -> QuestionBank:
    if "course_id" in changes:
        await _course_in_org(ctx, changes["course_id"])
    for k, v in changes.items():
        setattr(bank, k, v)
    await ctx.db.flush()
    await ctx.audit("question_bank.updated", "question_bank", bank.id, fields=sorted(changes))
    await ctx.db.refresh(bank)
    return bank


async def delete_bank(ctx: Ctx, bank: QuestionBank) -> None:
    bank.deleted_at = utcnow()
    await ctx.audit("question_bank.deleted", "question_bank", bank.id)


async def export_bank(ctx: Ctx, bank: QuestionBank) -> dict[str, Any]:
    rows = (
        await ctx.db.execute(
            select(Question)
            .where(
                Question.bank_id == bank.id,
                Question.organisation_id == ctx.org_id,
                Question.deleted_at.is_(None),
            )
            .order_by(Question.created_at)
        )
    ).scalars()
    questions = [
        {
            "question_type": q.question_type,
            "prompt": q.prompt,
            "options": q.options,
            "answer_key": q.answer_key,
            "explanation": q.explanation,
            "points": q.points,
            "negative_points": q.negative_points,
            "difficulty": q.difficulty,
            "tags": q.tags,
            "status": q.status,
        }
        for q in rows
    ]
    await ctx.audit("question_bank.exported", "question_bank", bank.id, count=len(questions))
    return {
        "format": "praxis.question_bank.v1",
        "bank": {"title": bank.title, "description": bank.description},
        "questions": questions,
    }


# ============================================================================= questions


async def _check_question_refs(ctx: Ctx, bank_id: uuid.UUID | None, rubric_id: uuid.UUID | None) -> None:
    if bank_id:
        await get_bank(ctx, bank_id)
    if rubric_id:
        ok = await ctx.db.scalar(
            select(Rubric.id).where(
                Rubric.id == rubric_id, Rubric.organisation_id == ctx.org_id, Rubric.deleted_at.is_(None)
            )
        )
        if not ok:
            raise NotFound("Rubric not found")


def _validate_or_raise(data: dict[str, Any], index: int | None = None) -> None:
    errors = validate_question(
        data["question_type"],
        data.get("options"),
        data.get("answer_key"),
        points=float(data.get("points", 1.0)),
        negative_points=float(data.get("negative_points", 0.0)),
    )
    if errors:
        details: dict[str, Any] = {"errors": errors}
        if index is not None:
            details["index"] = index
        raise Unprocessable("Question is invalid for its type", details=details, code="invalid_question")


def _question_from(ctx: Ctx, data: QuestionIn, bank_id: uuid.UUID | None) -> Question:
    return Question(
        organisation_id=ctx.org_id,
        bank_id=bank_id,
        question_type=data.question_type,
        prompt=data.prompt,
        options=data.options,
        answer_key=data.answer_key,
        explanation=data.explanation,
        points=data.points,
        negative_points=data.negative_points,
        difficulty=data.difficulty,
        tags=list(data.tags),
        skill_ids=[str(s) for s in data.skill_ids],
        rubric_id=data.rubric_id,
        status=data.status,
        created_by=ctx.principal.user_id,
    )


async def create_question(ctx: Ctx, data: QuestionIn) -> Question:
    _validate_or_raise(data.model_dump())
    await _check_question_refs(ctx, data.bank_id, data.rubric_id)
    q = _question_from(ctx, data, data.bank_id)
    ctx.db.add(q)
    await ctx.db.flush()
    await ctx.audit("question.created", "question", q.id, type=q.question_type)
    return q


async def update_question(ctx: Ctx, q: Question, data: QuestionUpdate) -> Question:
    changes = data.model_dump(exclude_unset=True)
    merged = {
        "question_type": q.question_type,
        "options": q.options,
        "answer_key": q.answer_key,
        "points": q.points,
        "negative_points": q.negative_points,
    }
    merged.update({k: v for k, v in changes.items() if k in merged and v is not None})
    _validate_or_raise(merged)
    await _check_question_refs(ctx, changes.get("bank_id"), changes.get("rubric_id"))
    content_fields = {"question_type", "prompt", "options", "answer_key", "points", "negative_points"}
    for k, v in changes.items():
        if v is None and k in {
            "question_type",
            "prompt",
            "options",
            "answer_key",
            "points",
            "negative_points",
            "difficulty",
            "tags",
            "skill_ids",
            "status",
        }:
            continue
        if k == "skill_ids":
            v = [str(s) for s in v]
        setattr(q, k, v)
    if content_fields & set(changes):
        q.version += 1
    await ctx.db.flush()
    await ctx.audit("question.updated", "question", q.id, fields=sorted(changes), version=q.version)
    await ctx.db.refresh(q)
    return q


async def delete_question(ctx: Ctx, q: Question) -> None:
    q.deleted_at = utcnow()
    await ctx.audit("question.deleted", "question", q.id)


async def import_questions(ctx: Ctx, bank: QuestionBank, questions: list[QuestionIn]) -> list[Question]:
    problems = []
    for i, data in enumerate(questions):
        errors = validate_question(
            data.question_type,
            data.options,
            data.answer_key,
            points=data.points,
            negative_points=data.negative_points,
        )
        if errors:
            problems.append({"index": i, "errors": errors})
    if problems:
        raise Unprocessable(
            "Import rejected: some questions are invalid",
            details={"questions": problems},
            code="invalid_import",
        )
    rows = [_question_from(ctx, data, bank.id) for data in questions]
    for row in rows:
        row.rubric_id = None  # rubric references are org specific and not portable
    ctx.db.add_all(rows)
    await ctx.db.flush()
    await ctx.audit("question_bank.imported", "question_bank", bank.id, count=len(rows))
    return rows


# ============================================================================= assessments


async def _validate_items(ctx: Ctx, items: list[ItemIn]) -> None:
    for i, item in enumerate(items):
        if bool(item.question_id) == bool(item.bank_id):
            raise Unprocessable("Each item needs exactly one of question_id or bank_id", details={"index": i})
        if item.question_id:
            await get_question(ctx, item.question_id)
        else:
            await get_bank(ctx, item.bank_id)  # type: ignore[arg-type]
            diff = item.filters.get("difficulty")
            if diff is not None and (not isinstance(diff, list) or not all(isinstance(d, int) for d in diff)):
                raise Unprocessable("filters.difficulty must be a list of integers", details={"index": i})
            tags = item.filters.get("tags")
            if tags is not None and (not isinstance(tags, list) or not all(isinstance(t, str) for t in tags)):
                raise Unprocessable("filters.tags must be a list of strings", details={"index": i})


async def _replace_items(ctx: Ctx, assessment: Assessment, items: list[ItemIn]) -> list[AssessmentItem]:
    await _validate_items(ctx, items)
    for old in await get_items(ctx.db, assessment.id):
        await ctx.db.delete(old)
    await ctx.db.flush()
    rows = [
        AssessmentItem(
            organisation_id=ctx.org_id,
            assessment_id=assessment.id,
            position=i,
            question_id=item.question_id,
            bank_id=item.bank_id,
            draw_count=item.draw_count if item.bank_id else 1,
            filters=item.filters,
            weight=item.weight,
        )
        for i, item in enumerate(items)
    ]
    ctx.db.add_all(rows)
    await ctx.db.flush()
    return rows


async def create_assessment(ctx: Ctx, data: AssessmentCreate) -> Assessment:
    await _course_in_org(ctx, data.course_id)
    fields = data.model_dump(exclude={"items"}, exclude_none=True)
    a = Assessment(organisation_id=ctx.org_id, created_by=ctx.principal.user_id, **fields)
    if "max_attempts" in data.model_fields_set and data.max_attempts is None:
        a.max_attempts = None
    ctx.db.add(a)
    await ctx.db.flush()
    if data.items:
        await _replace_items(ctx, a, data.items)
    await ctx.audit("assessment.created", "assessment", a.id, title=a.title)
    await ctx.db.refresh(a)
    return a


async def update_assessment(ctx: Ctx, a: Assessment, data: AssessmentUpdate) -> Assessment:
    changes = data.model_dump(exclude_unset=True)
    if "course_id" in changes:
        await _course_in_org(ctx, changes["course_id"])
    nullable = {"time_limit_minutes", "max_attempts", "description", "course_id"}
    for k, v in changes.items():
        if v is None and k not in nullable:
            continue
        setattr(a, k, v)
    await ctx.db.flush()
    await ctx.audit("assessment.updated", "assessment", a.id, fields=sorted(changes))
    await ctx.db.refresh(a)
    return a


async def replace_items(ctx: Ctx, a: Assessment, items: list[ItemIn]) -> list[AssessmentItem]:
    rows = await _replace_items(ctx, a, items)
    await ctx.audit("assessment.items_updated", "assessment", a.id, count=len(rows))
    return rows


def _pool_stmt(org_id: uuid.UUID, item: AssessmentItem):  # noqa: ANN202
    stmt = select(Question).where(
        Question.organisation_id == org_id,
        Question.bank_id == item.bank_id,
        Question.deleted_at.is_(None),
        Question.status == "active",
    )
    filters = item.filters or {}
    if filters.get("difficulty"):
        stmt = stmt.where(Question.difficulty.in_([int(d) for d in filters["difficulty"]]))
    if filters.get("tags"):
        stmt = stmt.where(Question.tags.has_any(array([str(t) for t in filters["tags"]])))
    if filters.get("question_types"):
        stmt = stmt.where(Question.question_type.in_([str(t) for t in filters["question_types"]]))
    return stmt


async def count_questions(db: AsyncSession, org_id: uuid.UUID, items: list[AssessmentItem]) -> int:
    total = 0
    for item in items:
        if item.question_id:
            total += 1
        else:
            avail = await db.scalar(select(func.count()).select_from(_pool_stmt(org_id, item).subquery()))
            total += min(item.draw_count, int(avail or 0))
    return total


async def publish_assessment(ctx: Ctx, a: Assessment) -> Assessment:
    items = await get_items(ctx.db, a.id)
    if not items:
        raise Unprocessable("Add at least one question before publishing", code="no_questions")
    problems = []
    for item in items:
        if item.question_id:
            q = await ctx.db.scalar(
                select(Question).where(Question.id == item.question_id, Question.deleted_at.is_(None))
            )
            if q is None:
                problems.append({"item_id": str(item.id), "problem": "question was deleted"})
        else:
            avail = int(
                await ctx.db.scalar(select(func.count()).select_from(_pool_stmt(ctx.org_id, item).subquery()))
                or 0
            )
            if avail < item.draw_count:
                problems.append(
                    {
                        "item_id": str(item.id),
                        "problem": "pool too small",
                        "available": avail,
                        "draw_count": item.draw_count,
                    }
                )
    if problems:
        raise Unprocessable(
            "Assessment cannot be published", details={"items": problems}, code="publish_blocked"
        )
    a.status = "published"
    await ctx.db.flush()
    await ctx.audit("assessment.published", "assessment", a.id, title=a.title)
    await ctx.db.refresh(a)
    return a


async def archive_assessment(ctx: Ctx, a: Assessment) -> Assessment:
    a.status = "archived"
    await ctx.audit("assessment.archived", "assessment", a.id)
    await ctx.db.refresh(a)
    return a


async def delete_assessment(ctx: Ctx, a: Assessment) -> None:
    a.deleted_at = utcnow()
    await ctx.audit("assessment.deleted", "assessment", a.id)


# ============================================================================= learner flow


def _is_staff(ctx: Ctx) -> bool:
    return ctx.can_any(*STAFF_PERMS)


async def learner_assessment(ctx: Ctx, assessment_id: uuid.UUID) -> tuple[Assessment, uuid.UUID | None]:
    """Load an assessment the caller may take; returns it with the enrolment id (course-linked only)."""
    a = await get_assessment(ctx, assessment_id)
    staff = ctx.can("assessments.manage")
    if a.status != "published" and not (staff and a.status == "draft"):
        raise NotFound("Assessment not found")
    enrolment_id = None
    if a.course_id:
        enrolment_id = await ctx.db.scalar(
            select(Enrolment.id).where(
                Enrolment.organisation_id == ctx.org_id,
                Enrolment.user_id == ctx.user_id,
                Enrolment.course_id == a.course_id,
                Enrolment.status != EnrolmentStatus.WITHDRAWN,
            )
        )
        if enrolment_id is None and not staff:
            raise Forbidden("Enrol in the course to take this assessment", code="not_enrolled")
    return a, enrolment_id


async def _user_attempts(
    db: AsyncSession, assessment_id: uuid.UUID, user_id: uuid.UUID
) -> list[AssessmentAttempt]:
    return list(
        (
            await db.execute(
                select(AssessmentAttempt)
                .where(AssessmentAttempt.assessment_id == assessment_id, AssessmentAttempt.user_id == user_id)
                .order_by(AssessmentAttempt.attempt_number)
            )
        ).scalars()
    )


def _expired(att: AssessmentAttempt, now: datetime, grace: timedelta = timedelta(0)) -> bool:
    return att.expires_at is not None and now > att.expires_at + grace


async def overview(ctx: Ctx, assessment_id: uuid.UUID) -> dict[str, Any]:
    a, _ = await learner_assessment(ctx, assessment_id)
    attempts = await _user_attempts(ctx.db, a.id, ctx.user_id)
    now = utcnow()
    for att in attempts:
        if att.status == AttemptStatus.IN_PROGRESS and _expired(att, now, SUBMIT_GRACE):
            await submit_attempt(ctx.db, att, auto=True)
    used = len(attempts)
    in_progress = next((att for att in attempts if att.status == AttemptStatus.IN_PROGRESS), None)
    graded = [
        att.percentage
        for att in attempts
        if att.percentage is not None and att.status == AttemptStatus.GRADED
    ]
    remaining = None if a.max_attempts is None else max(0, a.max_attempts - used)
    reason = None
    can_start = True
    if in_progress is not None:
        reason = "attempt_in_progress"
    elif remaining == 0:
        can_start, reason = False, "max_attempts_reached"
    elif a.status != "published":
        can_start, reason = False, "not_published"
    items = await get_items(ctx.db, a.id)
    return {
        "assessment": {
            "id": a.id,
            "course_id": a.course_id,
            "title": a.title,
            "description": a.description,
            "kind": a.kind,
            "time_limit_minutes": a.time_limit_minutes,
            "max_attempts": a.max_attempts,
            "pass_percentage": a.pass_percentage,
            "question_count": await count_questions(ctx.db, ctx.org_id, items),
            "high_stakes": a.high_stakes,
            "show_feedback": a.show_feedback,
        },
        "attempts_used": used,
        "attempts_remaining": remaining,
        "best_percentage": max(graded) if graded else None,
        "passed": any(att.passed for att in attempts),
        "can_start": can_start,
        "reason": reason,
        "in_progress_attempt_id": in_progress.id if in_progress else None,
        "attempts": [attempt_summary(att) for att in attempts],
    }


def attempt_summary(att: AssessmentAttempt) -> dict[str, Any]:
    return {
        "id": att.id,
        "attempt_number": att.attempt_number,
        "status": att.status,
        "started_at": att.started_at,
        "submitted_at": att.submitted_at,
        "expires_at": att.expires_at,
        "score": att.score,
        "max_score": att.max_score,
        "percentage": att.percentage,
        "passed": att.passed,
    }


def question_snapshot(q: Question) -> dict[str, Any]:
    return {
        "id": str(q.id),
        "question_type": q.question_type,
        "prompt": q.prompt,
        "options": q.options or {},
        "answer_key": q.answer_key or {},
        "explanation": q.explanation,
        "points": float(q.points),
        "negative_points": float(q.negative_points or 0),
        "difficulty": q.difficulty,
        "tags": q.tags or [],
        "skill_ids": q.skill_ids or [],
        "rubric_id": str(q.rubric_id) if q.rubric_id else None,
        "version": q.version,
    }


async def start_attempt(ctx: Ctx, assessment_id: uuid.UUID) -> tuple[AssessmentAttempt, bool]:
    """Start (or resume) an attempt. Returns (attempt, created)."""
    a, enrolment_id = await learner_assessment(ctx, assessment_id)
    # Serialise concurrent starts for the same learner + assessment.
    await ctx.db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": f"attempt:{a.id}:{ctx.user_id}"}
    )
    attempts = await _user_attempts(ctx.db, a.id, ctx.user_id)
    now = utcnow()
    for att in attempts:
        if att.status == AttemptStatus.IN_PROGRESS:
            if _expired(att, now, SUBMIT_GRACE):
                await submit_attempt(ctx.db, att, auto=True)
            else:
                return att, False
    if a.max_attempts is not None and len(attempts) >= a.max_attempts:
        raise Conflict(
            "You have used all attempts for this assessment",
            code="max_attempts_reached",
            details={"max_attempts": a.max_attempts},
        )
    items = await get_items(ctx.db, a.id)
    fixed_ids = [i.question_id for i in items if i.question_id]
    fixed: dict[str, dict[str, Any]] = {}
    if fixed_ids:
        for q in (
            await ctx.db.execute(
                select(Question).where(
                    Question.id.in_(fixed_ids),
                    Question.organisation_id == ctx.org_id,
                    Question.deleted_at.is_(None),
                )
            )
        ).scalars():
            fixed[str(q.id)] = question_snapshot(q)
    pools: dict[str, list[dict[str, Any]]] = {}
    for item in items:
        if item.bank_id:
            pools[str(item.id)] = [
                question_snapshot(q) for q in (await ctx.db.execute(_pool_stmt(ctx.org_id, item))).scalars()
            ]
    seed = secrets.randbelow(2**31 - 1)
    item_specs = [
        {
            "id": str(i.id),
            "question_id": str(i.question_id) if i.question_id else None,
            "bank_id": str(i.bank_id) if i.bank_id else None,
            "draw_count": i.draw_count,
            "weight": i.weight,
        }
        for i in items
    ]
    questions = grading.draw_questions(
        item_specs,
        pools,
        fixed,
        seed=seed,
        shuffle_questions=a.shuffle_questions,
        shuffle_options=a.shuffle_options,
    )
    if not questions:
        raise Unprocessable("This assessment has no questions yet", code="no_questions")
    att = AssessmentAttempt(
        organisation_id=ctx.org_id,
        assessment_id=a.id,
        user_id=ctx.user_id,
        enrolment_id=enrolment_id,
        attempt_number=(max((x.attempt_number for x in attempts), default=0) + 1),
        status=AttemptStatus.IN_PROGRESS,
        questions_snapshot=questions,
        settings_snapshot={
            "seed": seed,
            "title": a.title,
            "time_limit_minutes": a.time_limit_minutes,
            "pass_percentage": a.pass_percentage,
            "negative_marking": a.negative_marking,
            "grading_mode": a.grading_mode,
            "show_feedback": a.show_feedback,
            "high_stakes": a.high_stakes,
            "max_attempts": a.max_attempts,
            "shuffle_questions": a.shuffle_questions,
            "shuffle_options": a.shuffle_options,
            "course_id": str(a.course_id) if a.course_id else None,
        },
        started_at=now,
        expires_at=now + timedelta(minutes=a.time_limit_minutes) if a.time_limit_minutes else None,
        integrity={},
    )
    ctx.db.add(att)
    await ctx.db.flush()
    await ctx.audit(
        "assessment.attempt_started",
        "assessment_attempt",
        att.id,
        assessment_id=str(a.id),
        attempt_number=att.attempt_number,
    )
    return att, True


def _remaining(att: AssessmentAttempt, now: datetime) -> int | None:
    if att.expires_at is None or att.status != AttemptStatus.IN_PROGRESS:
        return None
    return max(0, int((att.expires_at - now).total_seconds()))


async def owned_attempt(ctx: Ctx, attempt_id: uuid.UUID) -> AssessmentAttempt:
    att = await get_attempt(ctx, attempt_id)
    if att.user_id != ctx.user_id:
        raise NotFound("Attempt not found")
    return att


async def attempt_view(ctx: Ctx, attempt_id: uuid.UUID) -> dict[str, Any]:
    """Learner view of an attempt: questions WITHOUT answer keys / explanations, plus saved responses."""
    att = await owned_attempt(ctx, attempt_id)
    now = utcnow()
    if att.status == AttemptStatus.IN_PROGRESS and _expired(att, now, SUBMIT_GRACE):
        await submit_attempt(ctx.db, att, auto=True)
    answers = await _answers(ctx.db, att.id)
    return {
        "id": att.id,
        "assessment_id": att.assessment_id,
        "title": (att.settings_snapshot or {}).get("title", ""),
        "attempt_number": att.attempt_number,
        "status": att.status,
        "started_at": att.started_at,
        "expires_at": att.expires_at,
        "submitted_at": att.submitted_at,
        "remaining_seconds": _remaining(att, now),
        "server_time": now,
        "questions": [
            {
                "id": q["id"],
                "position": q.get("position", i),
                "question_type": q["question_type"],
                "prompt": q["prompt"],
                "options": grading.learner_options(q),
                "points": grading._max_points(q),
            }
            for i, q in enumerate(att.questions_snapshot or [])
        ],
        "responses": {qid: a.response or {} for qid, a in answers.items()},
    }


async def save_answer(
    ctx: Ctx, attempt_id: uuid.UUID, question_id: str, response: dict[str, Any]
) -> dict[str, Any]:
    att = await owned_attempt(ctx, attempt_id)
    now = utcnow()
    if att.status != AttemptStatus.IN_PROGRESS:
        raise Conflict("This attempt has already been submitted", code="attempt_closed")
    if _expired(att, now, AUTOSAVE_GRACE):
        raise Conflict(
            "Time is up for this attempt; answers can no longer be changed", code="attempt_expired"
        )
    if not any(q["id"] == question_id for q in att.questions_snapshot or []):
        raise NotFound("Question is not part of this attempt")
    if len(json.dumps(response, default=str)) > MAX_RESPONSE_BYTES:
        raise BadRequest("Answer is too large")
    row = await ctx.db.scalar(
        select(AttemptAnswer).where(
            AttemptAnswer.attempt_id == att.id, AttemptAnswer.question_id == uuid.UUID(question_id)
        )
    )
    if row is None:
        row = AttemptAnswer(
            organisation_id=ctx.org_id,
            attempt_id=att.id,
            question_id=uuid.UUID(question_id),
            response=response,
        )
        ctx.db.add(row)
    else:
        row.response = response
    await ctx.db.flush()
    return {"question_id": question_id, "saved_at": now, "remaining_seconds": _remaining(att, now)}


async def record_integrity(
    ctx: Ctx, attempt_id: uuid.UUID, event: str, detail: str | None, question_id: str | None
) -> dict[str, Any]:
    """Store a client-reported integrity event. Supplementary signal only — never used for scoring."""
    att = await owned_attempt(ctx, attempt_id)
    if att.status != AttemptStatus.IN_PROGRESS:
        raise Conflict("This attempt is closed", code="attempt_closed")
    data = dict(att.integrity or {})
    events = list(data.get("events") or [])
    counts = dict(data.get("counts") or {})
    counts[event] = int(counts.get(event, 0)) + 1
    if len(events) < MAX_INTEGRITY_EVENTS:
        events.append(
            {"event": event, "detail": detail, "question_id": question_id, "at": utcnow().isoformat()}
        )
    data.update(
        events=events,
        counts=counts,
        note="Supplementary signals for human review only; never applied automatically.",
    )
    att.integrity = data
    await ctx.db.flush()
    return {"recorded": True, "counts": counts}


async def _simulation_result(
    db: AsyncSession, att: AssessmentAttempt, q: dict[str, Any], response: dict[str, Any]
) -> dict[str, Any] | None:
    sid = response.get("session_id")
    if not sid:
        return None
    try:
        session_id = uuid.UUID(str(sid))
    except ValueError:
        return None
    sess = await db.scalar(
        select(SimulationSession).where(
            SimulationSession.id == session_id,
            SimulationSession.organisation_id == att.organisation_id,
            SimulationSession.user_id == att.user_id,
        )
    )
    if sess is None:
        return None
    expected = (q.get("options") or {}).get("simulation_id")
    if expected and str(sess.simulation_id) != str(expected):
        return None
    return {
        "status": sess.status,
        "total_score": sess.total_score,
        "passed": sess.passed,
        "band": sess.band,
        "session_id": str(sess.id),
    }


async def submit_attempt(
    db: AsyncSession, att: AssessmentAttempt, *, auto: bool = False
) -> AssessmentAttempt:
    """Close an attempt, auto-grade objective answers and finalize. Late submissions are graded on what was
    saved and flagged (supplementary)."""
    if att.status != AttemptStatus.IN_PROGRESS:
        raise Conflict("This attempt has already been submitted", code="attempt_closed")
    now = utcnow()
    settings_snap = att.settings_snapshot or {}
    answers = await _answers(db, att.id)
    for q in att.questions_snapshot or []:
        row = answers.get(q["id"])
        if row is None:
            row = AttemptAnswer(
                organisation_id=att.organisation_id,
                attempt_id=att.id,
                question_id=uuid.UUID(q["id"]),
                response={},
            )
            db.add(row)
        sim = None
        if q["question_type"] == "simulation":
            sim = await _simulation_result(db, att, q, row.response or {})
        res = grading.grade_question(
            q,
            row.response or {},
            negative_marking=bool(settings_snap.get("negative_marking")),
            simulation_result=sim,
        )
        row.auto_score = None if res.needs_manual else res.score
        row.is_correct = res.is_correct
    integrity = dict(att.integrity or {})
    if auto:
        integrity["auto_submitted"] = {"at": now.isoformat(), "reason": "time_expired"}
    elif _expired(att, now, SUBMIT_GRACE):
        integrity["late_submission"] = {
            "at": now.isoformat(),
            "expires_at": att.expires_at.isoformat() if att.expires_at else None,
            "seconds_late": int((now - att.expires_at).total_seconds()) if att.expires_at else 0,
            "note": "Graded on answers saved before expiry.",
        }
    att.integrity = integrity
    att.status = AttemptStatus.SUBMITTED
    att.submitted_at = now
    await db.flush()
    await finalize_attempt(db, att)
    if att.status == AttemptStatus.NEEDS_REVIEW and settings_snap.get("grading_mode") in AI_MODES:
        await enqueue(
            "ai.grade_attempt_answers",
            db=db,
            attempt_id=str(att.id),
            organisation_id=str(att.organisation_id),
        )
    return att


async def submit(ctx: Ctx, attempt_id: uuid.UUID) -> AssessmentAttempt:
    att = await owned_attempt(ctx, attempt_id)
    await submit_attempt(ctx.db, att)
    await ctx.audit(
        "assessment.attempt_submitted",
        "assessment_attempt",
        att.id,
        status=att.status,
        late="late_submission" in (att.integrity or {}),
    )
    return att


# ============================================================================= finalize (public contract)


async def finalize_attempt(db: AsyncSession, attempt: AssessmentAttempt) -> None:
    """Recompute score / max / percentage / passed from the answers.

    Per answer ``final_score = manual_score ?? ai_score ?? auto_score`` (capped at the question maximum).
    The attempt becomes ``graded`` unless an answer is still ungraded (``needs_review``). When graded,
    emits ``assessment.attempt_graded``. Safe to call repeatedly (e.g. after AI or human re-grading).
    """
    answers = await _answers(db, attempt.id)
    scores: list[float] = []
    max_total = 0.0
    pending = 0
    for q in attempt.questions_snapshot or []:
        qmax = grading._max_points(q)
        max_total += qmax
        row = answers.get(q["id"])
        if row is None:
            continue
        final = next((s for s in (row.manual_score, row.ai_score, row.auto_score) if s is not None), None)
        if final is not None:
            final = min(float(final), qmax)
        row.final_score = final
        if final is None:
            pending += 1
        else:
            scores.append(final)
    total = grading.attempt_total(scores)
    settings_snap = attempt.settings_snapshot or {}
    attempt.score = total
    attempt.max_score = round(max_total, 4)
    attempt.percentage = grading.percentage(total, max_total)
    if pending:
        attempt.status = AttemptStatus.NEEDS_REVIEW
        attempt.passed = None
        await db.flush()
        return
    pass_pct = float(settings_snap.get("pass_percentage", 70.0))
    attempt.passed = attempt.percentage >= pass_pct
    attempt.status = AttemptStatus.GRADED
    attempt.graded_at = utcnow()
    await db.flush()
    assessment = await db.get(Assessment, attempt.assessment_id)
    course_id = assessment.course_id if assessment else None
    await emit(
        db,
        "assessment.attempt_graded",
        {
            "attempt_id": attempt.id,
            "assessment_id": attempt.assessment_id,
            "course_id": course_id,
            "percentage": attempt.percentage,
            "passed": attempt.passed,
            "organisation_id": attempt.organisation_id,
            "user_id": attempt.user_id,
        },
    )
    # Learner notification is sent by the notifications module's subscriber to this event.


# ============================================================================= results


async def _feedback_allowed(ctx: Ctx, att: AssessmentAttempt, staff: bool) -> bool:
    if staff:
        return True
    if att.status not in (AttemptStatus.GRADED, AttemptStatus.NEEDS_REVIEW):
        return False
    mode = (att.settings_snapshot or {}).get("show_feedback", "after_submit")
    if mode == "after_submit":
        return True
    if mode == "after_close":
        a = await ctx.db.get(Assessment, att.assessment_id)
        if a is None or a.status == "archived":
            return True
        max_attempts = a.max_attempts
        if max_attempts is None:
            return False
        used = await ctx.db.scalar(
            select(func.count())
            .select_from(AssessmentAttempt)
            .where(
                AssessmentAttempt.assessment_id == att.assessment_id, AssessmentAttempt.user_id == att.user_id
            )
        )
        return int(used or 0) >= max_attempts
    return False


async def attempt_result(ctx: Ctx, attempt_id: uuid.UUID) -> dict[str, Any]:
    att = await get_attempt(ctx, attempt_id)
    staff = _is_staff(ctx)
    if att.user_id != ctx.principal.user_id and not staff:
        raise NotFound("Attempt not found")
    if att.status == AttemptStatus.IN_PROGRESS:
        raise Conflict("Submit the attempt to see results", code="attempt_in_progress")
    allowed = await _feedback_allowed(ctx, att, staff)
    answers = await _answers(ctx.db, att.id)
    questions = []
    for i, q in enumerate(att.questions_snapshot or []):
        row = answers.get(q["id"])
        entry: dict[str, Any] = {
            "id": q["id"],
            "position": q.get("position", i),
            "question_type": q["question_type"],
            "prompt": q["prompt"],
            "options": q.get("options") if staff else grading.learner_options(q),
            "max_score": grading._max_points(q),
            "response": (row.response if row else {}) or {},
            "score": None,
            "is_correct": None,
            "pending_review": bool(row is not None and row.final_score is None),
        }
        if allowed:
            entry.update(
                score=row.final_score if row else 0.0,
                is_correct=row.is_correct if row else False,
                feedback=row.feedback if row else None,
                correct_answer=grading.correct_answer(q),
                explanation=q.get("explanation"),
            )
            if staff and row is not None:
                entry["ai_feedback"] = row.ai_feedback
        questions.append(entry)
    snap = att.settings_snapshot or {}
    return {
        "id": att.id,
        "assessment_id": att.assessment_id,
        "user_id": att.user_id,
        "title": snap.get("title", ""),
        "attempt_number": att.attempt_number,
        "status": att.status,
        "started_at": att.started_at,
        "submitted_at": att.submitted_at,
        "score": att.score,
        "max_score": att.max_score,
        "percentage": att.percentage,
        "passed": att.passed,
        "pass_percentage": float(snap.get("pass_percentage", 70)),
        "late": "late_submission" in (att.integrity or {}),
        "feedback_available": allowed,
        "questions": questions,
        "integrity": att.integrity if staff else None,
    }


# ============================================================================= manual grading


async def review_queue(ctx: Ctx, assessment_id: uuid.UUID | None, course_id: uuid.UUID | None):  # noqa: ANN201
    pending = (
        select(func.count())
        .where(AttemptAnswer.attempt_id == AssessmentAttempt.id, AttemptAnswer.final_score.is_(None))
        .correlate(AssessmentAttempt)
        .scalar_subquery()
    )
    stmt = (
        select(AssessmentAttempt, Assessment, User.full_name, pending.label("pending"))
        .join(Assessment, Assessment.id == AssessmentAttempt.assessment_id)
        .join(User, User.id == AssessmentAttempt.user_id)
        .where(
            AssessmentAttempt.organisation_id == ctx.org_id,
            AssessmentAttempt.status == AttemptStatus.NEEDS_REVIEW,
        )
        .order_by(Assessment.high_stakes.desc(), AssessmentAttempt.submitted_at.asc())
    )
    if assessment_id:
        stmt = stmt.where(AssessmentAttempt.assessment_id == assessment_id)
    if course_id:
        stmt = stmt.where(Assessment.course_id == course_id)
    return stmt


async def grade_answer(
    ctx: Ctx,
    attempt_id: uuid.UUID,
    question_id: str,
    score: float,
    feedback: str | None,
    override_reason: str | None,
) -> dict[str, Any]:
    att = await get_attempt(ctx, attempt_id)
    if att.status not in (AttemptStatus.NEEDS_REVIEW, AttemptStatus.GRADED, AttemptStatus.SUBMITTED):
        raise Conflict("Only submitted attempts can be graded", code="attempt_not_submitted")
    if att.user_id == ctx.principal.user_id and not ctx.principal.is_superadmin:
        raise Forbidden("You cannot grade your own attempt")
    q = next((x for x in att.questions_snapshot or [] if x["id"] == question_id), None)
    if q is None:
        raise NotFound("Question is not part of this attempt")
    qmax = grading._max_points(q)
    if score > qmax + grading.EPS:
        raise Unprocessable(f"Score cannot exceed {qmax}", details={"max_score": qmax})
    row = await ctx.db.scalar(
        select(AttemptAnswer).where(
            AttemptAnswer.attempt_id == att.id, AttemptAnswer.question_id == uuid.UUID(question_id)
        )
    )
    if row is None:
        row = AttemptAnswer(
            organisation_id=ctx.org_id, attempt_id=att.id, question_id=uuid.UUID(question_id), response={}
        )
        ctx.db.add(row)
        await ctx.db.flush()
    prior = await ctx.db.scalar(
        select(Grade)
        .where(
            Grade.target_type == "attempt_answer",
            Grade.target_id == row.id,
            Grade.organisation_id == ctx.org_id,
        )
        .order_by(Grade.created_at.desc())
        .limit(1)
    )
    is_override = row.ai_score is not None and abs(row.ai_score - score) > grading.EPS
    if is_override and not (override_reason or "").strip():
        raise Unprocessable(
            "An override reason is required when changing the AI score",
            code="override_reason_required",
            details={"ai_score": row.ai_score},
        )
    if prior is not None:
        prior.is_final = False
    grade = Grade(
        organisation_id=ctx.org_id,
        target_type="attempt_answer",
        target_id=row.id,
        source=GradeSource.HUMAN,
        score=score,
        max_score=qmax,
        passed=None,
        summary=feedback,
        grader_id=ctx.user_id,
        is_final=True,
        overrides_grade_id=prior.id if prior else None,
        override_reason=override_reason,
    )
    ctx.db.add(grade)
    row.manual_score = score
    row.feedback = feedback
    row.graded_by = ctx.user_id
    row.is_correct = score >= qmax - grading.EPS
    row.final_score = score
    await ctx.db.flush()
    await ctx.audit(
        "grade.override" if is_override else "attempt.answer_graded",
        "attempt_answer",
        row.id,
        attempt_id=str(att.id),
        score=score,
        ai_score=row.ai_score,
        reason=override_reason,
    )
    pending = sum(1 for a in (await _answers(ctx.db, att.id)).values() if a.final_score is None)
    return {"answer_id": row.id, "grade_id": grade.id, "score": score, "max_score": qmax, "pending": pending}


async def finalize_manual(ctx: Ctx, attempt_id: uuid.UUID) -> AssessmentAttempt:
    att = await get_attempt(ctx, attempt_id)
    if att.status not in (AttemptStatus.NEEDS_REVIEW, AttemptStatus.GRADED, AttemptStatus.SUBMITTED):
        raise Conflict("Only submitted attempts can be finalized", code="attempt_not_submitted")
    att.graded_by = ctx.user_id
    await finalize_attempt(ctx.db, att)
    if att.status != AttemptStatus.GRADED:
        answers = await _answers(ctx.db, att.id)
        raise Conflict(
            "Some answers still need grading",
            code="answers_pending",
            details={"question_ids": [qid for qid, a in answers.items() if a.final_score is None]},
        )
    ctx.db.add(
        Grade(
            organisation_id=ctx.org_id,
            target_type="attempt",
            target_id=att.id,
            source=GradeSource.HUMAN,
            score=att.percentage or 0.0,
            max_score=100.0,
            passed=att.passed,
            grader_id=ctx.user_id,
            is_final=True,
        )
    )
    await ctx.db.flush()
    await ctx.audit(
        "assessment.attempt_finalized",
        "assessment_attempt",
        att.id,
        percentage=att.percentage,
        passed=att.passed,
    )
    return att


# ============================================================================= statistics


async def question_stats(ctx: Ctx, a: Assessment) -> dict[str, Any]:
    """Item analysis: per-question mean score, correct rate, discrimination (upper/lower 27%) and choices."""
    attempts = list(
        (
            await ctx.db.execute(
                select(AssessmentAttempt).where(
                    AssessmentAttempt.assessment_id == a.id,
                    AssessmentAttempt.organisation_id == ctx.org_id,
                    AssessmentAttempt.status.in_([AttemptStatus.GRADED, AttemptStatus.NEEDS_REVIEW]),
                )
            )
        ).scalars()
    )
    total_attempts = int(
        await ctx.db.scalar(
            select(func.count())
            .select_from(AssessmentAttempt)
            .where(AssessmentAttempt.assessment_id == a.id, AssessmentAttempt.organisation_id == ctx.org_id)
        )
        or 0
    )
    ids = [att.id for att in attempts]
    answers: dict[uuid.UUID, dict[str, AttemptAnswer]] = defaultdict(dict)
    if ids:
        for row in (
            await ctx.db.execute(select(AttemptAnswer).where(AttemptAnswer.attempt_id.in_(ids)))
        ).scalars():
            answers[row.attempt_id][str(row.question_id)] = row
    graded = [att for att in attempts if att.status == AttemptStatus.GRADED]
    ranked = sorted(attempts, key=lambda x: x.percentage or 0.0)
    k = max(1, round(len(ranked) * 0.27)) if len(ranked) >= 4 else 0
    lower = {att.id for att in ranked[:k]}
    upper = {att.id for att in ranked[-k:]} if k else set()

    meta: dict[str, dict[str, Any]] = {}
    acc: dict[str, dict[str, Any]] = defaultdict(
        lambda: {
            "n": 0,
            "answered": 0,
            "ratios": [],
            "correct": 0,
            "judged": 0,
            "choices": defaultdict(int),
            "upper": [0, 0],
            "lower": [0, 0],
        }
    )
    for att in attempts:
        for q in att.questions_snapshot or []:
            qid = q["id"]
            meta.setdefault(qid, {"prompt": q["prompt"], "question_type": q["question_type"]})
            s = acc[qid]
            s["n"] += 1
            row = answers[att.id].get(qid)
            resp = (row.response if row else {}) or {}
            if resp:
                s["answered"] += 1
            qmax = grading._max_points(q)
            if row is not None and row.final_score is not None and qmax > 0:
                s["ratios"].append(max(0.0, row.final_score) / qmax)
            if row is not None and row.is_correct is not None:
                s["judged"] += 1
                s["correct"] += int(bool(row.is_correct))
                for bucket, members in (("upper", upper), ("lower", lower)):
                    if att.id in members:
                        s[bucket][0] += int(bool(row.is_correct))
                        s[bucket][1] += 1
            if q["question_type"] == "multiple_choice" and resp.get("choice_id") is not None:
                s["choices"][str(resp["choice_id"])] += 1
            elif q["question_type"] == "multiple_select":
                for c in resp.get("choice_ids") or []:
                    s["choices"][str(c)] += 1
            elif q["question_type"] == "true_false" and resp.get("value") is not None:
                s["choices"][str(resp["value"]).lower()] += 1
    out = []
    for qid, s in acc.items():
        disc = None
        if s["upper"][1] and s["lower"][1]:
            disc = round(s["upper"][0] / s["upper"][1] - s["lower"][0] / s["lower"][1], 3)
        out.append(
            {
                "question_id": qid,
                "prompt": meta[qid]["prompt"][:500],
                "question_type": meta[qid]["question_type"],
                "responses": s["n"],
                "answered": s["answered"],
                "mean_score_pct": round(100 * sum(s["ratios"]) / len(s["ratios"]), 2)
                if s["ratios"]
                else None,
                "correct_rate": round(s["correct"] / s["judged"], 3) if s["judged"] else None,
                "discrimination": disc,
                "choice_distribution": dict(s["choices"]),
            }
        )
    out.sort(key=lambda x: (x["correct_rate"] is None, x["correct_rate"] or 0))
    pct = [att.percentage for att in graded if att.percentage is not None]
    return {
        "assessment_id": a.id,
        "attempts": total_attempts,
        "graded_attempts": len(graded),
        "mean_percentage": round(sum(pct) / len(pct), 2) if pct else None,
        "pass_rate": round(sum(1 for att in graded if att.passed) / len(graded), 3) if graded else None,
        "questions": out,
    }
