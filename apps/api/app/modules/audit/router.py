"""/audit-logs: browse, verify and export the organisation's audit trail (audit.view)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Query, Response

from app.auth.deps import Ctx, require_permission
from app.core.errors import NotFound
from app.core.pagination import Page, PageParams, page_params
from app.modules.audit import service
from app.modules.audit.schemas import AuditLogOut, ChainVerification

router = APIRouter(prefix="/audit-logs", tags=["audit"])
_view = require_permission("audit.view")


def filters(
    action: str | None = Query(None, max_length=64, description="Exact action, or a prefix ending in '.'"),
    actor_user_id: uuid.UUID | None = None,
    actor: str | None = Query(None, max_length=320, description="Substring of the actor label (email / key)"),
    entity_type: str | None = Query(None, max_length=48),
    entity_id: str | None = Query(None, max_length=64),
    date_from: datetime | None = None,
    date_to: datetime | None = None,
) -> service.AuditFilters:
    return service.AuditFilters(
        action=action,
        actor_user_id=actor_user_id,
        actor=actor,
        entity_type=entity_type,
        entity_id=entity_id,
        date_from=date_from,
        date_to=date_to,
    )


@router.get("", response_model=Page[AuditLogOut])
async def list_audit_logs(
    f: service.AuditFilters = Depends(filters),
    params: PageParams = Depends(page_params),
    ctx: Ctx = Depends(_view),
) -> Page[AuditLogOut]:
    rows, total = await service.list_logs(ctx, f, params)
    return Page(
        items=[AuditLogOut.model_validate(r) for r in rows],
        total=total,
        page=params.page,
        page_size=params.page_size,
    )


@router.get("/verify", response_model=ChainVerification)
async def verify_audit_chain(ctx: Ctx = Depends(_view)) -> ChainVerification:
    return ChainVerification(**await service.verify(ctx))


@router.get("/export")
async def export_audit_logs(
    f: service.AuditFilters = Depends(filters), ctx: Ctx = Depends(_view)
) -> Response:
    """CSV export (max 50,000 rows, newest first). ``X-Row-Count`` reports the number of rows."""
    body, count = await service.export_csv(ctx, f)
    filename = f"audit-log-{ctx.org.slug}-{datetime.now(UTC):%Y%m%d-%H%M%S}.csv"
    return Response(
        body,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"', "X-Row-Count": str(count)},
    )


@router.get("/{log_id}", response_model=AuditLogOut)
async def get_audit_log(log_id: uuid.UUID, ctx: Ctx = Depends(_view)) -> AuditLogOut:
    row = await service.get_log(ctx, log_id)
    if row is None:
        raise NotFound("Audit log entry not found")
    return AuditLogOut.model_validate(row)
