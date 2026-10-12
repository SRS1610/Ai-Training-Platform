"""Grading events complete the quiz / assignment / simulation lessons that link to the graded item."""

from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.events import subscribe
from app.modules.progress.service import complete_linked_lessons


@subscribe("assessment.attempt_graded")
async def on_attempt_graded(db: AsyncSession, payload: dict[str, Any]) -> None:
    await complete_linked_lessons(db, payload, field="assessment_id", item_key="assessment_id")


@subscribe("submission.graded")
async def on_submission_graded(db: AsyncSession, payload: dict[str, Any]) -> None:
    await complete_linked_lessons(db, payload, field="assignment_id", item_key="assignment_id")


@subscribe("simulation.completed")
async def on_simulation_completed(db: AsyncSession, payload: dict[str, Any]) -> None:
    await complete_linked_lessons(db, payload, field="simulation_id", item_key="simulation_id")
