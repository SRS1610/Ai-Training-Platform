"""Course completion is evidence for the skills linked to the completed course version."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.events import subscribe
from app.models.content import CourseVersion, Skill
from app.modules.skills.service import record_evidence


@subscribe("course.completed")
async def on_course_completed(db: AsyncSession, payload: dict[str, Any]) -> None:
    snapshot = await db.scalar(
        select(CourseVersion.snapshot).where(CourseVersion.id == payload.get("course_version_id"))
    )
    ids = []
    for sk in ((snapshot or {}).get("course") or {}).get("skills") or []:
        try:
            ids.append(uuid.UUID(str(sk["id"])))
        except (KeyError, ValueError):
            continue
    if not ids:
        return
    # skills may have been deleted since publication
    ids = list(
        (
            await db.execute(
                select(Skill.id).where(Skill.id.in_(ids), Skill.organisation_id == payload["organisation_id"])
            )
        ).scalars()
    )
    score = payload.get("final_score")
    await record_evidence(
        db,
        payload["organisation_id"],
        payload["user_id"],
        ids,
        100.0 if score is None else float(score),
        source="course",
        ref_id=payload.get("course_id"),
    )
