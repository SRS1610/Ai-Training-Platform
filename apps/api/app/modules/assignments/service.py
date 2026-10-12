"""Assignments, rubrics, versioned submissions, human/AI grading and integrity signals.

Public contract (called by the AI grading worker): :func:`apply_grade`.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import structlog
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import Ctx
from app.core.errors import Conflict, Forbidden, NotFound, Unprocessable
from app.core.events import emit
from app.core.notify import notify
from app.models.assignment import (
    Assignment,
    Grade,
    GradeSource,
    IntegritySignal,
    Rubric,
    Submission,
    SubmissionStatus,
    SubmissionVersion,
)
from app.models.content import Course, StoredFile
from app.models.identity import User
from app.models.learning import Enrolment, EnrolmentStatus
from app.modules.assignments import logic
from app.modules.assignments.schemas import AssignmentCreate, AssignmentUpdate, DraftIn, HumanGradeIn
from app.workers import enqueue

log = structlog.get_logger(__name__)

AI_MODES = {"ai_assisted", "ai_recommend_human_final"}
GRADABLE = {
    SubmissionStatus.SUBMITTED,
    SubmissionStatus.AI_GRADING,
    SubmissionStatus.AI_GRADED,
    SubmissionStatus.UNDER_REVIEW,
    SubmissionStatus.GRADED,
}
QUEUE_DEFAULT = [
    SubmissionStatus.SUBMITTED,
    SubmissionStatus.AI_GRADING,
    SubmissionStatus.AI_GRADED,
    SubmissionStatus.UNDER_REVIEW,
]
RETURN_TARGET = "submission_return"


def utcnow() -> datetime:
    return datetime.now(UTC)


# ============================================================================= rubrics


async def get_rubric(ctx: Ctx, rubric_id: uuid.UUID) -> Rubric:
    r = await ctx.db.scalar(
        select(Rubric).where(
            Rubric.id == rubric_id, Rubric.organisation_id == ctx.org_id, Rubric.deleted_at.is_(None)
        )
    )
    if not r:
        raise NotFound("Rubric not found")
    return r


def _criteria_or_raise(criteria: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalised, errors = logic.normalise_criteria(criteria)
    if errors:
        raise Unprocessable("Rubric is invalid", details={"errors": errors}, code="invalid_rubric")
    return normalised


async def create_rubric(
    ctx: Ctx, title: str, description: str | None, criteria: list[dict[str, Any]]
) -> Rubric:
    r = Rubric(
        organisation_id=ctx.org_id,
        title=title,
        description=description,
        criteria=_criteria_or_raise(criteria),
        total_points=100.0,
        created_by=ctx.principal.user_id,
    )
    ctx.db.add(r)
    await ctx.db.flush()
    await ctx.audit("rubric.created", "rubric", r.id, title=title)
    return r


async def update_rubric(ctx: Ctx, r: Rubric, changes: dict[str, Any]) -> Rubric:
    if changes.get("criteria") is not None:
        r.criteria = _criteria_or_raise(changes["criteria"])
    if changes.get("title"):
        r.title = changes["title"]
    if "description" in changes:
        r.description = changes["description"]
    await ctx.db.flush()
    await ctx.audit("rubric.updated", "rubric", r.id, fields=sorted(changes))
    await ctx.db.refresh(r)
    return r


async def delete_rubric(ctx: Ctx, r: Rubric) -> None:
    r.deleted_at = utcnow()
    await ctx.audit("rubric.deleted", "rubric", r.id)


# ============================================================================= assignments


async def get_assignment(ctx: Ctx, assignment_id: uuid.UUID) -> Assignment:
    a = await ctx.db.scalar(
        select(Assignment).where(
            Assignment.id == assignment_id,
            Assignment.organisation_id == ctx.org_id,
            Assignment.deleted_at.is_(None),
        )
    )
    if not a:
        raise NotFound("Assignment not found")
    return a


async def _check_refs(ctx: Ctx, course_id: uuid.UUID | None, rubric_id: uuid.UUID | None) -> None:
    if course_id:
        ok = await ctx.db.scalar(
            select(Course.id).where(
                Course.id == course_id, Course.organisation_id == ctx.org_id, Course.deleted_at.is_(None)
            )
        )
        if not ok:
            raise NotFound("Course not found")
    if rubric_id:
        await get_rubric(ctx, rubric_id)


def _jsonable(changes: dict[str, Any]) -> dict[str, Any]:
    out = dict(changes)
    for key in ("required_evidence", "structured_fields", "resources"):
        if out.get(key) is not None:
            out[key] = [
                dict(x) if not hasattr(x, "model_dump") else x.model_dump(mode="json") for x in out[key]
            ]
    if out.get("skill_ids") is not None:
        out["skill_ids"] = [str(s) for s in out["skill_ids"]]
    if out.get("allowed_file_types") is not None:
        out["allowed_file_types"] = [("." + t.lower().lstrip(".")) for t in out["allowed_file_types"]]
    return out


async def create_assignment(ctx: Ctx, data: AssignmentCreate) -> Assignment:
    await _check_refs(ctx, data.course_id, data.rubric_id)
    fields = _jsonable(data.model_dump(mode="json", exclude_none=True))
    for key in ("course_id", "rubric_id"):
        if fields.get(key):
            fields[key] = uuid.UUID(fields[key])
    a = Assignment(organisation_id=ctx.org_id, created_by=ctx.principal.user_id, **fields)
    ctx.db.add(a)
    await ctx.db.flush()
    await ctx.audit("assignment.created", "assignment", a.id, title=a.title)
    await ctx.db.refresh(a)
    return a


async def update_assignment(ctx: Ctx, a: Assignment, data: AssignmentUpdate) -> Assignment:
    raw = data.model_dump(exclude_unset=True)
    await _check_refs(ctx, raw.get("course_id"), raw.get("rubric_id"))
    changes = _jsonable(raw)
    nullable = {
        "course_id",
        "rubric_id",
        "expected_output",
        "evaluation_criteria",
        "time_limit_minutes",
        "due_days_after_enrolment",
        "max_submissions",
    }
    for k, v in changes.items():
        if v is None and k not in nullable:
            continue
        setattr(a, k, v)
    await ctx.db.flush()
    await ctx.audit("assignment.updated", "assignment", a.id, fields=sorted(changes))
    await ctx.db.refresh(a)
    return a


async def publish_assignment(ctx: Ctx, a: Assignment) -> Assignment:
    if not (a.instructions or a.scenario or a.objective):
        raise Unprocessable(
            "Add a scenario, objective or instructions before publishing", code="publish_blocked"
        )
    if a.grading_mode in AI_MODES and a.rubric_id is None:
        raise Unprocessable("AI grading requires a rubric", code="publish_blocked")
    a.status = "published"
    await ctx.db.flush()
    await ctx.audit("assignment.published", "assignment", a.id, title=a.title)
    await ctx.db.refresh(a)
    return a


async def archive_assignment(ctx: Ctx, a: Assignment) -> Assignment:
    a.status = "archived"
    await ctx.db.flush()
    await ctx.audit("assignment.archived", "assignment", a.id)
    await ctx.db.refresh(a)
    return a


async def delete_assignment(ctx: Ctx, a: Assignment) -> None:
    a.deleted_at = utcnow()
    await ctx.audit("assignment.deleted", "assignment", a.id)


# ============================================================================= learner submissions


async def learner_assignment(ctx: Ctx, assignment_id: uuid.UUID) -> tuple[Assignment, Enrolment | None]:
    a = await get_assignment(ctx, assignment_id)
    staff = ctx.can("assignments.manage")
    if a.status != "published" and not staff:
        raise NotFound("Assignment not found")
    enrolment = None
    if a.course_id:
        enrolment = await ctx.db.scalar(
            select(Enrolment).where(
                Enrolment.organisation_id == ctx.org_id,
                Enrolment.user_id == ctx.user_id,
                Enrolment.course_id == a.course_id,
                Enrolment.status != EnrolmentStatus.WITHDRAWN,
            )
        )
        if enrolment is None and not staff:
            raise Forbidden("Enrol in the course to access this assignment", code="not_enrolled")
    return a, enrolment


async def _my_submission(ctx: Ctx, assignment_id: uuid.UUID) -> Submission | None:
    return await ctx.db.scalar(
        select(Submission).where(
            Submission.organisation_id == ctx.org_id,
            Submission.assignment_id == assignment_id,
            Submission.user_id == ctx.user_id,
        )
    )


async def _versions(db: AsyncSession, submission_id: uuid.UUID) -> list[SubmissionVersion]:
    return list(
        (
            await db.execute(
                select(SubmissionVersion)
                .where(SubmissionVersion.submission_id == submission_id)
                .order_by(SubmissionVersion.version_number)
            )
        ).scalars()
    )


async def _latest_version(db: AsyncSession, submission_id: uuid.UUID) -> SubmissionVersion | None:
    return await db.scalar(
        select(SubmissionVersion)
        .where(SubmissionVersion.submission_id == submission_id)
        .order_by(SubmissionVersion.version_number.desc())
        .limit(1)
    )


async def _files(db: AsyncSession, org_id: uuid.UUID, ids: list[Any]) -> list[StoredFile]:
    if not ids:
        return []
    rows = (
        await db.execute(
            select(StoredFile).where(
                StoredFile.organisation_id == org_id, StoredFile.id.in_([uuid.UUID(str(i)) for i in ids])
            )
        )
    ).scalars()
    by_id = {r.id: r for r in rows}
    return [by_id[uuid.UUID(str(i))] for i in ids if uuid.UUID(str(i)) in by_id]


def file_ref(f: StoredFile) -> dict[str, Any]:
    return {
        "id": f.id,
        "filename": f.filename,
        "content_type": f.content_type,
        "size_bytes": f.size_bytes,
        "sha256": f.sha256,
        "scan_status": f.scan_status,
    }


async def version_out(db: AsyncSession, org_id: uuid.UUID, v: SubmissionVersion) -> dict[str, Any]:
    files = await _files(db, org_id, v.file_ids or [])
    return {
        "id": v.id,
        "version_number": v.version_number,
        "text_content": v.text_content,
        "code_content": v.code_content,
        "structured_answers": v.structured_answers or {},
        "file_ids": v.file_ids or [],
        "files": [file_ref(f) for f in files],
        "is_final": v.is_final,
        "content_sha256": v.content_sha256,
        "created_at": v.created_at,
    }


async def _final_grade(db: AsyncSession, submission_id: uuid.UUID) -> Grade | None:
    return await db.scalar(
        select(Grade)
        .where(Grade.target_type == "submission", Grade.target_id == submission_id, Grade.is_final.is_(True))
        .order_by(Grade.created_at.desc())
        .limit(1)
    )


async def submission_out(
    db: AsyncSession, s: Submission, a: Assignment, *, released_only: bool
) -> dict[str, Any]:
    latest = await _latest_version(db, s.id)
    grade = None
    if not released_only or s.status == SubmissionStatus.GRADED:
        grade = await _final_grade(db, s.id)
    returned = None
    if s.status == SubmissionStatus.RETURNED or not released_only:
        ret = await db.scalar(
            select(Grade)
            .where(Grade.target_type == RETURN_TARGET, Grade.target_id == s.id)
            .order_by(Grade.created_at.desc())
            .limit(1)
        )
        returned = ret.summary if ret else None
    remaining = None if a.max_submissions is None else max(0, a.max_submissions - s.submit_count)
    return {
        "id": s.id,
        "assignment_id": s.assignment_id,
        "user_id": s.user_id,
        "status": s.status,
        "current_version": s.current_version,
        "submit_count": s.submit_count,
        "submissions_remaining": remaining,
        "started_at": s.started_at,
        "submitted_at": s.submitted_at,
        "due_at": s.due_at,
        "late": bool(s.due_at and s.submitted_at and s.submitted_at > s.due_at),
        "final_score": s.final_score,
        "passed": s.passed,
        "graded_at": s.graded_at,
        "review_requested": s.review_requested,
        "review_request_note": s.review_request_note,
        "latest_version": await version_out(db, s.organisation_id, latest) if latest else None,
        "grade": grade,
        "returned_feedback": returned,
    }


async def my_submission(ctx: Ctx, assignment_id: uuid.UUID) -> dict[str, Any] | None:
    a, _ = await learner_assignment(ctx, assignment_id)
    s = await _my_submission(ctx, a.id)
    return await submission_out(ctx.db, s, a, released_only=True) if s else None


async def _validate_files(ctx: Ctx, a: Assignment, file_ids: list[uuid.UUID]) -> list[StoredFile]:
    if len(set(file_ids)) != len(file_ids):
        raise Unprocessable("Duplicate file ids", code="invalid_files")
    files = await _files(ctx.db, ctx.org_id, list(file_ids))
    valid = [f for f in files if f.owner_id == ctx.user_id and f.deleted_at is None]
    if len(valid) != len(file_ids):
        raise Unprocessable(
            "Some files were not found or do not belong to you",
            code="invalid_files",
            details={"file_ids": [str(i) for i in set(file_ids) - {f.id for f in valid}]},
        )
    infected = [str(f.id) for f in valid if f.scan_status == "infected"]
    if infected:
        raise Unprocessable(
            "Some files failed the malware scan", code="invalid_files", details={"file_ids": infected}
        )
    allowed = {t.lower() for t in (a.allowed_file_types or [])}
    if allowed:
        bad = [f.filename for f in valid if ("." + f.filename.rsplit(".", 1)[-1].lower()) not in allowed]
        if bad:
            raise Unprocessable(
                "File type not allowed for this assignment",
                code="invalid_files",
                details={"files": bad, "allowed": sorted(allowed)},
            )
    return valid


async def save_draft(ctx: Ctx, assignment_id: uuid.UUID, data: DraftIn) -> dict[str, Any]:
    """Save a draft. Every save creates a new immutable ``SubmissionVersion`` (full version history)."""
    a, enrolment = await learner_assignment(ctx, assignment_id)
    if a.status != "published":
        raise Conflict("This assignment is not open for submissions", code="assignment_closed")
    s = await _my_submission(ctx, a.id)
    now = utcnow()
    if s is None:
        due_at = None
        if a.due_days_after_enrolment is not None and enrolment is not None:
            due_at = enrolment.created_at + timedelta(days=a.due_days_after_enrolment)
        s = Submission(
            organisation_id=ctx.org_id,
            assignment_id=a.id,
            user_id=ctx.user_id,
            enrolment_id=enrolment.id if enrolment else None,
            status=SubmissionStatus.DRAFT,
            current_version=0,
            submit_count=0,
            started_at=now,
            due_at=due_at,
        )
        ctx.db.add(s)
        await ctx.db.flush()
    else:
        resubmittable = (
            s.status == SubmissionStatus.GRADED
            and not s.passed
            and (a.max_submissions is None or s.submit_count < a.max_submissions)
        )
        if s.status not in (SubmissionStatus.DRAFT, SubmissionStatus.RETURNED) and not resubmittable:
            raise Conflict("Your submission is being assessed and cannot be edited", code="submission_locked")
    await _validate_files(ctx, a, data.file_ids)
    s.current_version += 1
    v = SubmissionVersion(
        organisation_id=ctx.org_id,
        submission_id=s.id,
        version_number=s.current_version,
        text_content=data.text_content,
        code_content=data.code_content,
        structured_answers=data.structured_answers,
        file_ids=[str(f) for f in data.file_ids],
        is_final=False,
    )
    ctx.db.add(v)
    s.status = SubmissionStatus.DRAFT
    await ctx.db.flush()
    await ctx.db.refresh(s)
    return await submission_out(ctx.db, s, a, released_only=True)


async def list_versions(ctx: Ctx, assignment_id: uuid.UUID) -> list[dict[str, Any]]:
    a, _ = await learner_assignment(ctx, assignment_id)
    s = await _my_submission(ctx, a.id)
    if s is None:
        return []
    return [await version_out(ctx.db, ctx.org_id, v) for v in reversed(await _versions(ctx.db, s.id))]


async def _similarity_check(db: AsyncSession, s: Submission, v: SubmissionVersion) -> IntegritySignal | None:
    """Compare against other learners' final versions of the same assignment (5-word shingles, Jaccard)."""
    mine = logic.shingles(f"{v.text_content or ''}\n{v.code_content or ''}")
    if not mine:
        return None
    others = (
        await db.execute(
            select(SubmissionVersion, Submission.user_id)
            .join(Submission, Submission.id == SubmissionVersion.submission_id)
            .where(
                Submission.assignment_id == s.assignment_id,
                Submission.organisation_id == s.organisation_id,
                Submission.user_id != s.user_id,
                SubmissionVersion.is_final.is_(True),
            )
            .order_by(SubmissionVersion.created_at.desc())
            .limit(2000)
        )
    ).all()
    best: tuple[float, SubmissionVersion | None, uuid.UUID | None] = (0.0, None, None)
    for other, _uid in others:
        score = logic.jaccard(mine, logic.shingles(f"{other.text_content or ''}\n{other.code_content or ''}"))
        if score > best[0]:
            best = (score, other, other.submission_id)
    if best[0] < logic.SIMILARITY_THRESHOLD or best[1] is None:
        return None
    signal = IntegritySignal(
        organisation_id=s.organisation_id,
        user_id=s.user_id,
        target_type="submission",
        target_id=s.id,
        signal_type="similarity",
        score=round(best[0], 4),
        details={
            "matched_submission_id": str(best[2]),
            "matched_version": best[1].version_number,
            "version_number": v.version_number,
            "method": "5-word shingles, Jaccard",
            "threshold": logic.SIMILARITY_THRESHOLD,
            "note": "Supplementary signal for human review only. Never applied as an automatic penalty.",
        },
    )
    db.add(signal)
    await db.flush()
    return signal


