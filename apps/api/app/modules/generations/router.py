"""/ai/generations: AI content generation with human review (approve / reject / edit / regenerate / apply)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends

from app.auth.deps import Ctx, require_permission
from app.core.pagination import Page, PageParams, page_params, paginate
from app.models.ai import AIGeneration
from app.modules.generations import service
from app.modules.generations.schemas import (
    ApplyIn,
    ApplyOut,
    EditIn,
    GenerationCreate,
    GenerationOut,
    GenerationSummary,
    RegenerateIn,
    RejectIn,
    ReviewIn,
)

router = APIRouter(prefix="/ai/generations", tags=["ai-generations"])
Author = Depends(require_permission("courses.create", "courses.edit", any_of=True))
Editor = Depends(require_permission("courses.edit"))


@router.post("", response_model=GenerationOut, status_code=202)
async def create(body: GenerationCreate, ctx: Ctx = Author) -> GenerationOut:
    """Queue a generation. Poll ``GET /ai/generations/{id}`` until status is completed / failed."""
    return service.detail(await service.request_generation(ctx, body))


@router.get("", response_model=Page[GenerationSummary])
async def list_generations(
    ctx: Ctx = Author,
    params: PageParams = Depends(page_params),
    kind: str | None = None,
    status: str | None = None,
    course_id: uuid.UUID | None = None,
    mine: bool = False,
) -> Page[GenerationSummary]:
    from sqlalchemy import select

    stmt = select(AIGeneration).where(AIGeneration.organisation_id == ctx.org_id)
    if kind:
        stmt = stmt.where(AIGeneration.kind == kind)
    if status:
        stmt = stmt.where(AIGeneration.status == status)
    if course_id:
        stmt = stmt.where(AIGeneration.course_id == course_id)
    if mine:
        stmt = stmt.where(AIGeneration.requested_by == ctx.user_id)
    items, total = await paginate(ctx.db, stmt.order_by(AIGeneration.created_at.desc()), params)
    return Page(
        items=[service.summary(g) for g in items], total=total, page=params.page, page_size=params.page_size
    )


@router.get("/{generation_id}", response_model=GenerationOut)
async def get(generation_id: uuid.UUID, ctx: Ctx = Author) -> GenerationOut:
    return service.detail(await service.get_generation(ctx, generation_id))


@router.post("/{generation_id}/regenerate", response_model=GenerationOut, status_code=202)
async def regenerate(generation_id: uuid.UUID, body: RegenerateIn, ctx: Ctx = Author) -> GenerationOut:
    gen = await service.get_generation(ctx, generation_id)
    return service.detail(await service.regenerate(ctx, gen, body))


@router.patch("/{generation_id}", response_model=GenerationOut)
async def edit(generation_id: uuid.UUID, body: EditIn, ctx: Ctx = Editor) -> GenerationOut:
    gen = await service.get_generation(ctx, generation_id)
    return service.detail(await service.edit(ctx, gen, body))


@router.post("/{generation_id}/approve", response_model=GenerationOut)
async def approve(generation_id: uuid.UUID, body: ReviewIn | None = None, ctx: Ctx = Editor) -> GenerationOut:
    gen = await service.get_generation(ctx, generation_id)
    return service.detail(await service.approve(ctx, gen, body.notes if body else None))


@router.post("/{generation_id}/reject", response_model=GenerationOut)
async def reject(generation_id: uuid.UUID, body: RejectIn, ctx: Ctx = Editor) -> GenerationOut:
    gen = await service.get_generation(ctx, generation_id)
    return service.detail(await service.reject(ctx, gen, body.notes))


@router.post("/{generation_id}/apply", response_model=ApplyOut)
async def apply(generation_id: uuid.UUID, body: ApplyIn | None = None, ctx: Ctx = Editor) -> ApplyOut:
    """Create DRAFT entities from an approved generation (never published)."""
    gen = await service.get_generation(ctx, generation_id)
    return await service.apply(ctx, gen, body or ApplyIn())
