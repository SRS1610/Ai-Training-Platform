"""Seeder orchestration: reset (dev only), idempotency checks, build, finalise, summary."""

from __future__ import annotations

import asyncio
import random
import time
import uuid
from pathlib import Path
from typing import Any

from sqlalchemy import select, text

from app.core.config import settings

API_DIR = Path(__file__).resolve().parents[2]
DEMO_ORG = "Northwind Technologies"


class SeedRefused(RuntimeError):
    pass


# ============================================================================================ reset


async def _drop_everything() -> None:
    from sqlalchemy.ext.asyncio import create_async_engine

    from app.models import Base

    engine = create_async_engine(settings.DATABASE_URL)
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            for stmt in (
                "DROP TABLE IF EXISTS alembic_version",
                "DROP SEQUENCE IF EXISTS certificate_number_seq",
                "DROP FUNCTION IF EXISTS audit_logs_immutable() CASCADE",
            ):
                await conn.execute(text(stmt))
    finally:
        await engine.dispose()


async def _create_from_models() -> None:
    from sqlalchemy.ext.asyncio import create_async_engine

    from app.core.rls import AUDIT_IMMUTABLE_SQL, CERTIFICATE_SEQUENCE_SQL, rls_enable_sql
    from app.models import Base, rls_tables

    engine = create_async_engine(settings.DATABASE_URL)
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
            for table in rls_tables():
                for stmt in rls_enable_sql(table):
                    await conn.execute(text(stmt))
            for stmt in AUDIT_IMMUTABLE_SQL + CERTIFICATE_SEQUENCE_SQL:
                await conn.execute(text(stmt))
    finally:
        await engine.dispose()


def reset_database(log: Any = print) -> str:
    """Drop every table and rebuild the schema with ``alembic upgrade head`` (falling back to the models +
    RLS statements, as the test-suite does). Development and test environments only."""
    if settings.ENVIRONMENT in ("production", "staging"):
        raise SeedRefused(f"--reset is disabled in {settings.ENVIRONMENT}")
    asyncio.run(_drop_everything())
    try:
        from alembic.config import Config

        from alembic import command

        cfg = Config(str(API_DIR / "alembic.ini"))
        cfg.set_main_option("script_location", str(API_DIR / "alembic"))
        command.upgrade(cfg, "head")
        method = "alembic upgrade head"
    except Exception as exc:  # pragma: no cover - fallback path
        log(f"[seed] alembic upgrade failed ({type(exc).__name__}: {exc}); building schema from models")
        asyncio.run(_drop_everything())
        asyncio.run(_create_from_models())
        method = "Base.metadata.create_all + RLS"
    return method


# ============================================================================================ seed


async def existing_seed() -> dict[str, Any] | None:
    from app.core.db import get_sessionmaker
    from app.models.identity import User
    from app.seed import people as P
    from app.seed.history import find_seed

    marker = await find_seed(DEMO_ORG)
    if marker is not None:
        return marker
    async with get_sessionmaker()() as db:
        db.info["rls_bypass"] = True
        if await db.scalar(select(User.id).where(User.email == P.SUPERADMIN["email"])):
            return {}
    return None


async def seed(profile: str = "full", *, api: Any = None, log: Any = print) -> dict[str, Any]:
    """Build the demo dataset in the configured database. Returns a summary."""
    from app.auth.bootstrap import ensure_rbac_catalogue
    from app.core.db import get_sessionmaker
    from app.seed.api import Api
    from app.seed.build import Seeder
    from app.seed.history import billing_and_usage, finalise, mark_seeded
    from app.workers import drain, run_task

    t0 = time.perf_counter()
    async with get_sessionmaker()() as s:
        s.info["rls_bypass"] = True
        await ensure_rbac_catalogue(s)
        await s.commit()
    own_api = api is None
    api = api or Api.in_process()
    try:
        sd = Seeder(api, profile, log)
        summary = await sd.run()
        t1 = time.perf_counter()
        stats = await finalise(sd.tl, sd.org_ids, sd.user_ids, sd.rng)
        nw_users = [lr.actor.user_id for lr in sd.learners.values()]
        stats.update(
            await billing_and_usage(
                sd.nw,
                sd.contoso,
                nw_users or [sd.staff["admin"].user_id],
                [
                    uuid.UUID(c.id)
                    for k, c in sd.courses.items()
                    if k in ("it", "cs", "cyber", "whs", "privacy")
                ],
                random.Random(7),
            )
        )
        # Live, "today" state: recommendations and due-date reminders.
        for lr in sd.learners.values():
            await api.post("/recommendations/me/refresh", lr.actor)
        await run_task("notifications.due_reminders")
        await drain()
        await mark_seeded(sd.nw, profile, summary)
        summary["stats"] = stats
        summary["api_calls"] = api.calls
        summary["timing"] = {"build_s": round(t1 - t0, 1), "total_s": round(time.perf_counter() - t0, 1)}
        summary["counts"] = await counts(sd.org_ids)
        summary["profile"] = profile
        return summary
    finally:
        if own_api:
            await api.aclose()


async def counts(org_ids: list[uuid.UUID]) -> dict[str, int]:
    from app.core.db import get_sessionmaker

    tables = [
        "users",
        "courses",
        "course_versions",
        "lessons",
        "questions",
        "enrolments",
        "lesson_progress",
        "assessment_attempts",
        "submissions",
        "grades",
        "simulation_sessions",
        "certificates",
        "ai_messages",
        "ai_generations",
        "knowledge_chunks",
        "notifications",
        "points_ledger",
        "user_badges",
        "recommendations",
        "ai_usage",
        "payments",
        "activity_days",
        "audit_logs",
    ]
    out: dict[str, int] = {}
    async with get_sessionmaker()() as db:
        db.info["rls_bypass"] = True
        await db.execute(text("SELECT set_config('app.rls_bypass', 'on', true)"))
        for t in tables:
            if t == "users":
                q = text(
                    "SELECT count(DISTINCT user_id) FROM organisation_users WHERE organisation_id = ANY(:o)"
                )
            else:
                q = text(f'SELECT count(*) FROM "{t}" WHERE organisation_id = ANY(:o)')  # noqa: S608
            out[t] = int((await db.execute(q, {"o": org_ids})).scalar() or 0)
    return out


def print_summary(summary: dict[str, Any], log: Any = print) -> None:
    from app.seed import people as P

    log("")
    log("=" * 96)
    log(
        f"Praxis demo data ready  (profile: {summary.get('profile')}, "
        f"{summary.get('api_calls')} API calls, {summary.get('timing', {}).get('total_s')}s)"
    )
    log("=" * 96)
    log(f"Password for every account: {P.PASSWORD}")
    log("")
    log(f"{'Email':<30} {'Name':<20} {'Role':<36} Organisation")
    log("-" * 96)
    for a in summary["accounts"]:
        log(f"{a['email']:<30} {a['name']:<20} {a['role']:<36} {a['org']}")
    others = [x for x in P.LEARNERS if summary.get("profile") == "full" or x[0] in P.MINIMAL_LEARNERS]
    log(
        f"{'<first.last>@northwind.demo':<30} {f'{len(others)} more learners':<20} {'learner':<36} {DEMO_ORG}"
    )
    log("")
    c = summary.get("counts", {})
    log("Data: " + ", ".join(f"{k}={v}" for k, v in c.items()))
    log("")
