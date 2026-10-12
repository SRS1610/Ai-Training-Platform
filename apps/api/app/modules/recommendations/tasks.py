"""Recommendation tasks. Importing this module also registers the event subscribers in worker processes
(which load ``tasks`` modules but not routers), so grading done by workers updates skills too."""

from __future__ import annotations

import uuid

from app.core.db import system_session
from app.modules.recommendations import events as _events  # noqa: F401 - registers subscribers
from app.modules.recommendations import service
from app.workers import task


@task("recommendations.refresh")
async def refresh(organisation_id: str, user_id: str) -> int:
    org = uuid.UUID(organisation_id)
    async with system_session(org) as db:
        return len(await service.refresh(db, org, uuid.UUID(user_id)))
