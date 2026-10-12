"""Backdating: build ~90 days of believable history out of API calls made in a couple of minutes.

The seeder wraps groups of API calls in *spans* (``async with timeline.at(when, minutes)``). A span records
the real wall-clock interval the calls took and the historical interval they should appear to have
happened in. At the end, :func:`Timeline.apply` rewrites every timestamp column of the seeded
organisations' rows that falls inside a span with a linear mapping onto its historical interval, so the
relative order of everything that happened inside a span (enrol → start → submit → grade → certificate)
is preserved. Spans never overlap in real time (the seeder runs them sequentially), so the mapping is a
well-defined piecewise-linear function of the real timestamp.

Rows written outside any span keep their real ("today") timestamps. The audit log is append-only and
hash-chained, so it is deliberately left untouched.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import DateTime, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Base
from app.workers import drain

# Tables never rewritten: immutable / security records and global catalogues.
EXCLUDED_TABLES = {
    "audit_logs",
    "auth_sessions",
    "email_tokens",
    "stripe_events",
    "permissions",
    "seed_spans",
}


def utcnow() -> datetime:
    return datetime.now(UTC)


def days_ago(days: float, hour: int = 9, minute: int = 0, now: datetime | None = None) -> datetime:
    """A historical moment ``days`` before today at the given local-ish (UTC) time of day, never in the
    future."""
    now = now or utcnow()
    base = (now - timedelta(days=days)).replace(hour=hour, minute=minute, second=0, microsecond=0)
    return min(base, now - timedelta(minutes=5))


@dataclass
class Span:
    r0: datetime
    r1: datetime
    h0: datetime
    h1: datetime

    @property
    def scale(self) -> float:
        real = (self.r1 - self.r0).total_seconds()
        return (self.h1 - self.h0).total_seconds() / real if real > 0 else 0.0


class Timeline:
    def __init__(self) -> None:
        self.spans: list[Span] = []
        self._open = False

    @asynccontextmanager
    async def at(self, when: datetime, minutes: float = 30.0) -> AsyncIterator[None]:
        """Everything the API writes inside the block appears to have happened between ``when`` and
        ``when + minutes``. Background tasks are drained before the span closes."""
        await self.begin(when, minutes)
        try:
            yield
        finally:
            await self.end()

    async def begin(self, when: datetime, minutes: float = 30.0) -> None:
        if self._open:
            await self.end()
        self._open = True
        self._cur = (utcnow(), when, minutes)

    async def end(self) -> None:
        if not self._open:
            return
        await drain()
        self._open = False
        r0, when, minutes = self._cur
        r1 = utcnow()
        h1 = min(when + timedelta(minutes=minutes), utcnow() - timedelta(minutes=1))
        if r1 > r0 and h1 > when:
            self.spans.append(Span(r0, r1, when, h1))

    # ------------------------------------------------------------------------------------------ apply

    async def apply(self, db: AsyncSession, org_ids: list[uuid.UUID], user_ids: list[uuid.UUID]) -> int:
        """Rewrite timestamps of the seeded organisations' rows. Returns the number of column updates."""
        if not self.spans:
            return 0
        await db.execute(
            text(
                "CREATE TEMP TABLE IF NOT EXISTS seed_spans "
                "(r0 timestamptz, r1 timestamptz, h0 timestamptz, k double precision) ON COMMIT DROP"
            )
        )
        await db.execute(
            text("INSERT INTO seed_spans (r0, r1, h0, k) VALUES (:r0, :r1, :h0, :k)"),
            [{"r0": s.r0, "r1": s.r1, "h0": s.h0, "k": s.scale} for s in self.spans],
        )
        n = 0
        params: dict[str, Any] = {"orgs": org_ids, "users": user_ids}
        for table in Base.metadata.sorted_tables:
            if table.name in EXCLUDED_TABLES:
                continue
            cols = [c.name for c in table.columns if isinstance(c.type, DateTime)]
            if not cols:
                continue
            if "organisation_id" in table.columns:
                scope = "x.organisation_id = ANY(:orgs)"
            elif table.name == "organisations":
                scope = "x.id = ANY(:orgs)"
            elif table.name == "users":
                scope = "x.id = ANY(:users)"
            elif "user_id" in table.columns:
                scope = "x.user_id = ANY(:users)"
            else:
                continue
            for col in cols:
                await db.execute(
                    text(
                        f'UPDATE "{table.name}" AS x SET "{col}" = s.h0 + (x."{col}" - s.r0) * s.k '  # noqa: S608
                        f'FROM seed_spans s WHERE x."{col}" >= s.r0 AND x."{col}" < s.r1 AND {scope}'
                    ),
                    params,
                )
                n += 1
        return n
