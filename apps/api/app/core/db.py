"""Database engine, session management and tenant (RLS) binding.

Every transaction re-applies the tenant context via ``set_config(..., is_local => true)`` so that
PostgreSQL row-level-security policies see the active organisation even after intermediate commits.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

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
            pool_pre_ping=True,
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
    for identity tables only (those tables are not under RLS); tenant binding happens in auth deps."""
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
