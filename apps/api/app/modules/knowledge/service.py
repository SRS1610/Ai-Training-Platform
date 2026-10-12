"""Knowledge base: document intake (file / URL / text), ingestion (extract → chunk → embed → store),
approval workflow and retrieval testing."""

from __future__ import annotations

import asyncio
import re
import uuid
from datetime import UTC, datetime
from pathlib import PurePosixPath
from urllib.parse import urlsplit

import structlog
from fastapi import UploadFile
from praxis_ai.chunking import chunk_text
from praxis_ai.extract import ExtractionError, extract_text, kind_from_name
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import Ctx
from app.core.errors import AppError, BadRequest, NotFound
from app.core.files import store_bytes, store_upload
from app.models.ai import KnowledgeChunk, KnowledgeDocument
from app.models.content import Course, StoredFile
from app.modules.ai import gateway
from app.modules.knowledge import ssrf
from app.modules.knowledge.schemas import DocumentUpdate, TextIn, UrlIn

log = structlog.get_logger(__name__)
UPLOAD_EXT = {".pdf", ".docx", ".pptx", ".txt", ".md"}
MAX_CHUNKS = 2000


async def _check_course(ctx: Ctx, course_id: uuid.UUID | None) -> None:
    if course_id is None:
        return
    found = await ctx.db.scalar(
        select(Course.id).where(
            Course.id == course_id, Course.organisation_id == ctx.org_id, Course.deleted_at.is_(None)
        )
    )
    if not found:
        raise NotFound("Course not found")


async def get_document(ctx: Ctx, document_id: uuid.UUID) -> KnowledgeDocument:
    doc = await ctx.db.scalar(
        select(KnowledgeDocument).where(
            KnowledgeDocument.id == document_id,
            KnowledgeDocument.organisation_id == ctx.org_id,
            KnowledgeDocument.deleted_at.is_(None),
        )
    )
    if doc is None:
        raise NotFound("Document not found")
    return doc


async def _enqueue_ingest(ctx: Ctx, doc: KnowledgeDocument) -> None:
    from app.workers import enqueue

    # Held until the request transaction commits, so the worker always sees the new row.
    await enqueue("ai.ingest_document", db=ctx.db, document_id=str(doc.id), organisation_id=str(ctx.org_id))


async def _new_doc(
    ctx: Ctx,
    *,
    title: str,
    source_type: str,
    course_id: uuid.UUID | None,
    category: str | None,
    source_url: str | None = None,
    file_id: uuid.UUID | None = None,
) -> KnowledgeDocument:
    doc = KnowledgeDocument(
        organisation_id=ctx.org_id,
        title=title[:255],
        course_id=course_id,
        source_type=source_type,
        source_url=source_url,
        file_id=file_id,
        category=category,
        status="pending",
        approved=False,
        created_by=ctx.user_id,
    )
    ctx.db.add(doc)
    await ctx.db.flush()
    await ctx.audit(
        "knowledge.document.created",
        "knowledge_document",
        doc.id,
        source_type=source_type,
        course_id=str(course_id) if course_id else None,
    )
    return doc


async def add_upload(
    ctx: Ctx, upload: UploadFile, *, title: str | None, course_id: uuid.UUID | None, category: str | None
) -> KnowledgeDocument:
    await _check_course(ctx, course_id)
    stored = await store_upload(ctx, upload, "knowledge", allowed_ext=UPLOAD_EXT)
    kind = kind_from_name(stored.filename, stored.content_type)
    doc = await _new_doc(
        ctx,
        title=title or PurePosixPath(stored.filename).stem.replace("_", " "),
        source_type="markdown" if kind == "md" else kind,
        course_id=course_id,
        category=category,
        file_id=stored.id,
    )
    await _enqueue_ingest(ctx, doc)
    return doc


async def add_url(ctx: Ctx, body: UrlIn) -> KnowledgeDocument:
    await _check_course(ctx, body.course_id)
    await ssrf.check_url(body.url)  # fail fast; re-checked on every hop at fetch time
    parts = urlsplit(body.url)
    doc = await _new_doc(
        ctx,
        title=body.title or (parts.hostname or "") + (parts.path if parts.path != "/" else ""),
        source_type="url",
        course_id=body.course_id,
        category=body.category,
        source_url=body.url.strip(),
    )
    await _enqueue_ingest(ctx, doc)
    return doc


async def add_text(ctx: Ctx, body: TextIn) -> KnowledgeDocument:
    await _check_course(ctx, body.course_id)
    slug = re.sub(r"[^a-z0-9]+", "-", body.title.lower()).strip("-")[:60] or "document"
    ext, ctype = (".md", "text/markdown") if body.format == "markdown" else (".txt", "text/plain")
    stored = await store_bytes(
        ctx, body.text.encode("utf-8"), f"{slug}{ext}", ctype, "knowledge", allowed_ext={".md", ".txt"}
    )
    doc = await _new_doc(
        ctx,
        title=body.title,
        source_type="markdown" if ext == ".md" else "text",
        course_id=body.course_id,
        category=body.category,
        file_id=stored.id,
    )
    await _enqueue_ingest(ctx, doc)
    return doc


async def update_document(ctx: Ctx, doc: KnowledgeDocument, body: DocumentUpdate) -> KnowledgeDocument:
    if body.title is not None:
        doc.title = body.title
    if body.category is not None:
        doc.category = body.category
    if body.course_id is not None or body.clear_course:
        new_course = None if body.clear_course else body.course_id
        await _check_course(ctx, new_course)
        doc.course_id = new_course
        await ctx.db.execute(
            update(KnowledgeChunk).where(KnowledgeChunk.document_id == doc.id).values(course_id=new_course)
        )
    await ctx.db.flush()
    await ctx.db.refresh(doc)  # reload server-side updated_at
    await ctx.audit("knowledge.document.updated", "knowledge_document", doc.id)
    return doc


