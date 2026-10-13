"""Effective grading policy: who makes the final decision on a submission or an open-ended answer.

The organisation's AI settings carry a grading mode (``AIConfiguration.grading_mode``) and every assignment /
assessment has its own. The mode that applies is the STRICTER of the two:

    manual  >  ai_recommend_human_final  >  ai_assisted

``high_stakes`` always forces at least ``ai_recommend_human_final`` (a person makes the final decision).

* ``ai_assisted`` — AI grades and its grade is final (a person may override later);
* ``ai_recommend_human_final`` — AI grades as a recommendation (``is_final=False``) awaiting a human;
* ``manual`` — no AI grading at all; the work waits in the grading queue for a person.

Assessments also have ``auto`` (objective items auto-scored, open-ended answers graded by a person), which is
as strict as ``manual`` as far as AI grading is concerned.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ai import AIConfiguration

AI_ASSISTED = "ai_assisted"
HUMAN_FINAL = "ai_recommend_human_final"
MANUAL = "manual"
AUTO = "auto"

_STRICTNESS = {AI_ASSISTED: 0, HUMAN_FINAL: 1, MANUAL: 2, AUTO: 2}
AI_GRADING_MODES = frozenset({AI_ASSISTED, HUMAN_FINAL})


def stricter(*modes: str | None) -> str:
    """The strictest of ``modes`` (empty values ignored; unknown values count as ``manual``). On a tie the
    earliest wins, so an item's own ``auto`` is kept when the organisation says ``manual``."""
    best: str | None = None
    for mode in modes:
        if not mode:
            continue
        if mode not in _STRICTNESS:
            mode = MANUAL
        if best is None or _STRICTNESS[mode] > _STRICTNESS[best]:
            best = mode
    return best or AI_ASSISTED


def effective_mode(org_mode: str | None, *item_modes: str | None, high_stakes: bool = False) -> str:
    mode = stricter(*item_modes, org_mode)
    if high_stakes and _STRICTNESS[mode] < _STRICTNESS[HUMAN_FINAL]:
        mode = HUMAN_FINAL
    return mode


def ai_may_grade(mode: str) -> bool:
    return mode in AI_GRADING_MODES


def ai_grade_is_final(mode: str) -> bool:
    return mode == AI_ASSISTED


async def org_grading_mode(db: AsyncSession, organisation_id: uuid.UUID) -> str:
    mode = await db.scalar(
        select(AIConfiguration.grading_mode).where(AIConfiguration.organisation_id == organisation_id)
    )
    return mode or AI_ASSISTED


async def assignment_mode(db: AsyncSession, assignment: Any, *, org_mode: str | None = None) -> str:
    """Effective grading mode for an ``Assignment`` (pass ``org_mode`` to avoid a lookup per row)."""
    if org_mode is None:
        org_mode = await org_grading_mode(db, assignment.organisation_id)
    return effective_mode(org_mode, assignment.grading_mode, high_stakes=bool(assignment.high_stakes))


async def assessment_mode(db: AsyncSession, assessment: Any, *, org_mode: str | None = None) -> str:
    """Effective grading mode for an ``Assessment``'s open-ended answers."""
    if org_mode is None:
        org_mode = await org_grading_mode(db, assessment.organisation_id)
    return effective_mode(org_mode, assessment.grading_mode, high_stakes=bool(assessment.high_stakes))


async def attempt_mode(db: AsyncSession, attempt: Any, assessment: Any | None) -> str:
    """Effective mode for an attempt: settings frozen at attempt start, the live assessment and the org's
    current mode — whichever is strictest (a policy tightened mid-attempt still applies)."""
    snap = attempt.settings_snapshot or {}
    org_mode = await org_grading_mode(db, attempt.organisation_id)
    live_mode = getattr(assessment, "grading_mode", None)
    high_stakes = bool(snap.get("high_stakes")) or bool(getattr(assessment, "high_stakes", False))
    return effective_mode(org_mode, snap.get("grading_mode"), live_mode, high_stakes=high_stakes)
