"""Rubrics, assignments, learner submissions (versioned drafts, submit, review requests) and grading."""

from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import func, select

from app.auth.deps import Ctx, get_ctx, require_permission
from app.core.pagination import Page, PageParams, page_params, paginate
from app.models.assignment import Assignment, Rubric
from app.modules.ai import policy as grading_policy
from app.modules.assignments import service
from app.modules.assignments.schemas import (
    AIRecommendation,
    AssignmentCreate,
    AssignmentOut,
    AssignmentUpdate,
    DraftIn,
    GradeOut,
    GradingDetail,
    HumanGradeIn,
    IntegrityReviewIn,
    IntegritySignalOut,
    LearnerAssignmentOut,
    QueueItem,
    RequestReviewIn,
    ReturnIn,
    RubricIn,
    RubricOut,
    RubricUpdate,
    SubmissionOut,
    SubmitResult,
    VersionOut,
)

router = APIRouter(tags=["assignments"])
rubrics = APIRouter(prefix="/rubrics", tags=["assignments"])
assignments = APIRouter(prefix="/assignments", tags=["assignments"])
grading = APIRouter(prefix="/grading", tags=["grading"])

MANAGE = require_permission("assignments.manage")
LEARN = require_permission("learning.access")
REVIEW = require_permission("submissions.review")


# ----------------------------------------------------------------------------- rubrics


@rubrics.get("", response_model=Page[RubricOut])
async def list_rubrics(
    q: str | None = Query(None, max_length=200),
    params: PageParams = Depends(page_params),
    ctx: Ctx = Depends(require_permission("assignments.manage", "submissions.review", any_of=True)),
) -> Page[RubricOut]:
    stmt = select(Rubric).where(Rubric.organisation_id == ctx.org_id, Rubric.deleted_at.is_(None))
    if q:
        stmt = stmt.where(Rubric.title.ilike(f"%{q}%"))
    items, total = await paginate(ctx.db, stmt.order_by(Rubric.created_at.desc()), params)
    return Page(
        items=[RubricOut.model_validate(i) for i in items],
        total=total,
        page=params.page,
        page_size=params.page_size,
    )


@rubrics.post("", response_model=RubricOut, status_code=201)
async def create_rubric(body: RubricIn, ctx: Ctx = Depends(MANAGE)) -> Rubric:
    return await service.create_rubric(
        ctx, body.title, body.description, [c.model_dump(exclude_none=True) for c in body.criteria]
    )


@rubrics.get("/{rubric_id}", response_model=RubricOut)
async def get_rubric(
    rubric_id: uuid.UUID,
    ctx: Ctx = Depends(require_permission("assignments.manage", "submissions.review", any_of=True)),
) -> Rubric:
    return await service.get_rubric(ctx, rubric_id)


@rubrics.patch("/{rubric_id}", response_model=RubricOut)
async def update_rubric(rubric_id: uuid.UUID, body: RubricUpdate, ctx: Ctx = Depends(MANAGE)) -> Rubric:
    changes = body.model_dump(exclude_unset=True)
    if body.criteria is not None:
        changes["criteria"] = [c.model_dump(exclude_none=True) for c in body.criteria]
    return await service.update_rubric(ctx, await service.get_rubric(ctx, rubric_id), changes)


@rubrics.delete("/{rubric_id}", status_code=204)
async def delete_rubric(rubric_id: uuid.UUID, ctx: Ctx = Depends(MANAGE)) -> Response:
    await service.delete_rubric(ctx, await service.get_rubric(ctx, rubric_id))
    return Response(status_code=204)


# ----------------------------------------------------------------------------- assignments


