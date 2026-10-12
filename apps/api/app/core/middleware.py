"""HTTP middleware: request ids, access logs, security headers, CSRF (double submit) and global rate limit."""

from __future__ import annotations

import time
import uuid

import structlog
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

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


def client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        request_id = request.headers.get("x-request-id") or uuid.uuid4().hex
        request.state.request_id = request_id
        structlog.contextvars.bind_contextvars(request_id=request_id)
        start = time.perf_counter()
        try:
            response = await call_next(request)
        finally:
            structlog.contextvars.clear_contextvars()
        elapsed_ms = round((time.perf_counter() - start) * 1000, 1)
        response.headers["x-request-id"] = request_id
        response.headers["server-timing"] = f"app;dur={elapsed_ms}"
        if request.url.path != "/api/v1/health":
            log.info(
                "request",
                method=request.method,
                path=request.url.path,
                status=response.status_code,
                ms=elapsed_ms,
                request_id=request_id,
            )
        metrics.observe_request(request.method, request.scope.get("route"), response.status_code, elapsed_ms)
        return response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)
        h = response.headers
        h.setdefault("X-Content-Type-Options", "nosniff")
        h.setdefault("X-Frame-Options", "DENY")
        h.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        h.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        h.setdefault("Cross-Origin-Opener-Policy", "same-origin")
        if request.url.path.startswith(("/api/docs", "/api/redoc")):
            h.setdefault(
                "Content-Security-Policy",
                "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
                "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: https:",
            )
        else:
            h.setdefault("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
        if settings.COOKIE_SECURE:
            h.setdefault("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload")
        if request.url.path.startswith("/api/v1/auth") or request.url.path.startswith("/api/v1/me"):
            h.setdefault("Cache-Control", "no-store")
        return response


class CSRFMiddleware(BaseHTTPMiddleware):
    """Double-submit-cookie CSRF protection for cookie-authenticated, state-changing requests.

    Requests authenticated by ``Authorization`` header or ``X-API-Key`` are not vulnerable to CSRF
    (browsers do not attach those automatically) and are exempt.
    """

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        if (
            request.method not in SAFE_METHODS
            and request.cookies.get(ACCESS_COOKIE)
            and not request.headers.get("authorization")
            and not request.headers.get("x-api-key")
            and not request.url.path.endswith(CSRF_EXEMPT_SUFFIXES)
        ):
            cookie = request.cookies.get(CSRF_COOKIE, "")
            header = request.headers.get(CSRF_HEADER, "")
            if not cookie or not header or not constant_time_equals(cookie, header):
                return JSONResponse(
                    {"error": {"code": "csrf_failed", "message": "CSRF token missing or invalid"}},
                    status_code=403,
                )
        return await call_next(request)


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Coarse global limit per client; finer per-user / per-feature limits are applied in dependencies."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        path = request.url.path
        if path.startswith("/api/") and path not in ("/api/v1/health", "/api/v1/billing/webhook"):
            ident = request.headers.get("x-api-key", "")[:16] or client_ip(request)
            limit = settings.RATE_LIMIT_DEFAULT_PER_MINUTE
            try:
                if "/auth/" in path and request.method != "GET":
                    await rl.hit(f"auth:{client_ip(request)}", settings.RATE_LIMIT_AUTH_PER_MINUTE)
                await rl.hit(f"global:{ident}", limit)
            except TooManyRequests as exc:
                return JSONResponse(
                    {"error": {"code": exc.code, "message": exc.message}},
                    status_code=429,
                    headers={"Retry-After": str(exc.retry_after)},
                )
        return await call_next(request)
