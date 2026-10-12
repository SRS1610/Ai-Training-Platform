"""Upload + access control for stored files (bytes live in object storage, see ``app.core.storage``)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import UploadFile
from sqlalchemy import String, cast, select

from app.auth.deps import Ctx
from app.core.config import settings
from app.core.errors import BadRequest, Forbidden, NotFound
from app.core.files import store_upload
from app.models.content import Course, CourseVersion, FileScanStatus, StoredFile

PURPOSES = {"lesson_media", "submission", "knowledge", "other"}
# Purpose-specific upload permissions (in addition to learning.access | lessons.manage for any upload).
PURPOSE_PERMS: dict[str, tuple[str, ...]] = {
    "lesson_media": ("lessons.manage", "courses.edit"),
    "knowledge": ("knowledge.manage", "lessons.manage"),
    "submission": ("learning.access",),
}
STAFF_PERMS = ("lessons.manage", "submissions.review")
INLINE_PREFIXES = ("image/", "video/", "audio/", "application/pdf")


def download_path(file_id: uuid.UUID) -> str:
    return f"{settings.API_PREFIX}/files/{file_id}/download"


async def upload(ctx: Ctx, file: UploadFile, purpose: str) -> StoredFile:
    if purpose not in PURPOSES:
        raise BadRequest(f"purpose must be one of {', '.join(sorted(PURPOSES))}", code="invalid_purpose")
    perms = PURPOSE_PERMS.get(purpose)
    if perms and not ctx.can_any(*perms):
        raise Forbidden("You cannot upload files for this purpose", details={"required_any": list(perms)})
    row = await store_upload(ctx, file, purpose)
    await ctx.audit(
        "file.uploaded", "file", row.id, purpose=purpose, filename=row.filename, size=row.size_bytes
    )
    return row


async def _used_by_published_course(ctx: Ctx, file_id: uuid.UUID) -> bool:
    """True if any published / superseded course version of a live course references the file
    (by ``file_id`` or by its download URL inside lesson content)."""
    needle = f"%{file_id}%"
    hit = await ctx.db.scalar(
        select(CourseVersion.id)
        .join(Course, Course.id == CourseVersion.course_id)
        .where(
            CourseVersion.organisation_id == ctx.org_id,
            Course.deleted_at.is_(None),
            cast(CourseVersion.snapshot, String).like(needle),
        )
        .limit(1)
    )
    return hit is not None


async def get_accessible(ctx: Ctx, file_id: uuid.UUID) -> StoredFile:
    """Owner, staff (lessons.manage / submissions.review), knowledge managers for knowledge files, and any
    member for lesson media used by a published course. Everyone else gets 404 (no existence leak)."""
    row = await ctx.db.scalar(
        select(StoredFile).where(
            StoredFile.id == file_id,
            StoredFile.organisation_id == ctx.org_id,
            StoredFile.deleted_at.is_(None),
        )
    )
    if row is None:
        raise NotFound("File not found")
    if row.scan_status == FileScanStatus.INFECTED:
        raise Forbidden("This file failed the malware scan", code="file_infected")
    if ctx.principal.user_id and row.owner_id == ctx.principal.user_id:
        return row
    if ctx.can_any(*STAFF_PERMS):
        return row
    if row.purpose == "knowledge" and ctx.can("knowledge.manage"):
        return row
    if row.purpose == "lesson_media" and await _used_by_published_course(ctx, row.id):
        return row
    raise NotFound("File not found")


async def delete(ctx: Ctx, file_id: uuid.UUID) -> None:
    row = await get_accessible(ctx, file_id)
    if row.owner_id != ctx.principal.user_id and not ctx.can("lessons.manage"):
        raise Forbidden("Only the owner can delete this file")
    row.deleted_at = datetime.now(UTC)
    await ctx.db.flush()
    await ctx.audit("file.deleted", "file", row.id)


def parse_range(header: str | None, size: int) -> tuple[int, int] | None:
    """Parse a single ``bytes=start-end`` range. Returns inclusive (start, end) or None (whole file)."""
    if not header or not header.startswith("bytes=") or "," in header:
        return None
    spec = header[6:].strip()
    start_s, _, end_s = spec.partition("-")
    try:
        if start_s == "":
            length = int(end_s)
            if length <= 0:
                return None
            return max(0, size - length), size - 1
        start = int(start_s)
        end = int(end_s) if end_s else size - 1
    except ValueError:
        return None
    if start >= size or start < 0 or end < start:
        raise BadRequest("Requested range not satisfiable", code="range_not_satisfiable")
    return start, min(end, size - 1)