async def set_approval(ctx: Ctx, doc: KnowledgeDocument, approved: bool) -> KnowledgeDocument:
    doc.approved = approved
    doc.approved_by = ctx.user_id if approved else None
    doc.approved_at = datetime.now(UTC) if approved else None
    await ctx.db.flush()
    await ctx.db.refresh(doc)  # reload server-side updated_at
    await ctx.audit(
        "knowledge.document.approved" if approved else "knowledge.document.unapproved",
        "knowledge_document",
        doc.id,
    )
    return doc


async def reprocess(ctx: Ctx, doc: KnowledgeDocument) -> KnowledgeDocument:
    doc.status = "pending"
    doc.error = None
    await ctx.db.flush()
    await ctx.db.refresh(doc)  # reload server-side updated_at
    await ctx.audit("knowledge.document.reprocessed", "knowledge_document", doc.id)
    await _enqueue_ingest(ctx, doc)
    return doc


async def delete_document(ctx: Ctx, doc: KnowledgeDocument) -> None:
    doc.deleted_at = datetime.now(UTC)
    doc.approved = False
    await ctx.db.execute(delete(KnowledgeChunk).where(KnowledgeChunk.document_id == doc.id))
    doc.chunk_count = 0
    await ctx.db.flush()
    await ctx.audit("knowledge.document.deleted", "knowledge_document", doc.id)


# --------------------------------------------------------------------------- ingestion (worker)


async def _load_bytes(db: AsyncSession, doc: KnowledgeDocument) -> tuple[bytes, str, str | None]:
    """Returns (data, kind, suggested_title)."""
    if doc.source_type == "url":
        if not doc.source_url:
            raise BadRequest("Document has no URL")
        res = await ssrf.safe_fetch(doc.source_url)
        path = urlsplit(res.final_url).path
        kind = kind_from_name(path if PurePosixPath(path).suffix else "", res.content_type)
        if kind == "txt" and res.content_type in ("text/html", "application/xhtml+xml"):
            kind = "html"
        return res.content, kind, None
    if not doc.file_id:
        raise BadRequest("Document has no file")
    f = await db.get(StoredFile, doc.file_id)
    if f is None or f.deleted_at is not None:
        raise BadRequest("Source file is missing")
    if f.scan_status == "infected":
        raise BadRequest("Source file failed the malware scan")
    from app.core.storage import get_storage

    return await get_storage().get(f.storage_key), kind_from_name(f.filename, f.content_type), None


async def ingest_document(
    db: AsyncSession, document_id: uuid.UUID, organisation_id: uuid.UUID
) -> KnowledgeDocument | None:
    """extract → chunk (heading-aware, ~800 tokens, overlap) → embed → replace chunks. Status transitions:
    pending → processing → ready | failed (error captured)."""
    doc = await db.scalar(
        select(KnowledgeDocument).where(
            KnowledgeDocument.id == document_id, KnowledgeDocument.organisation_id == organisation_id
        )
    )
    if doc is None or doc.deleted_at is not None:
        return None
    doc.status = "processing"
    doc.error = None
    await db.commit()
    try:
        data, kind, _ = await _load_bytes(db, doc)
        extracted = await asyncio.to_thread(extract_text, data, kind)
        chunks = chunk_text(extracted.text)[:MAX_CHUNKS]
        if not chunks:
            raise ExtractionError("No text could be extracted")
        emb = await gateway.embed_texts(db, organisation_id=organisation_id, texts=[c.text for c in chunks])
        await db.execute(delete(KnowledgeChunk).where(KnowledgeChunk.document_id == doc.id))
        for c, vec in zip(chunks, emb.vectors, strict=True):
            db.add(
                KnowledgeChunk(
                    organisation_id=organisation_id,
                    document_id=doc.id,
                    course_id=doc.course_id,
                    chunk_index=c.index,
                    content=c.text,
                    heading=(c.heading or None) and c.heading[:512],
                    token_count=c.token_count,
                    embedding=vec,
                    embedding_model=emb.model,
                    meta={"source_type": doc.source_type, "kind": kind, "pages": extracted.pages or None},
                )
            )
        if extracted.title and doc.source_type == "url" and (not doc.title or "/" in doc.title):
            doc.title = extracted.title[:255]
        doc.status = "ready"
        doc.chunk_count = len(chunks)
        doc.char_count = len(extracted.text)
        await db.commit()
        log.info("knowledge.ingested", document_id=str(doc.id), chunks=len(chunks), model=emb.model)
    except (AppError, ExtractionError, OSError, ValueError) as exc:
        await db.rollback()
        await _mark_failed(db, document_id, str(getattr(exc, "message", None) or exc))
    except Exception as exc:  # noqa: BLE001 - capture any ingestion failure on the document
        log.exception("knowledge.ingest_crashed", document_id=str(document_id))
        await db.rollback()
        await _mark_failed(db, document_id, f"Unexpected error: {type(exc).__name__}")
    return await db.get(KnowledgeDocument, document_id)


async def _mark_failed(db: AsyncSession, document_id: uuid.UUID, error: str) -> None:
    await db.execute(
        update(KnowledgeDocument)
        .where(KnowledgeDocument.id == document_id)
        .values(status="failed", error=error[:2000], chunk_count=0)
    )
    await db.commit()
    log.warning("knowledge.ingest_failed", document_id=str(document_id), error=error[:200])
