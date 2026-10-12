"""Background jobs: data exports and the nightly retention sweep (beat schedule: privacy.retention_sweep)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

import structlog
from sqlalchemy import select

from app.core.config import settings
from app.core.db import system_session
from app.core.email import send_email
from app.core.storage import get_storage
from app.models.identity import User
from app.models.platform import DataRequest
from app.models.tenancy import Organisation
from app.modules.privacy.service import build_zip, collect_user_data, sweep_org
from app.workers import task

log = structlog.get_logger(__name__)


@task("privacy.export")
async def export_user_data(request_id: str) -> None:
    """Build the JSON zip for a DataRequest(kind=export) and store it in object storage."""
    rid = uuid.UUID(request_id)
    async with system_session() as db:
        req = await db.get(DataRequest, rid)
        if req is None or req.kind != "export" or req.status not in ("pending", "failed") or not req.user_id:
            return
        req.status = "processing"
        await db.commit()
    try:
        async with system_session() as db:
            data = await collect_user_data(db, req.user_id)
        blob = build_zip(data)
        key = f"privacy-exports/{req.user_id}/{rid}.zip"
        await get_storage().put(key, blob, "application/zip")
    except Exception as exc:
        log.exception("privacy.export_failed", request_id=request_id)
        async with system_session() as db:
            row = await db.get(DataRequest, rid)
            if row:
                row.status, row.error = "failed", f"{type(exc).__name__}: {exc}"[:500]
        return
    async with system_session() as db:
        row = await db.get(DataRequest, rid)
        if row is None:
            return
        row.status, row.file_storage_key, row.completed_at, row.error = (
            "completed",
            key,
            datetime.now(UTC),
            None,
        )
        user = await db.get(User, row.user_id) if row.user_id else None
    if user is not None:
        await send_email(
            user.email,
            "Your data export is ready",
            [
                f"Hi {user.full_name},",
                "The copy of your personal data you requested is ready to "
                "download. For your security the download link expires in 7 days.",
            ],
            f"{settings.PUBLIC_WEB_URL}/app/profile/privacy",
            "Download my data",
        )


@task("privacy.retention_sweep")
async def retention_sweep(organisation_id: str | None = None) -> dict[str, Any]:
    """Apply each organisation's retention policy. Never deletes audit logs."""
    totals = {
        "organisations": 0,
        "notifications_deleted": 0,
        "ai_messages_deleted": 0,
        "ai_sessions_deleted": 0,
    }
    async with system_session() as db:
        stmt = select(Organisation).where(Organisation.deleted_at.is_(None))
        if organisation_id:
            stmt = stmt.where(Organisation.id == uuid.UUID(organisation_id))
        orgs = (await db.execute(stmt)).scalars().all()
    for org in orgs:
        async with system_session() as db:  # one transaction per org keeps locks short
            result = await sweep_org(db, org)
        totals["organisations"] += 1
        for k in ("notifications_deleted", "ai_messages_deleted", "ai_sessions_deleted"):
            totals[k] += result[k]
    log.info("privacy.retention_sweep", **totals)
    return totals
