"""Database engine, session management and tenant (RLS) binding.

Every transaction re-applies the tenant context via ``set_config(..., is_local => true)`` so that
PostgreSQL row-level-security policies see the active organisation even after intermediate commits.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import Depends
from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import Session

from app.core.config import settings

_engine: AsyncEngine | None = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None

TENANT_KEY = "org_id"
BYPASS_KEY = "rls_bypass"


def get_engine() -> AsyncEngine:
    global _engine
    if _engine is None:
        _engine = create_async_engine(
            settings.DATABASE_URL,
            echo=settings.DATABASE_ECHO,
            pool_size=settings.DATABASE_POOL_SIZE,
            max_overflow=settings.DATABASE_MAX_OVERFLOW,
            pool_pre_ping=settings.DATABASE_POOL_PRE_PING,
            pool_recycle=settings.DATABASE_POOL_RECYCLE_SECONDS,
        )
    return _engine


def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    global _sessionmaker
    if _sessionmaker is None:
        _sessionmaker = async_sessionmaker(get_engine(), expire_on_commit=False, autoflush=False)
    return _sessionmaker


async def dispose_engine() -> None:
    global _engine, _sessionmaker
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _sessionmaker = None


_SET_TENANT_SQL = text(
    "SELECT set_config('app.org_id', :org_id, true), set_config('app.rls_bypass', :bypass, true)"
)


@event.listens_for(Session, "after_begin")
def _apply_tenant_context(session: Session, transaction, connection) -> None:  # noqa: ANN001
    org_id = session.info.get(TENANT_KEY)
    bypass = session.info.get(BYPASS_KEY, False)
    if not org_id and not bypass:
        # Nothing to bind: both settings are only ever set transaction-locally (``is_local => true``),
        # so a new transaction already sees the fail-closed defaults (no tenant, no bypass). Skipping
        # the statement saves a round trip at the start of every request.
        return
    connection.execute(
        _SET_TENANT_SQL, {"org_id": str(org_id) if org_id else "", "bypass": "on" if bypass else "off"}
    )


async def bind_tenant(session: AsyncSession, org_id: uuid.UUID | None, *, bypass: bool = False) -> None:
    """Bind the session (current and future transactions) to an organisation for RLS."""
    session.info[TENANT_KEY] = org_id
    session.info[BYPASS_KEY] = bypass
    await session.execute(
        _SET_TENANT_SQL, {"org_id": str(org_id) if org_id else "", "bypass": "on" if bypass else "off"}
    )


async def get_db() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency: one session per request. Auth/system lookups start with RLS bypass enabled
    for identity tables only (those tables are not under RLS); tenant binding happens in auth deps.

    Always declare it through ``DbSession`` (``Depends(get_db, scope="function")``). FastAPI runs the
    exit code of a request-scoped yield dependency only after the response has been sent, which would
    commit after the client already holds a 2xx: an immediate follow-up request could miss the write
    (e.g. a new login token answering ``401 session_revoked``), and a failed commit would be reported as
    success. Function scope commits once the endpoint has returned and its response is serialised,
    before anything is sent. Every use must carry the same scope because it is part of FastAPI's
    dependency cache key: mixing scopes would open two sessions in one request. Streaming endpoints
    must finish their database work (and commit) before they return the response."""
    async with get_sessionmaker()() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


@asynccontextmanager
async def system_session(org_id: uuid.UUID | None = None) -> AsyncIterator[AsyncSession]:
    """Session for background jobs / seeding. Bypasses RLS unless an org is given."""
    async with get_sessionmaker()() as session:
        session.info[TENANT_KEY] = org_id
        session.info[BYPASS_KEY] = org_id is None
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


@asynccontextmanager
async def tenant_scope(
    session: AsyncSession, org_id: uuid.UUID | None, *, bypass: bool = False
) -> AsyncIterator[None]:
    """Temporarily bind the session to another tenant (or bypass), restoring the previous binding."""
    prev_org, prev_bypass = session.info.get(TENANT_KEY), session.info.get(BYPASS_KEY, False)
    await bind_tenant(session, org_id, bypass=bypass)
    try:
        yield
    finally:
        await bind_tenant(session, prev_org, bypass=prev_bypass)


# The one way to inject the request session (see ``get_db`` for why the scope matters).
DbSession = Depends(get_db, scope="function")