async def submit(ctx: Ctx, assignment_id: uuid.UUID) -> dict[str, Any]:
    a, _ = await learner_assignment(ctx, assignment_id)
    if a.status != "published":
        raise Conflict("This assignment is not open for submissions", code="assignment_closed")
    s = await _my_submission(ctx, a.id)
    if s is None:
        raise Conflict("Save your work before submitting", code="no_draft")
    if s.status != SubmissionStatus.DRAFT:
        raise Conflict("There is no draft to submit", code="submission_locked")
    if a.max_submissions is not None and s.submit_count >= a.max_submissions:
        raise Conflict(
            "You have used all submissions for this assignment",
            code="max_submissions_reached",
            details={"max_submissions": a.max_submissions},
        )
    v = await _latest_version(ctx.db, s.id)
    if v is None or v.is_final:
        raise Conflict("Save your work before submitting", code="no_draft")
    files = await _files(ctx.db, ctx.org_id, v.file_ids or [])
    missing = logic.missing_evidence(
        a.required_evidence or [],
        a.structured_fields or [],
        text=v.text_content,
        code=v.code_content,
        structured=v.structured_answers or {},
        files=[{"content_type": f.content_type, "filename": f.filename} for f in files],
    )
    if missing:
        raise Unprocessable(
            "Required evidence is missing", code="missing_evidence", details={"missing": missing}
        )
    now = utcnow()
    v.is_final = True
    v.content_sha256 = logic.content_sha256(
        v.text_content, v.code_content, v.structured_answers or {}, [f.sha256 for f in files]
    )
    s.status = SubmissionStatus.SUBMITTED
    s.submit_count += 1
    s.submitted_at = now
    s.review_requested = False
    await ctx.db.flush()
    signal = await _similarity_check(ctx.db, s, v)
    await ctx.audit(
        "submission.submitted",
        "submission",
        s.id,
        version=v.version_number,
        sha256=v.content_sha256,
        similarity_flag=bool(signal),
    )
    await emit(
        ctx.db,
        "submission.submitted",
        {
            "submission_id": s.id,
            "assignment_id": a.id,
            "course_id": a.course_id,
            "version_number": v.version_number,
            "organisation_id": ctx.org_id,
            "user_id": ctx.user_id,
        },
    )
    if a.grading_mode in AI_MODES:
        await enqueue(
            "ai.grade_submission", db=ctx.db, submission_id=str(s.id), organisation_id=str(ctx.org_id)
        )
    await ctx.db.refresh(s)
    out = await submission_out(ctx.db, s, a, released_only=True)
    out["integrity_flagged"] = signal is not None
    return out


