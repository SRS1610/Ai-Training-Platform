"""AI content generation with mandatory human approval.

Lifecycle: pending → running → completed (awaiting review) | failed → approved | rejected → applied.
Regenerating creates a new version (``parent_id`` → previous, ``version`` + 1). Applying writes DRAFT entities
only — publishing still requires ``courses.publish`` in the course builder.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

import structlog
from praxis_ai import prompts as P
from praxis_ai.generation import GenerationInput, schema_hint, validate_output
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import Ctx
from app.core.errors import AppError, BadRequest, Conflict, NotFound
from app.models.ai import AIGeneration, GenerationStatus
from app.models.content import Course, Lesson
from app.modules.ai import gateway
from app.modules.generations.apply import apply_output
from app.modules.generations.schemas import (
    ApplyIn,
    ApplyOut,
    EditIn,
    GenerationCreate,
    GenerationOut,
    GenerationSummary,
    RegenerateIn,
)

log = structlog.get_logger(__name__)
MAX_SOURCE_CHARS = 9000


def _title(gen: AIGeneration) -> str | None:
    out = gen.edited_output or gen.output or {}
    return out.get("title") or (gen.input or {}).get("subject")


def summary(gen: AIGeneration) -> GenerationSummary:
    s = GenerationSummary.model_validate(gen)
    s.cost_usd = float(gen.cost_usd or 0)
    s.title = _title(gen)
    return s


def detail(gen: AIGeneration) -> GenerationOut:
    out = GenerationOut.model_validate(gen)
    out.cost_usd = float(gen.cost_usd or 0)
    out.title = _title(gen)
    out.offline = gen.provider == "offline"
    return out


def _validate_input(raw: dict[str, Any]) -> dict[str, Any]:
    try:
        return GenerationInput.model_validate(raw).model_dump(
            mode="json", exclude={"source_text"}, exclude_none=True
        )
    except ValidationError as exc:
        raise BadRequest(
            "Invalid generation input",
            code="validation_error",
            details=[{"loc": list(e["loc"]), "msg": e["msg"]} for e in exc.errors()],
        ) from exc


async def _course_in_org(ctx: Ctx, course_id: uuid.UUID | None) -> None:
    if course_id and not await ctx.db.scalar(
        select(Course.id).where(
            Course.id == course_id, Course.organisation_id == ctx.org_id, Course.deleted_at.is_(None)
        )
    ):
        raise NotFound("Course not found")


async def _enqueue(ctx: Ctx, gen: AIGeneration) -> None:
    from app.workers import enqueue

    # Held until the request transaction commits, so the worker always sees the new row.
    await enqueue("ai.run_generation", db=ctx.db, generation_id=str(gen.id), organisation_id=str(ctx.org_id))


async def request_generation(ctx: Ctx, body: GenerationCreate) -> AIGeneration:
    r = await gateway.resolve(ctx.db, ctx.org_id)
    gateway.check_feature(r, "content_generation")
    inputs = _validate_input(body.input)
    course_id = body.course_id or (uuid.UUID(inputs["course_id"]) if inputs.get("course_id") else None)
    await _course_in_org(ctx, course_id)
    gen = AIGeneration(
        organisation_id=ctx.org_id,
        kind=body.kind,
        status=GenerationStatus.PENDING,
        input=inputs,
        version=1,
        course_id=course_id,
        requested_by=ctx.user_id,
    )
    ctx.db.add(gen)
    await ctx.db.flush()
    await ctx.audit("ai.generation.requested", "ai_generation", gen.id, kind=body.kind)
    await _enqueue(ctx, gen)
    return gen


async def get_generation(ctx: Ctx, generation_id: uuid.UUID) -> AIGeneration:
    gen = await ctx.db.scalar(
        select(AIGeneration).where(
            AIGeneration.id == generation_id, AIGeneration.organisation_id == ctx.org_id
        )
    )
    if gen is None:
        raise NotFound("Generation not found")
    return gen


async def regenerate(ctx: Ctx, gen: AIGeneration, body: RegenerateIn) -> AIGeneration:
    r = await gateway.resolve(ctx.db, ctx.org_id)
    gateway.check_feature(r, "content_generation")
    if gen.status in (GenerationStatus.PENDING, GenerationStatus.RUNNING):
        raise Conflict("This generation is still running")
    inputs = _validate_input({**(gen.input or {}), **(body.input or {})})
    if body.feedback:
        inputs["feedback"] = body.feedback
    max_version = await ctx.db.scalar(
        select(func.max(AIGeneration.version)).where(
            AIGeneration.organisation_id == ctx.org_id,
            (AIGeneration.id == gen.id)
            | (AIGeneration.parent_id == gen.id)
            | (AIGeneration.parent_id == (gen.parent_id or gen.id)),
        )
    )
    new = AIGeneration(
        organisation_id=ctx.org_id,
        kind=gen.kind,
        status=GenerationStatus.PENDING,
        input=inputs,
        version=int(max_version or gen.version) + 1,
        parent_id=gen.id,
        course_id=gen.course_id,
        requested_by=ctx.user_id,
    )
    ctx.db.add(new)
    await ctx.db.flush()
    await ctx.audit(
        "ai.generation.regenerated",
        "ai_generation",
        new.id,
        parent_id=str(gen.id),
        with_feedback=bool(body.feedback),
    )
    await _enqueue(ctx, new)
    return new


async def edit(ctx: Ctx, gen: AIGeneration, body: EditIn) -> AIGeneration:
    if gen.status not in (GenerationStatus.COMPLETED, GenerationStatus.APPROVED):
        raise Conflict("Only completed generations can be edited")
    try:
        gen.edited_output = validate_output(gen.kind, body.edited_output)
    except ValidationError as exc:
        raise BadRequest(
            "Edited output does not match the expected structure",
            code="validation_error",
            details=[{"loc": list(e["loc"]), "msg": e["msg"]} for e in exc.errors()][:20],
        ) from exc
    if gen.status == GenerationStatus.APPROVED:
        gen.status = GenerationStatus.COMPLETED  # edits after approval need a fresh review
        gen.reviewed_by = None
        gen.reviewed_at = None
    await ctx.db.flush()
    await ctx.db.refresh(gen)  # reload server-side updated_at
    await ctx.audit("ai.generation.edited", "ai_generation", gen.id)
    return gen


async def approve(ctx: Ctx, gen: AIGeneration, notes: str | None) -> AIGeneration:
    if gen.status != GenerationStatus.COMPLETED:
        raise Conflict("Only completed generations awaiting review can be approved")
    gen.status = GenerationStatus.APPROVED
    gen.reviewed_by = ctx.user_id
    gen.reviewed_at = datetime.now(UTC)
    gen.review_notes = notes
    await ctx.db.flush()
    await ctx.db.refresh(gen)  # reload server-side updated_at
    await ctx.audit("ai.generation.approved", "ai_generation", gen.id)
    return gen


async def reject(ctx: Ctx, gen: AIGeneration, notes: str) -> AIGeneration:
    if gen.status not in (GenerationStatus.COMPLETED, GenerationStatus.APPROVED):
        raise Conflict("Only completed or approved generations can be rejected")
    gen.status = GenerationStatus.REJECTED
    gen.reviewed_by = ctx.user_id
    gen.reviewed_at = datetime.now(UTC)
    gen.review_notes = notes
    await ctx.db.flush()
    await ctx.db.refresh(gen)  # reload server-side updated_at
    await ctx.audit("ai.generation.rejected", "ai_generation", gen.id, notes=notes[:500])
    return gen


async def apply(ctx: Ctx, gen: AIGeneration, body: ApplyIn) -> ApplyOut:
    if gen.status != GenerationStatus.APPROVED:
        raise Conflict("Only approved generations can be applied", code="not_approved")
    data = gen.edited_output or gen.output
    if not data:
        raise Conflict("Generation has no output")
    data = validate_output(gen.kind, data)
    inputs = gen.input or {}
    course_id = (
        body.course_id
        or gen.course_id
        or (uuid.UUID(inputs["course_id"]) if inputs.get("course_id") else None)
    )
    module_id = body.module_id or (uuid.UUID(inputs["module_id"]) if inputs.get("module_id") else None)
    entity_type, entity_id, created, link = await apply_output(
        ctx.db,
        org_id=ctx.org_id,
        user_id=ctx.user_id,
        kind=gen.kind,
        data=data,
        course_id=course_id,
        module_id=module_id,
    )
    gen.status = GenerationStatus.APPLIED
    gen.applied_entity_type = entity_type
    gen.applied_entity_id = entity_id
    if entity_type == "course":
        gen.course_id = entity_id
    await ctx.db.flush()
    await ctx.db.refresh(gen)  # reload server-side updated_at
    await ctx.audit(
        "ai.generation.applied",
        "ai_generation",
        gen.id,
        entity_type=entity_type,
        entity_id=str(entity_id),
        created=created,
    )
    return ApplyOut(
        generation=detail(gen), entity_type=entity_type, entity_id=entity_id, created=created, link=link
    )


# --------------------------------------------------------------------------- worker


async def _source_text(db: AsyncSession, org_id: uuid.UUID, gen: AIGeneration) -> str | None:
    """Grounding material: the referenced lesson / course content plus approved knowledge-base passages."""
    from app.modules.tutor.context import lesson_text

    inputs = gen.input or {}
    parts: list[str] = []
    lesson_id = inputs.get("lesson_id")
    if lesson_id:
        try:
            row = await db.scalar(
                select(Lesson).where(Lesson.id == uuid.UUID(str(lesson_id)), Lesson.organisation_id == org_id)
            )
        except ValueError:
            row = None
        if row is not None:
            parts.append(lesson_text({"title": row.title, "summary": row.summary, "content": row.content}))
    if gen.course_id and not parts:
        c = await db.scalar(
            select(Course).where(Course.id == gen.course_id, Course.organisation_id == org_id)
        )
        if c is not None:
            parts.append(f"# {c.title}\n\n{c.description}")
            rows = (
                await db.scalars(
                    select(Lesson)
                    .where(Lesson.course_id == c.id, Lesson.deleted_at.is_(None))
                    .order_by(Lesson.position)
                    .limit(8)
                )
            ).all()
            parts += [
                lesson_text({"title": r.title, "summary": r.summary, "content": r.content}) for r in rows
            ]
    query = " ".join([str(inputs.get("subject", ""))] + [str(o) for o in inputs.get("objectives") or []])
    try:
        chunks = await gateway.retrieve(
            db, organisation_id=org_id, query=query, course_id=gen.course_id, k=3, approved_only=True
        )
    except AppError:
        chunks = []
    parts += [f"[{c.title}] {c.content}" for c in chunks]
    text = "\n\n".join(p for p in parts if p and p.strip())
    return text[:MAX_SOURCE_CHARS] or None


async def run_generation(
    db: AsyncSession, generation_id: uuid.UUID, org_id: uuid.UUID
) -> AIGeneration | None:
    gen = await db.scalar(
        select(AIGeneration).where(AIGeneration.id == generation_id, AIGeneration.organisation_id == org_id)
    )
    if gen is None or gen.status not in (GenerationStatus.PENDING, GenerationStatus.RUNNING):
        return gen
    gen.status = GenerationStatus.RUNNING
    gen.error = None
    await db.commit()
    kind = gen.kind
    try:
        inputs = dict(gen.input or {})
        feedback = inputs.pop("feedback", None)
        source = await _source_text(db, org_id, gen)
        hint = schema_hint(kind)
        r = await gateway.resolve(db, org_id)
        data, result = await gateway.generate_json_result(
            db,
            organisation_id=org_id,
            user_id=gen.requested_by,
            feature="content_generation",
            system=P.generation_system(kind),
            prompt=P.generation_prompt(kind, inputs, hint, feedback=feedback, source_text=source),
            schema_hint=hint,
            course_id=gen.course_id,
            validator=lambda d: validate_output(kind, d),
            max_tokens=max(r.max_output_tokens, 12000 if kind == "course" else 4000),
        )
        gen.output = data
        gen.status = GenerationStatus.COMPLETED
        if result is not None:
            gen.provider, gen.model = result.provider, result.model
            gen.tokens_in, gen.tokens_out, gen.cost_usd = result.tokens_in, result.tokens_out, result.cost_usd
            gen.safety = dict(result.flags)
        await db.flush()
        from app.core.events import emit
        from app.core.notify import notify

        await emit(
            db,
            "generation.completed",
            {"organisation_id": org_id, "user_id": gen.requested_by, "generation_id": gen.id, "kind": kind},
        )
        if gen.requested_by:
            await notify(
                db,
                organisation_id=org_id,
                user_id=gen.requested_by,
                type="generation_ready",
                title=f"Your AI {kind.replace('_', ' ')} is ready for review",
                body=f"“{_title(gen) or kind}” has been generated. Review, edit and approve it before use.",
                link=f"/app/instructor/ai-builder?generation={gen.id}",
                data={"generation_id": str(gen.id), "kind": kind},
            )
        await db.commit()
    except AppError as exc:
        await db.rollback()
        await _fail(db, generation_id, org_id, exc.message)
    except Exception as exc:  # noqa: BLE001 - surface any failure on the generation record
        log.exception("generation.crashed", generation_id=str(generation_id))
        await db.rollback()
        await _fail(db, generation_id, org_id, f"Unexpected error: {type(exc).__name__}")
    return await db.get(AIGeneration, generation_id)


async def _fail(db: AsyncSession, generation_id: uuid.UUID, org_id: uuid.UUID, error: str) -> None:
    gen = await db.scalar(
        select(AIGeneration).where(AIGeneration.id == generation_id, AIGeneration.organisation_id == org_id)
    )
    if gen is not None:
        gen.status = GenerationStatus.FAILED
        gen.error = error[:2000]
        await db.commit()
