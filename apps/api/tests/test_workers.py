"""Tasks enqueued with ``db=`` must only run after the transaction commits (never on rollback)."""

from __future__ import annotations

from sqlalchemy import text

from app import workers
from app.core.db import get_sessionmaker

ran: list[str] = []


@workers.task("test.record")
async def _record(value: str) -> None:
    ran.append(value)


async def test_enqueue_waits_for_commit_and_drops_on_rollback():
    ran.clear()
    async with get_sessionmaker()() as s:
        await s.execute(text("SELECT 1"))  # open a transaction, as a request would
        await workers.enqueue("test.record", db=s, value="rolled-back")
        await s.rollback()
        await s.execute(text("SELECT 1"))
        await workers.enqueue("test.record", db=s, value="committed")
        await workers.drain()
        assert ran == []  # held until commit
        await s.commit()
    await workers.drain()
    assert ran == ["committed"]