async def request_review(ctx: Ctx, assignment_id: uuid.UUID, note: str) -> dict[str, Any]:
    a, _ = await learner_assignment(ctx, assignment_id)
    s = await _my_submission(ctx, a.id)
    if s is None or s.status not in (
        SubmissionStatus.SUBMITTED,
        SubmissionStatus.AI_GRADED,
        SubmissionStatus.GRADED,
        SubmissionStatus.AI_GRADING,
        SubmissionStatus.UNDER_REVIEW,
    ):
        raise Conflict("Only submitted work can be sent for review", code="not_submitted")
    s.review_requested = True
    s.review_request_note = note
    await ctx.db.flush()
    await ctx.audit("submission.review_requested", "submission", s.id)
    course = await ctx.db.get(Course, a.course_id) if a.course_id else None
    if course is not None and course.instructor_id and course.instructor_id != ctx.user_id:
        try:
            await notify(
                ctx.db,
                organisation_id=ctx.org_id,
                user_id=course.instructor_id,
                type="review_requested",
                title=f"Review requested: {a.title}",
                body=f"{ctx.user.full_name} requested a review of their submission: {note[:300]}",
                link=f"/app/instructor/grading/{s.id}",
                data={"submission_id": str(s.id)},
            )
        except Exception:
            log.exception("submission.review_notify_failed", submission_id=str(s.id))
    await ctx.db.refresh(s)
    return await submission_out(ctx.db, s, a, released_only=True)


