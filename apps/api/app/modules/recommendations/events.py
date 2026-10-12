"""Graded evidence → skill proficiency → refreshed recommendations.

Handlers run inside the emitting transaction; each is wrapped in a SAVEPOINT so a recommendation failure can
never roll back the grade that triggered it.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.events import subscribe
from app.modules.recommendations import service

log = structlog.get_logger(__name__)


async def _guarded(
    db: AsyncSession, payload: dict[str, Any], fn: Callable[[AsyncSession, dict[str, Any]], Awaitable[None]]
) -> None:
    try:
        async with db.begin_nested():
            await fn(db, payload)
            if payload.get("organisation_id") and payload.get("user_id"):
                await service.refresh(db, payload["organisation_id"], payload["user_id"])
    except Exception:  # noqa: BLE001 - personalisation is best effort
        log.exception("recommendations.event_failed", fn=fn.__name__)


@subscribe("assessment.attempt_graded")
async def on_attempt_graded(db: AsyncSession, payload: dict[str, Any]) -> None:
    await _guarded(db, payload, service.evidence_from_attempt)


@subscribe("submission.graded")
async def on_submission_graded(db: AsyncSession, payload: dict[str, Any]) -> None:
    await _guarded(db, payload, service.evidence_from_submission)


@subscribe("simulation.completed")
async def on_simulation_completed(db: AsyncSession, payload: dict[str, Any]) -> None:
    await _guarded(db, payload, service.evidence_from_simulation)
