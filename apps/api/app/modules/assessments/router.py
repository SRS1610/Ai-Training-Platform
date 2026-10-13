"""Question banks, questions, assessments, learner attempts, manual grading and item statistics."""

from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import func, select

from app.auth.deps import Ctx, get_ctx, require_permission
from app.core.pagination import Page, PageParams, page_params, paginate
from app.models.assessment import Assessment, Question
from app.modules.ai import policy as grading_policy
from app.modules.assessments import service
from app.modules.assessments.schemas import (
    AnswerIn,
    AnswerSaved,
    AssessmentCreate,
    AssessmentDetail,
    AssessmentOut,
    AssessmentStats,
    AssessmentUpdate,
    AttemptOut,
    AttemptResult,
    AttemptSummary,
    BankCreate,
    BankExport,
    BankOut,
    BankUpdate,
    ImportResult,
    IntegrityEventIn,
    ItemOut,
    ItemsReplace,
    ManualGradeIn,
    Overview,
    QuestionImport,
    QuestionIn,
    QuestionOut,
    QuestionUpdate,
    ReviewQueueItem,
)

router = APIRouter(tags=["assessments"])
banks = APIRouter(prefix="/question-banks", tags=["assessments"])
questions = APIRouter(prefix="/questions", tags=["assessments"])
assessments = APIRouter(prefix="/assessments", tags=["assessments"])
attempts = APIRouter(prefix="/attempts", tags=["assessments"])

MANAGE = require_permission("assessments.manage")
LEARN = require_permission("learning.access")
REVIEW = require_permission("submissions.review")


# ----------------------------------------------------------------------------- banks


def _bank_out(bank, count: int = 0) -> BankOut:  # noqa: ANN001
    out = BankOut.model_validate(bank)
    out.question_count = count
    return out


@banks.get("", response_model=Page[BankOut])
async def list_banks(
    course_id: uuid.UUID | None = None,
    q: str | None = Query(None, max_length=200),
    params: PageParams = Depends(page_params),
    ctx: Ctx = Depends(MANAGE),
) -> Page[BankOut]:
    stmt = await service.list_banks(ctx, course_id, q)
    total = await ctx.db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery()))
    rows = (await ctx.db.execute(stmt.limit(params.page_size).offset(params.offset))).all()
    return Page(
        items=[_bank_out(b, n) for b, n in rows],
        total=int(total or 0),
        page=params.page,
        page_size=params.page_size,
    )


@banks.post("", response_model=BankOut, status_code=201)
async def create_bank(body: BankCreate, ctx: Ctx = Depends(MANAGE)) -> BankOut:
    return _bank_out(await service.create_bank(ctx, body.title, body.description, body.course_id))


@banks.get("/{bank_id}", response_model=BankOut)
async def get_bank(bank_id: uuid.UUID, ctx: Ctx = Depends(MANAGE)) -> BankOut:
    bank = await service.get_bank(ctx, bank_id)
    return _bank_out(bank, await service.bank_question_count(ctx.db, bank.id))


@banks.patch("/{bank_id}", response_model=BankOut)
async def update_bank(bank_id: uuid.UUID, body: BankUpdate, ctx: Ctx = Depends(MANAGE)) -> BankOut:
    bank = await service.get_bank(ctx, bank_id)
    bank = await service.update_bank(ctx, bank, body.model_dump(exclude_unset=True))
    return _bank_out(bank, await service.bank_question_count(ctx.db, bank.id))


@banks.delete("/{bank_id}", status_code=204)
async def delete_bank(bank_id: uuid.UUID, ctx: Ctx = Depends(MANAGE)) -> Response:
    await service.delete_bank(ctx, await service.get_bank(ctx, bank_id))
    return Response(status_code=204)


@banks.get("/{bank_id}/export", response_model=BankExport)
async def export_bank(bank_id: uuid.UUID, ctx: Ctx = Depends(MANAGE)) -> dict:
    return await service.export_bank(ctx, await service.get_bank(ctx, bank_id))


@banks.post("/{bank_id}/import", response_model=ImportResult, status_code=201)
async def import_bank(bank_id: uuid.UUID, body: QuestionImport, ctx: Ctx = Depends(MANAGE)) -> ImportResult:
    bank = await service.get_bank(ctx, bank_id)
    rows = await service.import_questions(ctx, bank, body.questions)
    return ImportResult(imported=len(rows), question_ids=[r.id for r in rows])


# ----------------------------------------------------------------------------- questions


@questions.get("", response_model=Page[QuestionOut])
async def list_questions(
    bank_id: uuid.UUID | None = None,
    question_type: str | None = None,
    difficulty: int | None = None,
    tag: str | None = None,
    status: str | None = None,
    q: str | None = Query(None, max_length=200),
    params: PageParams = Depends(page_params),
    ctx: Ctx = Depends(MANAGE),
) -> Page[QuestionOut]:
    stmt = select(Question).where(Question.organisation_id == ctx.org_id, Question.deleted_at.is_(None))
    if bank_id:
        stmt = stmt.where(Question.bank_id == bank_id)
    if question_type:
        stmt = stmt.where(Question.question_type == question_type)
    if difficulty:
        stmt = stmt.where(Question.difficulty == difficulty)
    if tag:
        stmt = stmt.where(Question.tags.contains([tag]))
    if status:
        stmt = stmt.where(Question.status == status)
    if q:
        stmt = stmt.where(Question.prompt.ilike(f"%{q}%"))
    items, total = await paginate(ctx.db, stmt.order_by(Question.created_at.desc()), params)
    return Page(
        items=[QuestionOut.model_validate(i) for i in items],
        total=total,
        page=params.page,
        page_size=params.page_size,
    )