# ============================================================================= grading (public contract)


def _pct(grade: Grade) -> float:
    if grade.max_score and grade.max_score != 100.0:
        return round(grade.score / grade.max_score * 100.0, 2)
    return round(float(grade.score), 2)


async def apply_grade(db: AsyncSession, submission: Submission, grade: Grade, *, make_final: bool) -> None:
    """Apply a grade record to a submission.

    Sets ``ai_score`` / ``human_score`` from ``grade.source`` (as a percentage). When ``make_final``: sets
    ``final_score``, ``passed`` (vs ``assignment.passing_score``), ``graded_by/at``, status ``graded``, marks
    this grade as the only final one, emits ``submission.graded`` and notifies the learner. Otherwise an AI
    grade moves the submission to ``ai_graded`` (recommendation awaiting a human).

    Safeguards: AI grades are never final for ``ai_recommend_human_final`` / high-stakes assignments, and an
    AI grade never replaces an existing human final grade.
    """
    if grade not in db:
        db.add(grade)
    grade.target_type = grade.target_type or "submission"
    grade.target_id = grade.target_id or submission.id
    grade.organisation_id = grade.organisation_id or submission.organisation_id
    if grade.submission_version is None:
        grade.submission_version = submission.current_version
    pct = _pct(grade)
    assignment = await db.get(Assignment, submission.assignment_id)
    passing = float(assignment.passing_score if assignment else 70.0)
    grade.passed = pct >= passing
    if grade.source == GradeSource.AI:
        submission.ai_score = pct
        human_final = submission.status == SubmissionStatus.GRADED and submission.human_score is not None
        human_required = assignment is not None and (
            assignment.grading_mode == "ai_recommend_human_final" or assignment.high_stakes
        )
        if make_final and (human_final or human_required):
            make_final = False
    elif grade.source == GradeSource.HUMAN:
        submission.human_score = pct
    await db.flush()
    if not make_final:
        grade.is_final = False
        if grade.source == GradeSource.AI and submission.status in (
            SubmissionStatus.SUBMITTED,
            SubmissionStatus.AI_GRADING,
            SubmissionStatus.UNDER_REVIEW,
        ):
            submission.status = SubmissionStatus.AI_GRADED
        await db.flush()
        return
    await db.execute(
        update(Grade)
        .where(Grade.target_type == "submission", Grade.target_id == submission.id, Grade.id != grade.id)
        .values(is_final=False)
    )
    grade.is_final = True
    submission.final_score = pct
    submission.passed = grade.passed
    submission.graded_by = grade.grader_id
    submission.graded_at = utcnow()
    submission.status = SubmissionStatus.GRADED
    submission.review_requested = False
    await db.flush()
    await emit(
        db,
        "submission.graded",
        {
            "submission_id": submission.id,
            "assignment_id": submission.assignment_id,
            "course_id": assignment.course_id if assignment else None,
            "final_score": pct,
            "passed": grade.passed,
            "grade_id": grade.id,
            "organisation_id": submission.organisation_id,
            "user_id": submission.user_id,
        },
    )
    # Learner notification is sent by the notifications module's subscriber to this event.