@assignments.get("", response_model=Page[LearnerAssignmentOut])
async def list_assignments(
    course_id: uuid.UUID | None = None,
    status: Literal["draft", "published", "archived"] | None = None,
    q: str | None = Query(None, max_length=200),
    params: PageParams = Depends(page_params),
    ctx: Ctx = Depends(get_ctx),
) -> Page[LearnerAssignmentOut]:
    staff = ctx.can("assignments.manage")
    if not staff:
        ctx.require("learning.access")
    stmt = select(Assignment).where(Assignment.organisation_id == ctx.org_id, Assignment.deleted_at.is_(None))
    if not staff:
        stmt = stmt.where(Assignment.status == "published")
    elif status:
        stmt = stmt.where(Assignment.status == status)
    if course_id:
        stmt = stmt.where(Assignment.course_id == course_id)
    if q:
        stmt = stmt.where(Assignment.title.ilike(f"%{q}%"))
    items, total = await paginate(ctx.db, stmt.order_by(Assignment.created_at.desc()), params)
    return Page(
        items=[LearnerAssignmentOut.model_validate(i) for i in items],
        total=total,
        page=params.page,
        page_size=params.page_size,
    )


async def _staff_out(ctx: Ctx, a: Assignment) -> AssignmentOut:
    out = AssignmentOut.model_validate(a)
    out.effective_grading_mode = await grading_policy.assignment_mode(ctx.db, a)
    return out


@assignments.post("", response_model=AssignmentOut, status_code=201)
async def create_assignment(body: AssignmentCreate, ctx: Ctx = Depends(MANAGE)) -> AssignmentOut:
    return await _staff_out(ctx, await service.create_assignment(ctx, body))


@assignments.get("/{assignment_id}", response_model=LearnerAssignmentOut | AssignmentOut)
async def get_assignment(assignment_id: uuid.UUID, ctx: Ctx = Depends(get_ctx)) -> LearnerAssignmentOut:
    if ctx.can_any("assignments.manage", "submissions.review"):
        return await _staff_out(ctx, await service.get_assignment(ctx, assignment_id))
    ctx.require("learning.access")
    a, _ = await service.learner_assignment(ctx, assignment_id)
    return LearnerAssignmentOut.model_validate(a)  # never includes expected_output


@assignments.patch("/{assignment_id}", response_model=AssignmentOut)
async def update_assignment(
    assignment_id: uuid.UUID, body: AssignmentUpdate, ctx: Ctx = Depends(MANAGE)
) -> AssignmentOut:
    a = await service.update_assignment(ctx, await service.get_assignment(ctx, assignment_id), body)
    return await _staff_out(ctx, a)


@assignments.post("/{assignment_id}/publish", response_model=AssignmentOut)
async def publish_assignment(assignment_id: uuid.UUID, ctx: Ctx = Depends(MANAGE)) -> AssignmentOut:
    a = await service.publish_assignment(ctx, await service.get_assignment(ctx, assignment_id))
    return await _staff_out(ctx, a)


@assignments.post("/{assignment_id}/archive", response_model=AssignmentOut)
async def archive_assignment(assignment_id: uuid.UUID, ctx: Ctx = Depends(MANAGE)) -> AssignmentOut:
    a = await service.archive_assignment(ctx, await service.get_assignment(ctx, assignment_id))
    return await _staff_out(ctx, a)


@assignments.delete("/{assignment_id}", status_code=204)
async def delete_assignment(assignment_id: uuid.UUID, ctx: Ctx = Depends(MANAGE)) -> Response:
    await service.delete_assignment(ctx, await service.get_assignment(ctx, assignment_id))
    return Response(status_code=204)


# ----------------------------------------------------------------------------- learner submission


@assignments.get("/{assignment_id}/submission", response_model=SubmissionOut | None)
async def my_submission(assignment_id: uuid.UUID, ctx: Ctx = Depends(LEARN)) -> dict | None:
    return await service.my_submission(ctx, assignment_id)


@assignments.put("/{assignment_id}/submission", response_model=SubmissionOut)
async def save_draft(assignment_id: uuid.UUID, body: DraftIn, ctx: Ctx = Depends(LEARN)) -> dict:
    return await service.save_draft(ctx, assignment_id, body)


@assignments.post("/{assignment_id}/submission/submit", response_model=SubmitResult)
async def submit(assignment_id: uuid.UUID, ctx: Ctx = Depends(LEARN)) -> dict:
    return await service.submit(ctx, assignment_id)


