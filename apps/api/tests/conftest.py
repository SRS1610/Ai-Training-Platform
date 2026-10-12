"""Test harness: real PostgreSQL (non-superuser role, so RLS is enforced), ASGI client, account factories.

Set TEST_DATABASE_URL to use a different database (e.g. one per parallel worker).
"""

from __future__ import annotations

import os

os.environ.setdefault("ENVIRONMENT", "test")
os.environ["DATABASE_URL"] = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+asyncpg://praxis:praxis@localhost:5432/praxis_test"
)
os.environ.setdefault("RATE_LIMIT_ENABLED", "false")
os.environ.setdefault("CELERY_TASK_ALWAYS_EAGER", "true")
os.environ.setdefault("AI_DEFAULT_PROVIDER", "offline")
os.environ.setdefault("LOCAL_STORAGE_PATH", "/tmp/praxis-test-storage")
os.environ.setdefault("EMAIL_PROVIDER", "console")

import pytest  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.auth.bootstrap import ensure_rbac_catalogue  # noqa: E402
from app.core.db import get_engine, get_sessionmaker  # noqa: E402
from app.core.rls import AUDIT_IMMUTABLE_SQL, CERTIFICATE_SEQUENCE_SQL, rls_enable_sql  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Base, rls_tables  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
async def database():
    engine = get_engine()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.execute(text("DROP SEQUENCE IF EXISTS certificate_number_seq"))
        await conn.run_sync(Base.metadata.create_all)
        for table in rls_tables():
            for stmt in rls_enable_sql(table):
                await conn.execute(text(stmt))
        for stmt in AUDIT_IMMUTABLE_SQL + CERTIFICATE_SEQUENCE_SQL:
            await conn.execute(text(stmt))
    async with get_sessionmaker()() as session:
        session.info["rls_bypass"] = True
        await ensure_rbac_catalogue(session)
        await session.commit()
    yield
    await engine.dispose()


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture
async def db():
    """Raw session with RLS bypass for assertions / arranging data."""
    async with get_sessionmaker()() as session:
        session.info["rls_bypass"] = True
        yield session
        await session.rollback()
