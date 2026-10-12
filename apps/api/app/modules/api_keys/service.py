"""Organisation-bound API keys (``pk_<prefix>_<secret>``) with an explicit permission scope subset."""

from __future__ import annotations

import secrets
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.auth.deps import Ctx
from app.auth.rbac import ORG_CODES
from app.core import security
from app.core.errors import BadRequest, Forbidden, NotFound
from app.core.pagination import PageParams, paginate
from app.models.tenancy import ApiKey
from app.modules.api_keys.schemas import ApiKeyCreate, ApiKeyCreated, ApiKeyOut
from app.modules.billing import plans

PREFIX_LEN = 10


def _status(key: ApiKey) -> str:
    if key.revoked_at:
        return "revoked"
    if key.expires_at and key.expires_at < datetime.now(UTC):
        return "expired"
    return "active"


def to_out(key: ApiKey) -> ApiKeyOut:
    out = ApiKeyOut.model_validate(key)
    out.status = _status(key)
    return out


def _require_user_and_feature(ctx: Ctx) -> None:
    if ctx.principal.api_key:
        raise Forbidden("API keys cannot manage API keys", code="api_key_forbidden")
    plans.require_feature(ctx.org, "api_access")


async def create_key(ctx: Ctx, body: ApiKeyCreate) -> ApiKeyCreated:
    _require_user_and_feature(ctx)
    scopes = sorted(set(body.scopes))
    invalid = [s for s in scopes if s not in ORG_CODES]
    if invalid:
        raise BadRequest(
            "Unknown or non-assignable scope(s)", code="invalid_scope", details={"scopes": invalid}
        )
    excess = [s for s in scopes if s not in ctx.permissions]
    if excess:
        raise Forbidden(
            "API key scopes must be a subset of your own permissions",
            code="privilege_escalation",
            details={"scopes": excess},
        )
    prefix = secrets.token_hex(PREFIX_LEN // 2)  # hex: never contains the "_" separator
    raw = f"pk_{prefix}_{security.generate_token(32)}"
    key = ApiKey(
        organisation_id=ctx.org_id,
        name=body.name.strip(),
        prefix=prefix,
        key_hash=security.hash_token(raw),
        scopes=scopes,
        created_by=ctx.user_id,
        expires_at=datetime.now(UTC) + timedelta(days=body.expires_in_days) if body.expires_in_days else None,
    )
    ctx.db.add(key)
    await ctx.db.flush()
    await ctx.db.refresh(key)
    await ctx.audit("api_key.created", "api_key", key.id, name=key.name, prefix=prefix, scopes=scopes)
    return ApiKeyCreated(**to_out(key).model_dump(), key=raw)


async def list_keys(ctx: Ctx, params: PageParams, include_revoked: bool) -> tuple[list[ApiKey], int]:
    _require_user_and_feature(ctx)
    stmt = select(ApiKey).where(ApiKey.organisation_id == ctx.org_id)
    if not include_revoked:
        stmt = stmt.where(ApiKey.revoked_at.is_(None))
    return await paginate(ctx.db, stmt.order_by(ApiKey.created_at.desc()), params)


async def revoke_key(ctx: Ctx, key_id: uuid.UUID) -> None:
    if ctx.principal.api_key:
        raise Forbidden("API keys cannot manage API keys", code="api_key_forbidden")
    key = await ctx.db.scalar(select(ApiKey).where(ApiKey.id == key_id, ApiKey.organisation_id == ctx.org_id))
    if key is None:
        raise NotFound("API key not found")
    if not key.revoked_at:
        key.revoked_at = datetime.now(UTC)
        await ctx.db.flush()
        await ctx.audit("api_key.revoked", "api_key", key.id, name=key.name, prefix=key.prefix)
