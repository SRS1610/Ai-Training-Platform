"""Domain exceptions mapped to consistent JSON error responses."""

from __future__ import annotations

from typing import Any

import structlog
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

log = structlog.get_logger(__name__)


class AppError(Exception):
    status_code = 400
    code = "bad_request"

    def __init__(self, message: str = "", *, details: Any = None, code: str | None = None) -> None:
        super().__init__(message or self.code)
        self.message = message or self.code.replace("_", " ").capitalize()
        self.details = details
        if code:
            self.code = code


class BadRequest(AppError):
    status_code = 400
    code = "bad_request"


class Unauthorized(AppError):
    status_code = 401
    code = "unauthorized"


class Forbidden(AppError):
    status_code = 403
    code = "forbidden"


class NotFound(AppError):
    status_code = 404
    code = "not_found"


class Conflict(AppError):
    status_code = 409
    code = "conflict"


class Unprocessable(AppError):
    status_code = 422
    code = "unprocessable"


class TooManyRequests(AppError):
    status_code = 429
    code = "rate_limited"

    def __init__(self, message: str = "Too many requests", *, retry_after: int = 60, **kw: Any) -> None:
        super().__init__(message, **kw)
        self.retry_after = retry_after


class PaymentRequired(AppError):
    status_code = 402
    code = "plan_limit"


class ServiceUnavailable(AppError):
    status_code = 503
    code = "service_unavailable"


def _body(code: str, message: str, details: Any = None, request_id: str | None = None) -> dict[str, Any]:
    err: dict[str, Any] = {"code": code, "message": message}
    if details is not None:
        err["details"] = details
    if request_id:
        err["request_id"] = request_id
    return {"error": err}


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(request: Request, exc: AppError) -> JSONResponse:
        headers = {}
        if isinstance(exc, TooManyRequests):
            headers["Retry-After"] = str(exc.retry_after)
        return JSONResponse(
            _body(exc.code, exc.message, exc.details, getattr(request.state, "request_id", None)),
            status_code=exc.status_code,
            headers=headers,
        )

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, exc: RequestValidationError) -> JSONResponse:
        details = [
            {"loc": list(e.get("loc", [])), "msg": e.get("msg"), "type": e.get("type")} for e in exc.errors()
        ]
        return JSONResponse(
            _body("validation_error", "Request validation failed", details, getattr(request.state, "request_id", None)),
            status_code=422,
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = {401: "unauthorized", 403: "forbidden", 404: "not_found", 405: "method_not_allowed"}.get(
            exc.status_code, "http_error"
        )
        return JSONResponse(
            _body(code, str(exc.detail), None, getattr(request.state, "request_id", None)),
            status_code=exc.status_code,
            headers=getattr(exc, "headers", None),
        )

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        log.exception("unhandled_error", path=request.url.path)
        return JSONResponse(
            _body("internal_error", "An unexpected error occurred", None, getattr(request.state, "request_id", None)),
            status_code=500,
        )
