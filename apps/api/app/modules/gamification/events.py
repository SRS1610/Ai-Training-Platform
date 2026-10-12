"""Event subscribers awarding points, recording activity days and evaluating badges."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.events import subscribe
from app.modules.gamification import service as g
from app.modules.notifications.service import safe_handler


def _ids(p: dict[str, Any]) -> tuple[uuid.UUID, uuid.UUID]:
    return uuid.UUID(str(p["organisation_id"])), uuid.UUID(str(p["user_id"]))


async def _after(db: AsyncSession, org_id: uuid.UUID, user_id: uuid.UUID) -> None:
    await g.evaluate_badges(db, org_id, user_id)


async def _prepare(db: AsyncSession, p: dict[str, Any]) -> tuple[uuid.UUID, uuid.UUID, bool]:
    await db.flush()  # make the emitter's pending rows visible to badge criteria queries (autoflush is off)
    org_id, user_id = _ids(p)
    await g.record_activity(db, org_id, user_id)
    return org_id, user_id, await g.org_enabled(db, org_id)


@subscribe("lesson.completed")
@safe_handler
async def on_lesson_completed(db: AsyncSession, p: dict[str, Any]) -> None:
    org_id, user_id, enabled = await _prepare(db, p)
    if not enabled:
        return
    await g.award_points(
        db, org_id, user_id, g.POINTS["lesson_completed"], "lesson_completed", "lesson", p.get("lesson_id")
    )
    await _after(db, org_id, user_id)


@subscribe("assessment.attempt_graded")
@safe_handler
async def on_attempt_graded(db: AsyncSession, p: dict[str, Any]) -> None:
    org_id, user_id, enabled = await _prepare(db, p)
    if not enabled:
        return
    if p.get("passed"):
        pct = float(p.get("percentage") or 0)
        bonus = int(max(0.0, min(pct, 100.0)) // 10) * 5  # up to +50 for a perfect score
        await g.award_points(
            db,
            org_id,
            user_id,
            g.POINTS["assessment_passed"] + bonus,
            "assessment_passed",
            "assessment",
            p.get("assessment_id"),
        )
    await _after(db, org_id, user_id)


@subscribe("submission.graded")
@safe_handler
async def on_submission_graded(db: AsyncSession, p: dict[str, Any]) -> None:
    org_id, user_id, enabled = await _prepare(db, p)
    if not enabled:
        return
    if p.get("passed"):
        await g.award_points(
            db,
            org_id,
            user_id,
            g.POINTS["assignment_passed"],
            "assignment_passed",
            "assignment",
            p.get("assignment_id"),
        )
    await _after(db, org_id, user_id)


@subscribe("simulation.completed")
@safe_handler
async def on_simulation_completed(db: AsyncSession, p: dict[str, Any]) -> None:
    org_id, user_id, enabled = await _prepare(db, p)
    if not enabled:
        return
    band = str(p.get("band") or "").lower()
    target = g.SIMULATION_BAND_POINTS.get(band, g.SIMULATION_DEFAULT_POINTS[bool(p.get("passed"))])
    if p.get("simulation_id"):
        # Best-of per simulation: repeating a simulation only earns the improvement.
        await g.award_top_up(
            db, org_id, user_id, target, "simulation_completed", "simulation", p["simulation_id"]
        )
    await _after(db, org_id, user_id)


@subscribe("course.completed")
@safe_handler
async def on_course_completed(db: AsyncSession, p: dict[str, Any]) -> None:
    org_id, user_id, enabled = await _prepare(db, p)
    if not enabled:
        return
    await g.award_points(
        db, org_id, user_id, g.POINTS["course_completed"], "course_completed", "course", p.get("course_id")
    )
    await _after(db, org_id, user_id)


@subscribe("certificate.issued")
@safe_handler
async def on_certificate_issued(db: AsyncSession, p: dict[str, Any]) -> None:
    org_id, user_id, enabled = await _prepare(db, p)
    if not enabled:
        return
    await g.award_points(
        db,
        org_id,
        user_id,
        g.POINTS["certificate_issued"],
        "certificate_issued",
        "certificate",
        p.get("certificate_id"),
    )
    await _after(db, org_id, user_id)