# ============================================================================= grading (staff)


async def get_submission(ctx: Ctx, submission_id: uuid.UUID) -> Submission:
    s = await ctx.db.scalar(
        select(Submission).where(Submission.id == submission_id, Submission.organisation_id == ctx.org_id)
    )
    if not s:
        raise NotFound("Submission not found")
    return s


async def latest_ai_grade(db: AsyncSession, submission_id: uuid.UUID) -> Grade | None:
    return await db.scalar(
        select(Grade)
        .where(
            Grade.target_type == "submission",
            Grade.target_id == submission_id,
            Grade.source == GradeSource.AI,
        )
        .order_by(Grade.created_at.desc())
        .limit(1)
    )


def queue_stmt(
    ctx: Ctx,
    *,
    status: str | None,
    assignment_id: uuid.UUID | None,
    course_id: uuid.UUID | None,
    high_stakes: bool | None,
    review_requested: bool | None,
):  # noqa: ANN201
    flags = (
        select(func.count())
        .where(
            IntegritySignal.target_type == "submission",
            IntegritySignal.target_id == Submission.id,
            IntegritySignal.review_outcome.is_(None),
        )
        .correlate(Submission)
        .scalar_subquery()
    )
    stmt = (
        select(Submission, Assignment, User.full_name, flags.label("flags"))
        .join(Assignment, Assignment.id == Submission.assignment_id)
        .join(User, User.id == Submission.user_id)
        .where(Submission.organisation_id == ctx.org_id)
    )
    if status:
        stmt = stmt.where(Submission.status == status)
    else:
        stmt = stmt.where(Submission.status.in_(QUEUE_DEFAULT) | Submission.review_requested.is_(True))
    if assignment_id:
        stmt = stmt.where(Submission.assignment_id == assignment_id)
    if course_id:
        stmt = stmt.where(Assignment.course_id == course_id)
    if high_stakes is not None:
        stmt = stmt.where(Assignment.high_stakes.is_(high_stakes))
    if review_requested is not None:
        stmt = stmt.where(Submission.review_requested.is_(review_requested))
    return stmt.order_by(
        Assignment.high_stakes.desc(),
        Submission.review_requested.desc(),
        Submission.submitted_at.asc().nulls_last(),
    )


