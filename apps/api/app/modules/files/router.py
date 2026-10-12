"""/files: upload (multipart), metadata, download (streamed, range-capable, or presigned S3 redirect)."""

from __future__ import annotations

import uuid
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, Request, Response, UploadFile
from fastapi.responses import RedirectResponse

from app.auth.deps import Ctx, require_permission
from app.core.errors import BadRequest
from app.core.storage import get_storage
from app.modules.files import service as svc
from app.modules.files.schemas import FileOut

router = APIRouter(prefix="/files", tags=["files"])
member = require_permission(
    "learning.access", "lessons.manage", "knowledge.manage", "submissions.review", any_of=True
)


def _out(row: Any) -> FileOut:
    out = FileOut.model_validate(row)
    out.download_url = svc.download_path(row.id)
    return out


@router.post("", response_model=FileOut, status_code=201)
async def upload(
    file: UploadFile = File(...), purpose: str = Form("other"), ctx: Ctx = Depends(member)
) -> Any:
    row = await svc.upload(ctx, file, purpose)
    await ctx.db.refresh(row)
    return _out(row)


@router.get("/{file_id}", response_model=FileOut)
async def metadata(file_id: uuid.UUID, ctx: Ctx = Depends(member)) -> Any:
    return _out(await svc.get_accessible(ctx, file_id))


@router.delete("/{file_id}", status_code=204)
async def delete(file_id: uuid.UUID, ctx: Ctx = Depends(member)) -> Response:
    await svc.delete(ctx, file_id)
    return Response(status_code=204)


@router.get("/{file_id}/download", response_model=None)
async def download(file_id: uuid.UUID, request: Request, ctx: Ctx = Depends(member)) -> Response:
    row = await svc.get_accessible(ctx, file_id)
    storage = get_storage()
    presigned = await storage.presigned_url(row.storage_key)
    if presigned:
        return RedirectResponse(presigned, status_code=307)
    data = await storage.get(row.storage_key)
    inline = row.content_type.startswith(svc.INLINE_PREFIXES)
    disposition = "inline" if inline else "attachment"
    headers = {
        "Content-Disposition": f"{disposition}; filename*=UTF-8''{quote(row.filename)}",
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=300",
        "ETag": f'"{row.sha256}"',
        "Content-Security-Policy": "default-src 'none'; sandbox",
    }
    try:
        rng = svc.parse_range(request.headers.get("range"), len(data))
    except BadRequest:
        return Response(status_code=416, headers={"Content-Range": f"bytes */{len(data)}"})
    if rng is None:
        return Response(content=data, media_type=row.content_type, headers=headers)
    start, end = rng
    headers["Content-Range"] = f"bytes {start}-{end}/{len(data)}"
    return Response(
        content=data[start : end + 1], status_code=206, media_type=row.content_type, headers=headers
    )
