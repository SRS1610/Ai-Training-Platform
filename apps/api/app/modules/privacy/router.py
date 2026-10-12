"""/privacy: consents, data export, account deletion (signed-in user) and retention (organisation.manage)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response

from app.auth.deps import Ctx, get_ctx, require_permission
from app.modules.privacy import service
from app.modules.privacy.schemas import (
    ConsentsOut,
    ConsentsUpdate,
    DataRequestOut,
    DeleteAccountIn,
    RetentionIn,
    RetentionOut,
    RetentionRunOut,
)

router = APIRouter(prefix="/privacy", tags=["privacy"])
_manage = require_permission("organisation.manage")


@router.get("/consents", response_model=ConsentsOut)
async def get_consents(ctx: Ctx = Depends(get_ctx)) -> ConsentsOut:
    return await service.get_consents(ctx)


@router.put("/consents", response_model=ConsentsOut)
async def update_consents(body: ConsentsUpdate, ctx: Ctx = Depends(get_ctx)) -> ConsentsOut:
    return await service.record_consents(ctx, body.consents)


@router.get("/requests", response_model=list[DataRequestOut])
async def list_requests(ctx: Ctx = Depends(get_ctx)) -> list[DataRequestOut]:
    return [service.request_out(r) for r in await service.list_requests(ctx)]


@router.post("/export", response_model=DataRequestOut, status_code=202)
async def request_export(ctx: Ctx = Depends(get_ctx)) -> DataRequestOut:
    return service.request_out(await service.request_export(ctx))


@router.get("/requests/{request_id}/download")
async def download_export(request_id: uuid.UUID, ctx: Ctx = Depends(get_ctx)) -> Response:
    data, filename = await service.download_export(ctx, request_id)
    return Response(
        data,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"', "Cache-Control": "no-store"},
    )


@router.post("/delete-account", status_code=204)
async def delete_account(body: DeleteAccountIn, ctx: Ctx = Depends(get_ctx)) -> Response:
    from app.modules.auth.router import _clear_auth_cookies

    await service.delete_account(ctx, body.password, body.confirm_email)
    out = Response(status_code=204)
    _clear_auth_cookies(out)
    return out


@router.get("/retention", response_model=RetentionOut)
async def get_retention(ctx: Ctx = Depends(_manage)) -> RetentionOut:
    return RetentionOut(retention_days=service.retention_days(ctx.org))


@router.put("/retention", response_model=RetentionOut)
async def set_retention(body: RetentionIn, ctx: Ctx = Depends(_manage)) -> RetentionOut:
    before = service.retention_days(ctx.org)
    ctx.org.settings = {**(ctx.org.settings or {}), "retention_days": body.retention_days}
    await ctx.db.flush()
    await ctx.audit(
        "privacy.retention_updated", "organisation", ctx.org_id, before=before, after=body.retention_days
    )
    return RetentionOut(retention_days=body.retention_days)


@router.post("/retention/run", response_model=RetentionRunOut)
async def run_retention(ctx: Ctx = Depends(_manage)) -> RetentionRunOut:
    """Apply the retention policy to this organisation now (it also runs nightly)."""
    return RetentionRunOut(**await service.sweep_org(ctx.db, ctx.org))