async def ai_recommendations(db: AsyncSession, submission_ids: list[uuid.UUID]) -> dict[uuid.UUID, Grade]:
    if not submission_ids:
        return {}
    rows = (
        await db.execute(
            select(Grade)
            .where(
                Grade.target_type == "submission",
                Grade.source == GradeSource.AI,
                Grade.target_id.in_(submission_ids),
            )
            .order_by(Grade.created_at.asc())
        )
    ).scalars()
    return {g.target_id: g for g in rows}  # latest wins


async def grading_detail(ctx: Ctx, submission_id: uuid.UUID) -> dict[str, Any]:
    s = await get_submission(ctx, submission_id)
    a = await ctx.db.get(Assignment, s.assignment_id)
    learner = await ctx.db.get(User, s.user_id)
    grades = list(
        (
            await ctx.db.execute(
                select(Grade)
                .where(
                    Grade.organisation_id == ctx.org_id,
                    Grade.target_id == s.id,
                    Grade.target_type.in_(["submission", RETURN_TARGET]),
                )
                .order_by(Grade.created_at.desc())
            )
        ).scalars()
    )
    signals = list(
        (
            await ctx.db.execute(
                select(IntegritySignal)
                .where(
                    IntegritySignal.organisation_id == ctx.org_id,
                    IntegritySignal.target_type == "submission",
                    IntegritySignal.target_id == s.id,
                )
                .order_by(IntegritySignal.created_at.desc())
            )
        ).scalars()
    )
    versions = [await version_out(ctx.db, ctx.org_id, v) for v in reversed(await _versions(ctx.db, s.id))]
    ai = next((g for g in grades if g.source == GradeSource.AI and g.target_type == "submission"), None)
    return {
        "submission": await submission_out(ctx.db, s, a, released_only=False),
        "assignment": a,
        "learner": {"id": learner.id, "full_name": learner.full_name, "email": learner.email},
        "versions": versions,
        "grades": grades,
        "integrity_signals": signals,
        "ai_recommendation": ai,
    }


