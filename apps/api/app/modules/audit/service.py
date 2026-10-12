"""Read access to the organisation's immutable, hash-chained audit trail."""

from __future__ import annotations

import csv
import io
import json
import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import Select, select

from app.auth.deps import Ctx
from app.core.audit import verify_chain
from app.core.pagination import PageParams, paginate
from app.models.platform import AuditLog

EXPORT_MAX_ROWS = 50_000
CSV_COLUMNS = [
    "created_at",
    "action",
    "actor_type",
    "actor_user_id",
    "actor_label",
    "entity_type",
    "entity_id",
    "ip_address",
    "request_id",
    "metadata",
    "hash",
    "prev_hash",
    "id",
]


@dataclass
class AuditFilters:
    action: str | None = None
    actor_user_id: uuid.UUID | None = None
    actor: str | None = None
    entity_type: str | None = None
    entity_id: str | None = None
    date_from: datetime | None = None
    date_to: datetime | None = None


def _query(org_id: uuid.UUID, f: AuditFilters) -> Select:
    stmt = select(AuditLog).where(AuditLog.organisation_id == org_id)
    if f.action:
        # "member." prefix filters a whole family; otherwise exact match
        stmt = stmt.where(
            AuditLog.action.startswith(f.action) if f.action.endswith(".") else AuditLog.action == f.action
        )
    if f.actor_user_id:
        stmt = stmt.where(AuditLog.actor_user_id == f.actor_user_id)
    if f.actor:
        stmt = stmt.where(AuditLog.actor_label.ilike(f"%{f.actor.strip()}%"))
    if f.entity_type:
        stmt = stmt.where(AuditLog.entity_type == f.entity_type)
    if f.entity_id:
        stmt = stmt.where(AuditLog.entity_id == f.entity_id)
    if f.date_from:
        stmt = stmt.where(AuditLog.created_at >= f.date_from)
    if f.date_to:
        stmt = stmt.where(AuditLog.created_at <= f.date_to)
    return stmt.order_by(AuditLog.created_at.desc(), AuditLog.id.desc())


async def list_logs(ctx: Ctx, f: AuditFilters, params: PageParams) -> tuple[list[AuditLog], int]:
    return await paginate(ctx.db, _query(ctx.org_id, f), params)


async def verify(ctx: Ctx) -> dict:
    return await verify_chain(ctx.db, ctx.org_id)


async def get_log(ctx: Ctx, log_id: uuid.UUID) -> AuditLog | None:
    return await ctx.db.scalar(
        select(AuditLog).where(AuditLog.id == log_id, AuditLog.organisation_id == ctx.org_id)
    )


async def export_csv(ctx: Ctx, f: AuditFilters) -> tuple[str, int]:
    """Render matching rows (newest first, capped at EXPORT_MAX_ROWS) as CSV. The export itself is audited."""
    rows = (await ctx.db.execute(_query(ctx.org_id, f).limit(EXPORT_MAX_ROWS))).scalars().all()
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(CSV_COLUMNS)
    for row in rows:
        writer.writerow(
            [
                row.created_at.isoformat(),
                row.action,
                row.actor_type,
                row.actor_user_id or "",
                _safe(row.actor_label),
                row.entity_type or "",
                _safe(row.entity_id),
                row.ip_address or "",
                row.request_id or "",
                _safe(json.dumps(row.meta or {}, default=str, sort_keys=True)),
                row.hash,
                row.prev_hash or "",
                row.id,
            ]
        )
    await ctx.audit(
        "audit.exported",
        "audit_log",
        None,
        rows=len(rows),
        filters={k: str(v) for k, v in f.__dict__.items() if v is not None},
    )
    return buf.getvalue(), len(rows)


def _safe(value: str | None) -> str:
    """Neutralise spreadsheet formula injection (CSV opened in Excel)."""
    v = value or ""
    return "'" + v if v[:1] in ("=", "+", "-", "@", "\t", "\r") else v
