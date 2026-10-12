"""Certificates are issued automatically when a learner completes a course."""

from __future__ import annotations

from typing import Any

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.events import subscribe
from app.modules.certificates import service

log = structlog.get_logger(__name__)


@subscribe("course.completed")
async def issue_on_course_completed(db: AsyncSession, payload: dict[str, Any]) -> None:
    """Issue (idempotently) when the course awards certificates and the final score meets the threshold.

    Runs in a SAVEPOINT so a certificate failure never rolls back the learner's course completion.
    """
    try:
        async with db.begin_nested():
            await service.on_course_completed(db, payload)
    except Exception:
        log.exception(
            "certificate.auto_issue_failed",
            course_id=str(payload.get("course_id")),
            user_id=str(payload.get("user_id")),
        )