async def human_grade(ctx: Ctx, submission_id: uuid.UUID, data: HumanGradeIn) -> dict[str, Any]:
    s = await get_submission(ctx, submission_id)
    if s.status not in GRADABLE:
        raise Conflict("Only submitted work can be graded", code="not_submitted")
    if s.user_id == ctx.user_id and not ctx.principal.is_superadmin:
        raise Forbidden("You cannot grade your own submission")
    a = await ctx.db.get(Assignment, s.assignment_id)
    rubric = await ctx.db.get(Rubric, a.rubric_id) if a.rubric_id else None
    breakdown: list[dict[str, Any]] = []
    if rubric is not None and rubric.criteria:
        pct, breakdown, errors = logic.score_rubric(
            rubric.criteria, [x.model_dump() for x in data.rubric_scores]
        )
        if errors:
            raise Unprocessable(
                "Rubric scores are invalid", details={"errors": errors}, code="invalid_rubric_scores"
            )
    elif data.score is not None:
        pct = round(float(data.score), 2)
    else:
        raise Unprocessable("Provide rubric_scores or a score", code="score_required")
    ai = await latest_ai_grade(ctx.db, s.id)
    previous_final = await _final_grade(ctx.db, s.id)
    reason = (data.override_reason or "").strip() or None

    def _same_version(g: Grade | None) -> bool:
        # A grade of an earlier version (before a resubmission) is not being overridden.
        return g is not None and (g.submission_version is None or g.submission_version == s.current_version)

    ai_differs = _same_version(ai) and abs(_pct(ai) - pct) > 1e-9
    human_differs = (
        _same_version(previous_final)
        and previous_final.source == GradeSource.HUMAN
        and abs(_pct(previous_final) - pct) > 1e-9
    )
    if (ai_differs or human_differs) and not reason:
        raise Unprocessable(
            "An override reason is required when your score differs from the existing grade",
            code="override_reason_required",
            details={"ai_score": _pct(ai) if ai else None, "your_score": pct},
        )
    overrides = previous_final if previous_final is not None else ai
    grade = Grade(
        organisation_id=ctx.org_id,
        target_type="submission",
        target_id=s.id,
        submission_version=s.current_version,
        source=GradeSource.HUMAN,
        score=pct,
        max_score=100.0,
        rubric_breakdown=breakdown,
        strengths=data.strengths,
        weaknesses=data.weaknesses,
        missing_requirements=data.missing_requirements,
        improvements=data.improvements,
        summary=data.summary,
        grader_id=ctx.user_id,
        overrides_grade_id=overrides.id if overrides else None,
        override_reason=reason,
    )
    ctx.db.add(grade)
    await ctx.db.flush()
    await apply_grade(ctx.db, s, grade, make_final=True)
    if ai_differs or human_differs:
        await ctx.audit(
            "grade.override",
            "submission",
            s.id,
            grade_id=str(grade.id),
            overrides_grade_id=str(overrides.id) if overrides else None,
            ai_score=_pct(ai) if ai else None,
            human_score=pct,
            reason=reason,
        )
    else:
        await ctx.audit("grade.created", "submission", s.id, grade_id=str(grade.id), score=pct)
    await ctx.db.refresh(grade)
    return grade