@questions.post("", response_model=QuestionOut, status_code=201)
async def create_question(body: QuestionIn, ctx: Ctx = Depends(MANAGE)) -> Question:
    return await service.create_question(ctx, body)


@questions.get("/{question_id}", response_model=QuestionOut)
async def get_question(question_id: uuid.UUID, ctx: Ctx = Depends(MANAGE)) -> Question:
    return await service.get_question(ctx, question_id)


@questions.patch("/{question_id}", response_model=QuestionOut)
async def update_question(
    question_id: uuid.UUID, body: QuestionUpdate, ctx: Ctx = Depends(MANAGE)
) -> Question:
    return await service.update_question(ctx, await service.get_question(ctx, question_id), body)


@questions.delete("/{question_id}", status_code=204)
async def delete_question(question_id: uuid.UUID, ctx: Ctx = Depends(MANAGE)) -> Response:
    await service.delete_question(ctx, await service.get_question(ctx, question_id))
    return Response(status_code=204)


# ----------------------------------------------------------------------------- assessments (authoring)


async def _detail(ctx: Ctx, a) -> AssessmentDetail:  # noqa: ANN001
    items = await service.get_items(ctx.db, a.id)
    return AssessmentDetail(
        **AssessmentOut.model_validate(a).model_dump(exclude={"effective_grading_mode"}),
        effective_grading_mode=await grading_policy.assessment_mode(ctx.db, a),
        items=[ItemOut.model_validate(i) for i in items],
        question_count=await service.count_questions(ctx.db, ctx.org_id, items),
    )


@assessments.get("/review-queue", response_model=Page[ReviewQueueItem])
async def review_queue(
    assessment_id: uuid.UUID | None = None,
    course_id: uuid.UUID | None = None,
    params: PageParams = Depends(page_params),
    ctx: Ctx = Depends(REVIEW),
) -> Page[ReviewQueueItem]:
    stmt = await service.review_queue(ctx, assessment_id, course_id)
    total = await ctx.db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery()))
    rows = (await ctx.db.execute(stmt.limit(params.page_size).offset(params.offset))).all()
    org_mode = await grading_policy.org_grading_mode(ctx.db, ctx.org_id)
    items = [
        ReviewQueueItem(
            attempt_id=att.id,
            assessment_id=a.id,
            assessment_title=a.title,
            course_id=a.course_id,
            user_id=att.user_id,
            learner_name=name,
            attempt_number=att.attempt_number,
            submitted_at=att.submitted_at,
            pending_questions=int(pending or 0),
            high_stakes=a.high_stakes,
            grading_mode=a.grading_mode,
            effective_grading_mode=grading_policy.effective_mode(
                org_mode,
                (att.settings_snapshot or {}).get("grading_mode"),
                a.grading_mode,
                high_stakes=bool(a.high_stakes or (att.settings_snapshot or {}).get("high_stakes")),
            ),
        )
        for att, a, name, pending in rows
    ]
    return Page(items=items, total=int(total or 0), page=params.page, page_size=params.page_size)


@assessments.get("", response_model=Page[AssessmentOut])
async def list_assessments(
    course_id: uuid.UUID | None = None,
    status: Literal["draft", "published", "archived"] | None = None,
    q: str | None = Query(None, max_length=200),
    params: PageParams = Depends(page_params),
    ctx: Ctx = Depends(get_ctx),
) -> Page[AssessmentOut]:
    if not ctx.can("assessments.manage"):
        ctx.require("learning.access")
    stmt = select(Assessment).where(Assessment.organisation_id == ctx.org_id, Assessment.deleted_at.is_(None))
    if not ctx.can("assessments.manage"):
        stmt = stmt.where(Assessment.status == "published")
    elif status:
        stmt = stmt.where(Assessment.status == status)
    if course_id:
        stmt = stmt.where(Assessment.course_id == course_id)
    if q:
        stmt = stmt.where(Assessment.title.ilike(f"%{q}%"))
    items, total = await paginate(ctx.db, stmt.order_by(Assessment.created_at.desc()), params)
    return Page(
        items=[AssessmentOut.model_validate(i) for i in items],
        total=total,
        page=params.page,
        page_size=params.page_size,
    )


@assessments.post("", response_model=AssessmentDetail, status_code=201)
async def create_assessment(body: AssessmentCreate, ctx: Ctx = Depends(MANAGE)) -> AssessmentDetail:
    return await _detail(ctx, await service.create_assessment(ctx, body))


