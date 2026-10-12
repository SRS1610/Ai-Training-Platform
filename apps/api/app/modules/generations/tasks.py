"""Generation worker task."""

from __future__ import annotations

import uuid

from app.core.db import system_session
from app.modules.generations.service import run_generation
from app.workers import task


@task("ai.run_generation")
async def run(generation_id: str, organisation_id: str) -> str | None:
    org = uuid.UUID(organisation_id)
    async with system_session(org) as db:
        gen = await run_generation(db, uuid.UUID(generation_id), org)
        return gen.status if gen else None