async def return_for_resubmission(ctx: Ctx, submission_id: uuid.UUID, feedback: str) -> dict[str, Any]:
    s = await get_submission(ctx, submission_id)
    if s.status not in GRADABLE:
        raise Conflict("Only submitted work can be returned", code="not_submitted")
    a = await ctx.db.get(Assignment, s.assignment_id)
    ctx.db.add(
        Grade(
            organisation_id=ctx.org_id,
            target_type=RETURN_TARGET,
            target_id=s.id,
            submission_version=s.current_version,
            source=GradeSource.HUMAN,
            score=0.0,
            max_score=100.0,
            summary=feedback,
            grader_id=ctx.user_id,
            is_final=False,
        )
    )
    s.status = SubmissionStatus.RETURNED
    s.review_requested = False
    await ctx.db.flush()
    await ctx.audit("submission.returned", "submission", s.id, version=s.current_version)
    try:
        await notify(
            ctx.db,
            organisation_id=ctx.org_id,
            user_id=s.user_id,
            type="instructor_feedback",
            title=f"Resubmission requested: {a.title}",
            body=feedback[:500],
            link=f"/app/assignments/{a.id}",
            data={"submission_id": str(s.id)},
        )
    except Exception:
        log.exception("submission.return_notify_failed", submission_id=str(s.id))
    await ctx.db.refresh(s)
    return await submission_out(ctx.db, s, a, released_only=False)


async def review_signal(ctx: Ctx, signal_id: uuid.UUID, outcome: str) -> IntegritySignal:
    sig = await ctx.db.scalar(
        select(IntegritySignal).where(
            IntegritySignal.id == signal_id, IntegritySignal.organisation_id == ctx.org_id
        )
    )
    if not sig:
        raise NotFound("Integrity signal not found")
    sig.reviewed_by = ctx.user_id
    sig.review_outcome = outcome
    await ctx.db.flush()
    await ctx.audit("integrity.reviewed", "integrity_signal", sig.id, outcome=outcome)
    await ctx.db.refresh(sig)
    return sig
