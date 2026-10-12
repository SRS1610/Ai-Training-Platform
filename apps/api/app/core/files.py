"""Shared upload handling: validation, malware scan, storage, ``files`` row."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import UploadFile

from app.core.errors import BadRequest
from app.core.storage import get_storage, sanitize_filename, scan_bytes, sha256_hex, validate_upload
from app.models.content import StoredFile


async def store_upload(ctx, upload: UploadFile, purpose: str, *, allowed_ext: set[str] | None = None) -> StoredFile:  # noqa: ANN001
    """Validate and persist an uploaded file for the current tenant. ``ctx`` is ``app.auth.deps.Ctx``."""
    data = await upload.read()
    return await store_bytes(ctx, data, upload.filename or "file", upload.content_type or "", purpose,
                             allowed_ext=allowed_ext)


async def store_bytes(ctx, data: bytes, filename: str, content_type: str, purpose: str, *,  # noqa: ANN001
                      allowed_ext: set[str] | None = None, owner_id: uuid.UUID | None = None) -> StoredFile:
    ext = validate_upload(filename, content_type, data)
    if allowed_ext and ext not in allowed_ext:
        raise BadRequest(f"Only {', '.join(sorted(allowed_ext))} files are allowed here")
    status, detail = await scan_bytes(data)
    if status == "infected":
        raise BadRequest("The file failed the malware scan and was rejected", code="malware_detected")
    key = f"{ctx.org_id}/{purpose}/{datetime.now(UTC):%Y/%m}/{uuid.uuid4().hex}{ext}"
    await get_storage().put(key, data, content_type or "application/octet-stream")
    row = StoredFile(
        organisation_id=ctx.org_id,
        owner_id=owner_id or (ctx.principal.user_id if ctx.principal.user else None),
        storage_key=key,
        filename=sanitize_filename(filename),
        content_type=(content_type or "application/octet-stream").split(";")[0],
        size_bytes=len(data),
        sha256=sha256_hex(data),
        purpose=purpose,
        scan_status=status,
        scan_detail=detail,
    )
    ctx.db.add(row)
    await ctx.db.flush()
    return row
