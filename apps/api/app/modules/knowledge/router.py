"""/knowledge: organisation knowledge base used by the AI tutor (RAG). Requires ``knowledge.manage``;
learners never list documents — they only see citations in tutor answers."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from sqlalchemy import select

from app.auth.deps import Ctx, require_permission
from app.core.pagination import Page, PageParams, page_params, paginate
from app.models.ai import KnowledgeChunk, KnowledgeDocument
from app.modules.ai import gateway
from app.modules.knowledge import service
from app.modules.knowledge.schemas import (
    ChunkOut,
    DocumentOut,
    DocumentUpdate,
    SearchHit,
    SearchIn,
    SearchOut,
    TextIn,
    UrlIn,
)

router = APIRouter(prefix="/knowledge", tags=["knowledge"])
Manage = Depends(require_permission("knowledge.manage"))


@router.get("/documents", response_model=Page[DocumentOut])
async def list_documents(
    ctx: Ctx = Manage,
    params: PageParams = Depends(page_params),
    course_id: uuid.UUID | None = None,
    status: str | None = None,
    approved: bool | None = None,
    q: str | None = Query(default=None, max_length=200),
) -> Page[DocumentOut]:
    stmt = select(KnowledgeDocument).where(
        KnowledgeDocument.organisation_id == ctx.org_id, KnowledgeDocument.deleted_at.is_(None)
    )
    if course_id:
        stmt = stmt.where(KnowledgeDocument.course_id == course_id)
    if status:
        stmt = stmt.where(KnowledgeDocument.status == status)
    if approved is not None:
        stmt = stmt.where(KnowledgeDocument.approved.is_(approved))
    if q:
        stmt = stmt.where(KnowledgeDocument.title.ilike(f"%{q.replace('%', '').replace('_', '')}%"))
    items, total = await paginate(ctx.db, stmt.order_by(KnowledgeDocument.created_at.desc()), params)
    return Page(
        items=[DocumentOut.model_validate(d) for d in items],
        total=total,
        page=params.page,
        page_size=params.page_size,
    )


@router.post("/documents/upload", response_model=DocumentOut, status_code=202)
async def upload_document(
    file: UploadFile = File(...),
    title: str | None = Form(default=None),
    course_id: uuid.UUID | None = Form(default=None),
    category: str | None = Form(default=None),
    ctx: Ctx = Manage,
) -> DocumentOut:
    """Upload PDF / DOCX / PPTX / TXT / MD. Ingestion runs in the background (status pending → ready)."""
    doc = await service.add_upload(ctx, file, title=title, course_id=course_id, category=category)
    return DocumentOut.model_validate(doc)


@router.post("/documents/url", response_model=DocumentOut, status_code=202)
async def add_url(body: UrlIn, ctx: Ctx = Manage) -> DocumentOut:
    return DocumentOut.model_validate(await service.add_url(ctx, body))


@router.post("/documents/text", response_model=DocumentOut, status_code=202)
async def add_text(body: TextIn, ctx: Ctx = Manage) -> DocumentOut:
    return DocumentOut.model_validate(await service.add_text(ctx, body))


@router.get("/documents/{document_id}", response_model=DocumentOut)
async def get_document(document_id: uuid.UUID, ctx: Ctx = Manage) -> DocumentOut:
    return DocumentOut.model_validate(await service.get_document(ctx, document_id))


@router.patch("/documents/{document_id}", response_model=DocumentOut)
async def update_document(document_id: uuid.UUID, body: DocumentUpdate, ctx: Ctx = Manage) -> DocumentOut:
    doc = await service.get_document(ctx, document_id)
    return DocumentOut.model_validate(await service.update_document(ctx, doc, body))


@router.post("/documents/{document_id}/approve", response_model=DocumentOut)
async def approve(document_id: uuid.UUID, ctx: Ctx = Manage) -> DocumentOut:
    doc = await service.get_document(ctx, document_id)
    return DocumentOut.model_validate(await service.set_approval(ctx, doc, True))


@router.post("/documents/{document_id}/unapprove", response_model=DocumentOut)
async def unapprove(document_id: uuid.UUID, ctx: Ctx = Manage) -> DocumentOut:
    doc = await service.get_document(ctx, document_id)
    return DocumentOut.model_validate(await service.set_approval(ctx, doc, False))


@router.post("/documents/{document_id}/reprocess", response_model=DocumentOut, status_code=202)
async def reprocess(document_id: uuid.UUID, ctx: Ctx = Manage) -> DocumentOut:
    doc = await service.get_document(ctx, document_id)
    return DocumentOut.model_validate(await service.reprocess(ctx, doc))


@router.delete("/documents/{document_id}", status_code=204)
async def delete_document(document_id: uuid.UUID, ctx: Ctx = Manage) -> None:
    doc = await service.get_document(ctx, document_id)
    await service.delete_document(ctx, doc)


@router.get("/documents/{document_id}/chunks", response_model=Page[ChunkOut])
async def list_chunks(
    document_id: uuid.UUID, ctx: Ctx = Manage, params: PageParams = Depends(page_params)
) -> Page[ChunkOut]:
    doc = await service.get_document(ctx, document_id)
    stmt = (
        select(KnowledgeChunk)
        .where(KnowledgeChunk.document_id == doc.id, KnowledgeChunk.organisation_id == ctx.org_id)
        .order_by(KnowledgeChunk.chunk_index)
    )
    items, total = await paginate(ctx.db, stmt, params)
    return Page(
        items=[ChunkOut.model_validate(c) for c in items],
        total=total,
        page=params.page,
        page_size=params.page_size,
    )


@router.post("/search", response_model=SearchOut)
async def search(body: SearchIn, ctx: Ctx = Manage) -> SearchOut:
    """Test retrieval exactly as the tutor would run it (set approved_only to mimic knowledge-only mode)."""
    emb_model = (await gateway.embed_texts(ctx.db, organisation_id=ctx.org_id, texts=["probe"])).model
    hits = await gateway.retrieve(
        ctx.db,
        organisation_id=ctx.org_id,
        query=body.query,
        course_id=body.course_id,
        k=body.k,
        approved_only=body.approved_only,
    )
    return SearchOut(
        query=body.query,
        embedding_model=emb_model,
        results=[
            SearchHit(
                chunk_id=h.chunk_id,
                document_id=h.document_id,
                title=h.title,
                heading=h.heading,
                snippet=h.snippet,
                score=h.score,
                source=h.source,
                course_id=h.course_id,
            )
            for h in hits
        ],
    )
