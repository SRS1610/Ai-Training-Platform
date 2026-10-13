"""Demo / development seeder.

    cd apps/api
    python -m app.seed                    # seed if the database has no demo data (idempotent)
    python -m app.seed --reset            # DEV ONLY: drop everything, migrate, seed from scratch
    python -m app.seed --if-empty         # docker compose: quietly skip when demo data exists
    python -m app.seed --profile minimal  # smaller dataset (used by tests)

All accounts use the password ``Praxis-Demo-2026!``.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys


def _configure_env() -> None:
    # Must happen before anything imports app.core.config.
    os.environ["CELERY_TASK_ALWAYS_EAGER"] = "true"  # background work runs in-process and is drained
    os.environ["AI_DEFAULT_PROVIDER"] = "offline"  # deterministic, keyless AI for the seed itself
    os.environ.setdefault("RATE_LIMIT_ENABLED", "false")  # thousands of in-process calls from one "client"
    os.environ.setdefault("DATABASE_POOL_PRE_PING", "false")
    os.environ.setdefault("LOG_LEVEL", "WARNING")
    os.environ.setdefault("EMAIL_PROVIDER", "console")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.seed", description="Seed Praxis demo data.")
    parser.add_argument("--reset", action="store_true", help="DEV ONLY: drop all tables, migrate and reseed")
    parser.add_argument(
        "--if-empty",
        action="store_true",
        help="skip (exit 0) when complete demo data already exists; a partial seed still exits 1",
    )
    parser.add_argument("--profile", choices=("full", "minimal"), default="full")
    args = parser.parse_args(argv)
    _configure_env()

    from app.core.config import settings
    from app.core.logging import configure_logging
    from app.seed import runner

    configure_logging()
    host = settings.DATABASE_URL.split("@")[-1]
    if settings.is_production:
        # Demo accounts share a published password: never create them in production.
        print("[seed] refused: the demo seeder does not run in production", file=sys.stderr)
        return 2
    if args.reset:
        try:
            method = runner.reset_database()
        except runner.SeedRefused as exc:
            print(f"[seed] refused: {exc}", file=sys.stderr)
            return 2
        print(f"[seed] database {host} reset ({method})")

    async def go() -> int:
        from app.core.db import dispose_engine

        try:
            existing = await runner.existing_seed()
            if existing:
                print(
                    f"[seed] demo data already present (profile {existing.get('profile')}, seeded "
                    f"{existing.get('seeded_at')}); nothing to do. Use --reset to rebuild."
                )
                return 0
            if existing is not None:
                # A partial dataset (an earlier run failed part-way) is never "not empty": fail loudly,
                # with --if-empty too, so docker compose doesn't report a broken demo as seeded.
                print(
                    "[seed] found a partial demo dataset (an earlier run failed?). Re-run with --reset.",
                    file=sys.stderr,
                )
                return 1
            print(f"[seed] seeding {host} with the '{args.profile}' profile…")
            summary = await runner.seed(args.profile)
            runner.print_summary(summary)
            return 0
        finally:
            await dispose_engine()

    return asyncio.run(go())


if __name__ == "__main__":
    sys.exit(main())
