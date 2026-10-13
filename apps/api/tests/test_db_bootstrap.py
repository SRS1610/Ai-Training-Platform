"""app.ops.db_bootstrap: URL parsing always; the database run when TEST_ADMIN_DATABASE_URL is set.

TEST_ADMIN_DATABASE_URL must point at a database where that user can create roles and where the vector
and pg_trgm extensions already exist or can be created (e.g. an RDS master user, or a local superuser).
"""

from __future__ import annotations

import os
import uuid

import asyncpg
import pytest

from app.ops.db_bootstrap import BootstrapError, admin_dsn, bootstrap, parse_app_url


def test_parse_app_url_sqlalchemy_and_libpq_forms():
    r = parse_app_url("postgresql+asyncpg://praxis:s3cr%40t@db.internal:5432/praxis?ssl=require")
    assert (r.name, r.password, r.database) == ("praxis", "s3cr@t", "praxis")
    assert parse_app_url("postgresql://app_user:pw@h/app_db").database == "app_db"


@pytest.mark.parametrize(
    "url",
    [
        "mysql://praxis:pw@h/praxis",  # not postgres
        "postgresql://praxis@h/praxis",  # no password
        'postgresql://pra"xis:pw@h/praxis',  # unsafe role name
        "postgresql://Praxis:pw@h/praxis",  # not a plain lower-case identifier
        "postgresql://praxis:pw@h/my-db",  # unsafe database name
    ],
)
def test_parse_app_url_rejects_unsafe_or_incomplete_urls(url):
    with pytest.raises(BootstrapError):
        parse_app_url(url)


def test_admin_dsn_drops_sqlalchemy_driver():
    assert admin_dsn("postgresql+asyncpg://a:b@h/d?sslmode=require") == "postgresql://a:b@h/d?sslmode=require"


ADMIN = os.environ.get("TEST_ADMIN_DATABASE_URL")


@pytest.mark.skipif(not ADMIN, reason="set TEST_ADMIN_DATABASE_URL to run against a database")
async def test_bootstrap_creates_unprivileged_role_and_rotates_password():
    role = f"boot_{uuid.uuid4().hex[:8]}"
    admin = await asyncpg.connect(admin_dsn(ADMIN))
    db = await admin.fetchval("SELECT current_database()")
    host = admin._addr[0] if isinstance(admin._addr, tuple) else "localhost"
    try:
        url = f"postgresql+asyncpg://{role}:first-pw@{host}:5432/{db}"
        await bootstrap(ADMIN, url, log=lambda *_: None)
        attrs = await admin.fetchrow("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1", role)
        assert attrs is not None and not attrs["rolsuper"] and not attrs["rolbypassrls"]
        await bootstrap(ADMIN, url.replace("first-pw", "second-pw"), log=lambda *_: None)
        conn = await asyncpg.connect(f"postgresql://{role}:second-pw@{host}:5432/{db}")
        assert await conn.fetchval("SELECT has_schema_privilege('public', 'CREATE')")
        await conn.close()
        with pytest.raises(asyncpg.InvalidPasswordError):
            await asyncpg.connect(f"postgresql://{role}:first-pw@{host}:5432/{db}")
    finally:
        await admin.execute(f'REVOKE ALL ON SCHEMA public FROM "{role}"')
        await admin.execute(f'REVOKE ALL ON DATABASE "{db}" FROM "{role}"')
        await admin.execute(f'DROP ROLE IF EXISTS "{role}"')
        await admin.close()


@pytest.mark.skipif(not ADMIN, reason="set TEST_ADMIN_DATABASE_URL to run against a database")
async def test_bootstrap_refuses_role_that_bypasses_rls():
    role = f"boot_{uuid.uuid4().hex[:8]}"
    admin = await asyncpg.connect(admin_dsn(ADMIN))
    db = await admin.fetchval("SELECT current_database()")
    is_super = await admin.fetchval("SELECT rolsuper FROM pg_roles WHERE rolname = current_user")
    if not is_super:
        await admin.close()
        pytest.skip("creating a BYPASSRLS role needs a superuser admin")
    try:
        await admin.execute(f"CREATE ROLE \"{role}\" LOGIN PASSWORD 'x' BYPASSRLS")
        with pytest.raises(BootstrapError, match="row-level security"):
            await bootstrap(ADMIN, f"postgresql://{role}:x@localhost:5432/{db}", log=lambda *_: None)
    finally:
        await admin.execute(f'DROP ROLE IF EXISTS "{role}"')
        await admin.close()
