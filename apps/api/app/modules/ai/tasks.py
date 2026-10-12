"""Background tasks: budget alerts and AI grading (contracts — other modules enqueue these by name)."""

from __future__ import annotations

import uuid

import structlog
from sqlalchemy import select

from app.core.db import system_session
from app.models.ai import AIConfiguration, AIUsage
from app.modules.ai import gateway, grading
from app.workers import task

log = structlog.get_logger(__name__)


@task("ai.budget_check")
async def budget_check(organisation_id: str | None = None) -> dict[str, list[int]]:
    """Evaluate monthly AI budget thresholds (50/75/90/100% by default) for one or all organisations,
    creating de-duplicated AIBudgetAlert rows and notifying org admins."""
    if organisation_id:
        org_ids = [uuid.UUID(organisation_id)]
    else:
        async with system_session() as db:
            with_usage = set(
                (
                    await db.scalars(
                        select(AIUsage.organisation_id)
                        .distinct()
                        .where(AIUsage.created_at >= gateway.month_start())
                    )
                ).all()
            )
            org_ids = sorted(
                with_usage | set((await db.scalars(select(AIConfiguration.organisation_id))).all())
            )
    out: dict[str, list[int]] = {}
    for oid in org_ids:
        try:
            async with system_session(oid) as db:
                created = await gateway.check_budget_alerts(db, oid)
            if created:
                out[str(oid)] = created
        except Exception:  # noqa: BLE001 - one bad org must not stop the sweep
            log.exception("ai.budget_check_failed", organisation_id=str(oid))
    return out


@task("ai.grade_submission")
async def grade_submission(submission_id: str, organisation_id: str) -> str | None:
    org = uuid.UUID(organisation_id)
    async with system_session(org) as db:
        grade = await grading.grade_submission(db, uuid.UUID(submission_id), org)
        return str(grade.id) if grade else None


@task("ai.grade_attempt_answers")
async def grade_attempt_answers(attempt_id: str, organisation_id: str) -> list[str]:
    org = uuid.UUID(organisation_id)
    async with system_session(org) as db:
        grades = await grading.grade_attempt_answers(db, uuid.UUID(attempt_id), org)
        return [str(g.id) for g in grades]