@assessments.get("/{assessment_id}", response_model=AssessmentDetail)
async def get_assessment(assessment_id: uuid.UUID, ctx: Ctx = Depends(MANAGE)) -> AssessmentDetail:
    return await _detail(ctx, await service.get_assessment(ctx, assessment_id))


@assessments.patch("/{assessment_id}", response_model=AssessmentDetail)
async def update_assessment(
    assessment_id: uuid.UUID, body: AssessmentUpdate, ctx: Ctx = Depends(MANAGE)
) -> AssessmentDetail:
    a = await service.update_assessment(ctx, await service.get_assessment(ctx, assessment_id), body)
    return await _detail(ctx, a)


@assessments.put("/{assessment_id}/items", response_model=AssessmentDetail)
async def replace_items(
    assessment_id: uuid.UUID, body: ItemsReplace, ctx: Ctx = Depends(MANAGE)
) -> AssessmentDetail:
    a = await service.get_assessment(ctx, assessment_id)
    await service.replace_items(ctx, a, body.items)
    return await _detail(ctx, a)


@assessments.post("/{assessment_id}/publish", response_model=AssessmentDetail)
async def publish(assessment_id: uuid.UUID, ctx: Ctx = Depends(MANAGE)) -> AssessmentDetail:
    a = await service.publish_assessment(ctx, await service.get_assessment(ctx, assessment_id))
    return await _detail(ctx, a)


@assessments.post("/{assessment_id}/archive", response_model=AssessmentDetail)
async def archive(assessment_id: uuid.UUID, ctx: Ctx = Depends(MANAGE)) -> AssessmentDetail:
    a = await service.archive_assessment(ctx, await service.get_assessment(ctx, assessment_id))
    return await _detail(ctx, a)


@assessments.delete("/{assessment_id}", status_code=204)
async def delete_assessment(assessment_id: uuid.UUID, ctx: Ctx = Depends(MANAGE)) -> Response:
    await service.delete_assessment(ctx, await service.get_assessment(ctx, assessment_id))
    return Response(status_code=204)


@assessments.get("/{assessment_id}/stats", response_model=AssessmentStats)
async def stats(
    assessment_id: uuid.UUID,
    ctx: Ctx = Depends(require_permission("assessments.manage", "analytics.view", any_of=True)),
) -> dict:
    return await service.question_stats(ctx, await service.get_assessment(ctx, assessment_id))


# ----------------------------------------------------------------------------- learner flow


@assessments.get("/{assessment_id}/overview", response_model=Overview)
async def overview(assessment_id: uuid.UUID, ctx: Ctx = Depends(LEARN)) -> dict:
    return await service.overview(ctx, assessment_id)


@assessments.post("/{assessment_id}/attempts", response_model=AttemptOut, status_code=201)
async def start_attempt(assessment_id: uuid.UUID, response: Response, ctx: Ctx = Depends(LEARN)) -> dict:
    att, created = await service.start_attempt(ctx, assessment_id)
    if not created:
        response.status_code = 200
    return await service.attempt_view(ctx, att.id)


@attempts.get("/{attempt_id}", response_model=AttemptOut)
async def get_attempt(attempt_id: uuid.UUID, ctx: Ctx = Depends(LEARN)) -> dict:
    return await service.attempt_view(ctx, attempt_id)


@attempts.put("/{attempt_id}/answers/{question_id}", response_model=AnswerSaved)
async def save_answer(
    attempt_id: uuid.UUID, question_id: str, body: AnswerIn, ctx: Ctx = Depends(LEARN)
) -> dict:
    return await service.save_answer(ctx, attempt_id, question_id, body.response)


@attempts.post("/{attempt_id}/submit", response_model=AttemptSummary)
async def submit(attempt_id: uuid.UUID, ctx: Ctx = Depends(LEARN)) -> dict:
    return service.attempt_summary(await service.submit(ctx, attempt_id))


@attempts.post("/{attempt_id}/integrity")
async def integrity(attempt_id: uuid.UUID, body: IntegrityEventIn, ctx: Ctx = Depends(LEARN)) -> dict:
    return await service.record_integrity(ctx, attempt_id, body.event, body.detail, body.question_id)


@attempts.get("/{attempt_id}/result", response_model=AttemptResult)
async def result(attempt_id: uuid.UUID, ctx: Ctx = Depends(get_ctx)) -> dict:
    return await service.attempt_result(ctx, attempt_id)


# ----------------------------------------------------------------------------- manual grading


@attempts.put("/{attempt_id}/answers/{question_id}/grade")
async def grade_answer(
    attempt_id: uuid.UUID, question_id: str, body: ManualGradeIn, ctx: Ctx = Depends(REVIEW)
) -> dict:
    return await service.grade_answer(
        ctx, attempt_id, question_id, body.score, body.feedback, body.override_reason
    )


@attempts.post("/{attempt_id}/finalize", response_model=AttemptSummary)
async def finalize(attempt_id: uuid.UUID, ctx: Ctx = Depends(REVIEW)) -> dict:
    return service.attempt_summary(await service.finalize_manual(ctx, attempt_id))


router.include_router(banks)
router.include_router(questions)
router.include_router(assessments)
router.include_router(attempts)