@assignments.get("/{assignment_id}/submission/versions", response_model=list[VersionOut])
async def versions(assignment_id: uuid.UUID, ctx: Ctx = Depends(LEARN)) -> list[dict]:
    return await service.list_versions(ctx, assignment_id)


@assignments.post("/{assignment_id}/submission/request-review", response_model=SubmissionOut)
async def request_review(assignment_id: uuid.UUID, body: RequestReviewIn, ctx: Ctx = Depends(LEARN)) -> dict:
    return await service.request_review(ctx, assignment_id, body.note)


# ----------------------------------------------------------------------------- grading


@grading.get("/queue", response_model=Page[QueueItem])
async def queue(
    status: str | None = None,
    assignment_id: uuid.UUID | None = None,
    course_id: uuid.UUID | None = None,
    high_stakes: bool | None = None,
    review_requested: bool | None = None,
    params: PageParams = Depends(page_params),
    ctx: Ctx = Depends(REVIEW),
) -> Page[QueueItem]:
    stmt = service.queue_stmt(
        ctx,
        status=status,
        assignment_id=assignment_id,
        course_id=course_id,
        high_stakes=high_stakes,
        review_requested=review_requested,
    )
    total = await ctx.db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery()))
    rows = (await ctx.db.execute(stmt.limit(params.page_size).offset(params.offset))).all()
    recs = await service.ai_recommendations(ctx.db, [s.id for s, *_ in rows])
    org_mode = await grading_policy.org_grading_mode(ctx.db, ctx.org_id)
    items = []
    for s, a, name, flags in rows:
        g = recs.get(s.id)
        items.append(
            QueueItem(
                submission_id=s.id,
                assignment_id=a.id,
                assignment_title=a.title,
                course_id=a.course_id,
                user_id=s.user_id,
                learner_name=name,
                status=s.status,
                version=s.current_version,
                submitted_at=s.submitted_at,
                high_stakes=a.high_stakes,
                grading_mode=a.grading_mode,
                review_requested=s.review_requested,
                integrity_flags=int(flags or 0),
                ai_recommendation=AIRecommendation(
                    grade_id=g.id,
                    score=service._pct(g),
                    passed=g.passed,
                    confidence=g.confidence,
                    summary=g.summary,
                    ai_model=g.ai_model,
                )
                if g
                else None,
                final_score=s.final_score,
                passed=s.passed,
                graded_at=s.graded_at,
                effective_grading_mode=await grading_policy.assignment_mode(ctx.db, a, org_mode=org_mode),
            )
        )
    return Page(items=items, total=int(total or 0), page=params.page, page_size=params.page_size)


@grading.get("/submissions/{submission_id}", response_model=GradingDetail)
async def grading_detail(submission_id: uuid.UUID, ctx: Ctx = Depends(REVIEW)) -> dict:
    return await service.grading_detail(ctx, submission_id)


@grading.post("/submissions/{submission_id}/grade", response_model=GradeOut, status_code=201)
async def grade(submission_id: uuid.UUID, body: HumanGradeIn, ctx: Ctx = Depends(REVIEW)) -> object:
    return await service.human_grade(ctx, submission_id, body)


@grading.post("/submissions/{submission_id}/return-for-resubmission", response_model=SubmissionOut)
async def return_for_resubmission(
    submission_id: uuid.UUID, body: ReturnIn, ctx: Ctx = Depends(REVIEW)
) -> dict:
    return await service.return_for_resubmission(ctx, submission_id, body.feedback)


@grading.post("/integrity-signals/{signal_id}/review", response_model=IntegritySignalOut)
async def review_signal(signal_id: uuid.UUID, body: IntegrityReviewIn, ctx: Ctx = Depends(REVIEW)) -> object:
    return await service.review_signal(ctx, signal_id, body.outcome)


router.include_router(rubrics)
router.include_router(assignments)
router.include_router(grading)
