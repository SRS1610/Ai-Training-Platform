"""Knowledge ingestion task."""

from __future__ import annotations

import uuid

from app.core.db import system_session
from app.modules.knowledge.service import ingest_document
from app.workers import task


@task("ai.ingest_document")
async def ingest(document_id: str, organisation_id: str) -> str | None:
    org = uuid.UUID(organisation_id)
    async with system_session(org) as db:
        doc = await ingest_document(db, uuid.UUID(document_id), org)
        return doc.status if doc else None
