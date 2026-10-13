"""Prepare a managed PostgreSQL database (e.g. RDS) for Praxis. Idempotent; run before every migration.

Run as ``python -m app.ops.db_bootstrap`` with:
  ADMIN_DATABASE_URL  master credentials, e.g. ``postgresql://praxis_admin:…@host:5432/praxis?sslmode=require``
  DATABASE_URL        the application's URL, e.g. ``postgresql+asyncpg://praxis:…@host:5432/praxis?ssl=require``

It connects with the master credentials and:
  1. creates the ``vector`` and ``pg_trgm`` extensions (migrations cannot: the app role is not privileged);
  2. creates the application role from DATABASE_URL, or resets its password to match DATABASE_URL;
  3. refuses to continue if that role is a superuser or has BYPASSRLS, because row-level security (tenant
     isolation) would then not apply to the application;
  4. grants it CONNECT on the database and USAGE + CREATE on schema ``public`` so migrations can run.

No secret values are printed.
"""

from __future__ import annotations

import asyncio
import os
import re
import sys
from dataclasses import dataclass
from urllib.parse import unquote, urlsplit

import asyncpg

EXTENSIONS = ("vector", "pg_trgm")
_ROLE_ATTRS = "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1"
_IDENT = re.compile(r"^[a-z_][a-z0-9_]{0,62}$")


class BootstrapError(RuntimeError):
    pass


@dataclass(frozen=True)
class AppRole:
    name: str
    password: str
    database: str


def parse_app_url(url: str) -> AppRole:
    """Role, password and database name from a SQLAlchemy or libpq style PostgreSQL URL."""
    parts = urlsplit(url)
    if not parts.scheme.startswith("postgres"):
        raise BootstrapError("DATABASE_URL must be a postgresql URL")
    name, password = unquote(parts.username or ""), unquote(parts.password or "")
    database = parts.path.lstrip("/")
    if not _IDENT.match(name):
        raise BootstrapError("the DATABASE_URL user must be a plain lower-case identifier")
    if not password:
        raise BootstrapError("DATABASE_URL must include a password")
    if not _IDENT.match(database):
        raise BootstrapError("the DATABASE_URL database must be a plain lower-case identifier")
    return AppRole(name, password, database)


def admin_dsn(url: str) -> str:
    """asyncpg accepts libpq URLs; drop a SQLAlchemy driver suffix if one was supplied."""
    return re.sub(r"^postgresql\+\w+://", "postgresql://", url)


def _refuse_if_privileged(name: str, row) -> None:  # noqa: ANN001
    if row["rolsuper"] or row["rolbypassrls"]:
        raise BootstrapError(
            f"role {name!r} is a superuser or has BYPASSRLS, so row-level security would not isolate "
            "tenants. Use a dedicated non-privileged role for the application."
        )


async def bootstrap(admin_url: str, app_url: str, log=print) -> None:  # noqa: ANN001
    role = parse_app_url(app_url)
    conn = await asyncpg.connect(admin_dsn(admin_url))
    try:
        current_db = await conn.fetchval("SELECT current_database()")
        if current_db != role.database:
            raise BootstrapError(
                f"ADMIN_DATABASE_URL points at database {current_db!r} "
                f"but DATABASE_URL uses {role.database!r}"
            )
        for ext in EXTENSIONS:
            await conn.execute(f"CREATE EXTENSION IF NOT EXISTS {ext}")
        log(f"extensions ready: {', '.join(EXTENSIONS)}")

        existing = await conn.fetchrow(_ROLE_ATTRS, role.name)
        if existing is not None:
            _refuse_if_privileged(role.name, existing)
            stmt = "SELECT format('ALTER ROLE %I WITH LOGIN PASSWORD %L', $1::text, $2::text)"
            await conn.execute(await conn.fetchval(stmt, role.name, role.password))
            log(f"role {role.name!r} exists: password synchronised with DATABASE_URL")
        else:
            stmt = (
                "SELECT format('CREATE ROLE %I WITH LOGIN PASSWORD %L "
                "NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS', $1::text, $2::text)"
            )
            await conn.execute(await conn.fetchval(stmt, role.name, role.password))
            log(f"role {role.name!r} created")

        _refuse_if_privileged(role.name, await conn.fetchrow(_ROLE_ATTRS, role.name))

        grant_connect = "SELECT format('GRANT CONNECT ON DATABASE %I TO %I', $1::text, $2::text)"
        await conn.execute(await conn.fetchval(grant_connect, role.database, role.name))
        await conn.execute(await conn.fetchval(
            "SELECT format('GRANT USAGE, CREATE ON SCHEMA public TO %I', $1::text)", role.name
        ))
        log(f"grants ready: CONNECT on {role.database!r}, USAGE + CREATE on schema public")
    finally:
        await conn.close()


def main() -> int:
    admin_url, app_url = os.environ.get("ADMIN_DATABASE_URL"), os.environ.get("DATABASE_URL")
    if not admin_url or not app_url:
        print("ADMIN_DATABASE_URL and DATABASE_URL must both be set", file=sys.stderr)
        return 2
    try:
        asyncio.run(bootstrap(admin_url, app_url))
    except (BootstrapError, OSError, asyncpg.PostgresError) as exc:
        print(f"db-bootstrap failed: {exc}", file=sys.stderr)
        return 1
    print("db-bootstrap complete")
    return 0


if __name__ == "__main__":
    sys.exit(main())
