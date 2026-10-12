"""Audit trail writer. Records are hash-chained per organisation (tamper evident) and immutable
(database trigger rejects UPDATE/DELETE). Written in the same transaction as the audited change."""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.platform import AuditLog

GENESIS = "0" * 64


def _canonical(record: dict[str, Any]) -> str:
    return json.dumps(record, sort_keys=True, default=str, separators=(",", ":"))


def compute_hash(prev_hash: str, record: dict[str, Any]) -> str:
    return hashlib.sha256((prev_hash + _canonical(record)).encode()).hexdigest()


async def write_audit(
    session: AsyncSession,
    *,
    action: str,
    organisation_id: uuid.UUID | None,
    actor_user_id: uuid.UUID | None = None,
    actor_type: str = "user",
    actor_label: str | None = None,
    entity_type: str | None = None,
    entity_id: Any = None,
    meta: dict[str, Any] | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
    request_id: str | None = None,
) -> AuditLog:
    chain_key = str(organisation_id or "platform")
    # Serialise writers per chain for the remainder of this transaction.
    await session.execute(text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": "audit:" + chain_key})
    prev = await session.scalar(
        select(AuditLog.hash)
        .where(
            AuditLog.organisation_id == organisation_id
            if organisation_id
            else AuditLog.organisation_id.is_(None)
        )
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .limit(1)
    )
    created_at = datetime.now(UTC)
    record = {
        "created_at": created_at.isoformat(),
        "organisation_id": str(organisation_id) if organisation_id else None,
        "actor_user_id": str(actor_user_id) if actor_user_id else None,
        "actor_type": actor_type,
        "action": action,
        "entity_type": entity_type,
        "entity_id": str(entity_id) if entity_id is not None else None,
        "metadata": meta or {},
    }
    prev_hash = prev or GENESIS
    entry = AuditLog(
        created_at=created_at,
        organisation_id=organisation_id,
        actor_user_id=actor_user_id,
        actor_type=actor_type,
        actor_label=actor_label,
        action=action,
        entity_type=entity_type,
        entity_id=record["entity_id"],
        meta=meta or {},
        ip_address=ip_address,
        user_agent=(user_agent or "")[:512] or None,
        request_id=request_id,
        prev_hash=prev_hash,
        hash=compute_hash(prev_hash, record),
    )
    session.add(entry)
    await session.flush()
    return entry


async def verify_chain(session: AsyncSession, organisation_id: uuid.UUID | None) -> dict[str, Any]:
    """Recompute the hash chain; returns the first broken link if any."""
    stmt = select(AuditLog).order_by(AuditLog.created_at.asc(), AuditLog.id.asc())
    stmt = stmt.where(
        AuditLog.organisation_id == organisation_id if organisation_id else AuditLog.organisation_id.is_(None)
    )
    prev = GENESIS
    count = 0
    for entry in (await session.execute(stmt)).scalars():
        record = {
            "created_at": entry.created_at.astimezone(UTC).isoformat(),
            "organisation_id": str(entry.organisation_id) if entry.organisation_id else None,
            "actor_user_id": str(entry.actor_user_id) if entry.actor_user_id else None,
            "actor_type": entry.actor_type,
            "action": entry.action,
            "entity_type": entry.entity_type,
            "entity_id": entry.entity_id,
            "metadata": entry.meta or {},
        }
        if entry.prev_hash != prev or compute_hash(prev, record) != entry.hash:
            return {"valid": False, "checked": count, "broken_at": str(entry.id)}
        prev = entry.hash
        count += 1
    return {"valid": True, "checked": count}
