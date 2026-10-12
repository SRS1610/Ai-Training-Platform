"""FastAPI application factory. Feature modules are discovered automatically: every
``app/modules/<name>/router.py`` exposing ``router`` (and optionally ``public_router``) is mounted
under the API prefix, so modules can be developed independently."""

from __future__ import annotations

import importlib
import pkgutil
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from sqlalchemy import text

import app.modules as modules_pkg
from app.auth.bootstrap import ensure_rbac_catalogue
from app.core.config import settings
from app.core.db import dispose_engine, get_sessionmaker
from app.core.errors import register_error_handlers
from app.core.logging import configure_logging
from app.core.metrics import metrics
from app.core.middleware import (
    CSRFMiddleware,
    RateLimitMiddleware,
    RequestContextMiddleware,
    SecurityHeadersMiddleware,
)
from app.core.redis import close_redis, get_redis


def discover_routers() -> list[APIRouter]:
    routers: list[APIRouter] = []
    for mod in sorted(pkgutil.iter_modules(modules_pkg.__path__), key=lambda m: m.name):
        if not mod.ispkg:
            continue
        try:
            module = importlib.import_module(f"app.modules.{mod.name}.router")
        except ModuleNotFoundError as exc:
            if exc.name == f"app.modules.{mod.name}.router":
                continue
            raise
        for attr in ("router", "public_router"):
            r = getattr(module, attr, None)
            if isinstance(r, APIRouter):
                routers.append(r)
    return routers


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging()
    settings.validate_production()
    async with get_sessionmaker()() as session:
        session.info["rls_bypass"] = True
        await ensure_rbac_catalogue(session)
        await session.commit()
    yield
    await close_redis()
    await dispose_engine()


def create_app() -> FastAPI:
    app = FastAPI(
        title=f"{settings.APP_NAME} API",
        version="1.0.0",
        description="AI-powered Training Management System: learn → practice → simulate → perform → assess → improve.",
        openapi_url=f"{settings.API_PREFIX}/openapi.json",
        docs_url="/api/docs",
        redoc_url="/api/redoc",
        lifespan=lifespan,
    )
    register_error_handlers(app)
    # Order: last added runs first.
    app.add_middleware(CSRFMiddleware)
    app.add_middleware(RateLimitMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-CSRF-Token", "X-Organisation-Id", "X-API-Key",
                       "X-Request-Id"],
    )
    app.add_middleware(RequestContextMiddleware)

    @app.get(f"{settings.API_PREFIX}/health", tags=["system"])
    async def health() -> dict:
        checks: dict[str, str] = {}
        try:
            async with get_sessionmaker()() as s:
                await s.execute(text("SELECT 1"))
            checks["database"] = "ok"
        except Exception as exc:  # pragma: no cover
            checks["database"] = f"error: {type(exc).__name__}"
        try:
            await get_redis().ping()
            checks["redis"] = "ok"
        except Exception as exc:
            checks["redis"] = f"degraded: {type(exc).__name__}"
        status = "ok" if checks["database"] == "ok" else "error"
        return {"status": status, "checks": checks, "environment": settings.ENVIRONMENT, "version": app.version}

    @app.get(f"{settings.API_PREFIX}/metrics", include_in_schema=False)
    async def prometheus_metrics() -> PlainTextResponse:
        return PlainTextResponse(metrics.prometheus())

    for router in discover_routers():
        app.include_router(router, prefix=settings.API_PREFIX)
    return app


app = create_app()
