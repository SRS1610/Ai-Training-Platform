"""HTTP middleware: request ids, access logs, security headers, CSRF (double submit) and global rate limit."""

from __future__ import annotations

import time
import uuid

import structlog
from starlette.datastructures import Headers, MutableHeaders
from starlette.requests import HTTPConnection
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core import redis as rl
from app.core.config import settings
from app.core.errors import TooManyRequests
from app.core.metrics import metrics
from app.core.security import constant_time_equals

log = structlog.get_logger("http")

ACCESS_COOKIE = "praxis_access"
REFRESH_COOKIE = "praxis_refresh"
CSRF_COOKIE = "praxis_csrf"
CSRF_HEADER = "x-csrf-token"
SAFE_METHODS = {"GET", "HEAD", "OPTIONS", "TRACE"}
# Endpoints that establish a session or are called by third parties (signature verified separately).
CSRF_EXEMPT_SUFFIXES = (
    "/auth/login",
    "/auth/register",
    "/auth/refresh",
    "/auth/mfa/verify",
    "/auth/password/forgot",
    "/auth/password/reset",
    "/auth/email/verify",
    "/billing/webhook",
)


def client_ip(request: HTTPConnection) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


# The middlewares below are plain ASGI callables rather than ``BaseHTTPMiddleware`` subclasses: each
# BaseHTTPMiddleware layer spawns a task group and re-streams the response, which cost ~0.4 ms per layer
# per request (four layers ≈ 1.6 ms, more than a typical primary-key query). Behaviour is unchanged.


class RequestContextMiddleware:
    """Request id (``X-Request-Id``), ``Server-Timing``, structured access log and request metrics."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        request_id = Headers(scope=scope).get("x-request-id") or uuid.uuid4().hex
        scope.setdefault("state", {})["request_id"] = request_id
        structlog.contextvars.bind_contextvars(request_id=request_id)
        start = time.perf_counter()
        status_code = 500
        elapsed_ms = 0.0

        async def send_wrapper(message: Message) -> None:
            nonlocal status_code, elapsed_ms
            if message["type"] == "http.response.start":
                status_code = message["status"]
                elapsed_ms = round((time.perf_counter() - start) * 1000, 1)
                headers = MutableHeaders(scope=message)
                headers["x-request-id"] = request_id
                headers["server-timing"] = f"app;dur={elapsed_ms}"
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            structlog.contextvars.clear_contextvars()
        path = scope["path"]
        if path != "/api/v1/health":
            log.info(
                "request",
                method=scope["method"],
                path=path,
                status=status_code,
                ms=elapsed_ms,
                request_id=request_id,
            )
        metrics.observe_request(scope["method"], scope.get("route"), status_code, elapsed_ms)


_CSP_DOCS = (
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: https:"
)
_CSP_API = "default-src 'none'; frame-ancestors 'none'"


class SecurityHeadersMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        path: str = scope["path"]

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                h = MutableHeaders(scope=message)
                h.setdefault("X-Content-Type-Options", "nosniff")
                h.setdefault("X-Frame-Options", "DENY")
                h.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
                h.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
                h.setdefault("Cross-Origin-Opener-Policy", "same-origin")
                h.setdefault(
                    "Content-Security-Policy",
                    _CSP_DOCS if path.startswith(("/api/docs", "/api/redoc")) else _CSP_API,
                )
                if settings.COOKIE_SECURE:
                    h.setdefault("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload")
                if path.startswith(("/api/v1/auth", "/api/v1/me")):
                    h.setdefault("Cache-Control", "no-store")
            await send(message)

        await self.app(scope, receive, send_wrapper)


class CSRFMiddleware:
    """Double-submit-cookie CSRF protection for cookie-authenticated, state-changing requests.

    Requests authenticated by ``Authorization`` header or ``X-API-Key`` are not vulnerable to CSRF
    (browsers do not attach those automatically) and are exempt.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope["method"] not in SAFE_METHODS:
            conn = HTTPConnection(scope)
            if (
                conn.cookies.get(ACCESS_COOKIE)
                and not conn.headers.get("authorization")
                and not conn.headers.get("x-api-key")
                and not scope["path"].endswith(CSRF_EXEMPT_SUFFIXES)
            ):
                cookie = conn.cookies.get(CSRF_COOKIE, "")
                header = conn.headers.get(CSRF_HEADER, "")
                if not cookie or not header or not constant_time_equals(cookie, header):
                    response = JSONResponse(
                        {"error": {"code": "csrf_failed", "message": "CSRF token missing or invalid"}},
                        status_code=403,
                    )
                    await response(scope, receive, send)
                    return
        await self.app(scope, receive, send)


class RateLimitMiddleware:
    """Coarse global limit per client; finer per-user / per-feature limits are applied in dependencies."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and settings.RATE_LIMIT_ENABLED:
            path: str = scope["path"]
            if path.startswith("/api/") and path not in ("/api/v1/health", "/api/v1/billing/webhook"):
                conn = HTTPConnection(scope)
                ident = conn.headers.get("x-api-key", "")[:16] or client_ip(conn)
                try:
                    if "/auth/" in path and scope["method"] != "GET":
                        await rl.hit(f"auth:{client_ip(conn)}", settings.RATE_LIMIT_AUTH_PER_MINUTE)
                    await rl.hit(f"global:{ident}", settings.RATE_LIMIT_DEFAULT_PER_MINUTE)
                except TooManyRequests as exc:
                    response = JSONResponse(
                        {"error": {"code": exc.code, "message": exc.message}},
                        status_code=429,
                        headers={"Retry-After": str(exc.retry_after)},
                    )
                    await response(scope, receive, send)
                    return
        await self.app(scope, receive, send)
