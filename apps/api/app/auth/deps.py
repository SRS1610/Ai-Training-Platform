"""Authentication & authorisation dependencies.

Resolution order for credentials: ``X-API-Key`` → ``Authorization: Bearer`` → access cookie.
The active organisation comes from ``X-Organisation-Id`` (validated against membership), then the
user's default organisation, then their first active membership. Once resolved, the DB session is
bound to that organisation for PostgreSQL RLS.
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import jwt
from fastapi import Depends, Request
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.auth.rbac import ALL_CODES
from app.core.audit import write_audit
from app.core.db import bind_tenant, get_db, tenant_scope
from app.core.errors import Forbidden, NotFound, Unauthorized
from app.core.middleware import ACCESS_COOKIE, client_ip
from app.core.security import constant_time_equals, decode_access_token, hash_token
from app.models.identity import AuthSession, User, UserStatus
from app.models.tenancy import ApiKey, MembershipStatus, Organisation, OrganisationUser, OrgStatus

ORG_HEADER = "x-organisation-id"


@dataclass
class Principal:
    user: User | None
    session_id: uuid.UUID | None = None
    api_key: ApiKey | None = None
    mfa_verified: bool = False

    @property
    def user_id(self) -> uuid.UUID | None:
        return self.user.id if self.user else None

    @property
    def is_superadmin(self) -> bool:
        return bool(self.user and self.user.is_superadmin)

    @property
    def label(self) -> str:
        if self.api_key:
            return f"api_key:{self.api_key.prefix}"
        return self.user.email if self.user else "anonymous"


@dataclass
class Ctx:
    """Request context passed to services: who, which tenant, which permissions, DB session."""

    db: AsyncSession
    principal: Principal
    org: Organisation
    membership: OrganisationUser | None
    permissions: set[str] = field(default_factory=set)
    request_id: str | None = None
    ip: str | None = None
    user_agent: str | None = None

    @property
    def org_id(self) -> uuid.UUID:
        return self.org.id

    @property
    def user_id(self) -> uuid.UUID:
        if not self.principal.user:
            raise Forbidden("This operation requires a user account")
        return self.principal.user.id

    @property
    def user(self) -> User:
        if not self.principal.user:
            raise Forbidden("This operation requires a user account")
        return self.principal.user

    def can(self, *codes: str) -> bool:
        return all(c in self.permissions for c in codes)

    def can_any(self, *codes: str) -> bool:
        return any(c in self.permissions for c in codes)

    def require(self, *codes: str) -> None:
        missing = [c for c in codes if c not in self.permissions]
        if missing:
            raise Forbidden("Missing permission", details={"missing": missing})

    async def audit(
        self, action: str, entity_type: str | None = None, entity_id: Any = None, **meta: Any
    ) -> None:
        await write_audit(
            self.db,
            action=action,
            organisation_id=self.org_id,
            actor_user_id=self.principal.user_id,
            actor_type="api_key" if self.principal.api_key else "user",
            actor_label=self.principal.label,
            entity_type=entity_type,
            entity_id=entity_id,
            meta=meta or None,
            ip_address=self.ip,
            user_agent=self.user_agent,
            request_id=self.request_id,
        )


def _extract_bearer(request: Request) -> str | None:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return request.cookies.get(ACCESS_COOKIE)


async def _principal_from_api_key(db: AsyncSession, raw: str) -> Principal:
    # Format: pk_<prefix>_<secret>
    parts = raw.split("_", 2)
    if len(parts) != 3 or parts[0] != "pk":
        raise Unauthorized("Invalid API key")
    now = datetime.now(UTC)
    async with tenant_scope(db, None, bypass=True):  # key lookup precedes tenant resolution
        key = await db.scalar(select(ApiKey).where(ApiKey.prefix == parts[1]))
        if (
            not key
            or key.revoked_at
            or (key.expires_at and key.expires_at < now)
            or not constant_time_equals(key.key_hash, hash_token(raw))
        ):
            raise Unauthorized("Invalid API key")
        await db.execute(update(ApiKey).where(ApiKey.id == key.id).values(last_used_at=now))
    return Principal(user=None, api_key=key, mfa_verified=True)


async def get_optional_principal(request: Request, db: AsyncSession = Depends(get_db)) -> Principal | None:
    cached = getattr(request.state, "principal", None)
    if cached is not None:
        return cached
    api_key = request.headers.get("x-api-key")
    if api_key:
        principal = await _principal_from_api_key(db, api_key)
        request.state.principal = principal
        return principal
    token = _extract_bearer(request)
    if not token:
        return None
    try:
        claims = decode_access_token(token)
    except jwt.PyJWTError as exc:
        raise Unauthorized("Invalid or expired access token", code="token_invalid") from exc
    # Session (revocation / expiry) and user are loaded in one round trip; both are still checked on
    # every request.
    row = (
        await db.execute(
            select(AuthSession, User)
            .outerjoin(User, User.id == uuid.UUID(claims["sub"]))
            .where(AuthSession.id == uuid.UUID(claims["sid"]))
        )
    ).first()
    session, user = row if row is not None else (None, None)
    if not session or session.revoked_at or session.expires_at < datetime.now(UTC):
        raise Unauthorized("Session has been revoked", code="session_revoked")
    if not user or user.id != session.user_id or user.status != UserStatus.ACTIVE or user.deleted_at:
        raise Unauthorized("Account is not active")
    principal = Principal(user=user, session_id=session.id, mfa_verified=bool(claims.get("mfa")))
    request.state.principal = principal
    return principal


async def get_principal(principal: Principal | None = Depends(get_optional_principal)) -> Principal:
    if principal is None:
        raise Unauthorized("Authentication required")
    return principal


async def get_current_user(principal: Principal = Depends(get_principal)) -> User:
    if not principal.user:
        raise Forbidden("This endpoint requires a user session")
    return principal.user


async def _permissions_for(
    db: AsyncSession, membership: OrganisationUser | None, principal: Principal
) -> set[str]:
    if principal.api_key:
        return set(principal.api_key.scopes or []) & ALL_CODES - {"system.manage"}
    perms: set[str] = set()
    if membership and membership.status == MembershipStatus.ACTIVE:
        for role in membership.roles:
            perms.update(p.code for p in role.permissions)
    if principal.is_superadmin:
        perms = set(ALL_CODES)
    return perms


async def _load_membership(db: AsyncSession, *where: Any) -> OrganisationUser | None:
    """Membership with its organisation and roles joined (role permissions follow in one ``selectin``
    query), saving a round trip over the default loaders. Permissions are still read fresh per request."""
    stmt = select(OrganisationUser).options(joinedload(OrganisationUser.roles)).where(*where)
    result = await db.execute(stmt)
    return result.unique().scalars().first()


async def resolve_ctx(request: Request, db: AsyncSession, principal: Principal) -> Ctx:
    cached = getattr(request.state, "ctx", None)
    if cached is not None:
        return cached
    membership: OrganisationUser | None = None
    org: Organisation | None = None
    if principal.api_key:
        org = await db.get(Organisation, principal.api_key.organisation_id)
    else:
        assert principal.user is not None
        header = request.headers.get(ORG_HEADER)
        org_id: uuid.UUID | None = None
        if header:
            try:
                org_id = uuid.UUID(header)
            except ValueError as exc:
                raise NotFound("Organisation not found") from exc
        else:
            org_id = principal.user.default_organisation_id
        if org_id:
            membership = await _load_membership(
                db,
                OrganisationUser.organisation_id == org_id,
                OrganisationUser.user_id == principal.user.id,
            )
        if membership is None and not header:
            first_id = await db.scalar(
                select(OrganisationUser.id)
                .where(
                    OrganisationUser.user_id == principal.user.id,
                    OrganisationUser.status == MembershipStatus.ACTIVE,
                )
                .order_by(OrganisationUser.created_at)
                .limit(1)
            )
            if first_id is not None:
                membership = await _load_membership(db, OrganisationUser.id == first_id)
        if membership is not None:
            org = membership.organisation
        elif org_id and principal.is_superadmin:
            org = await db.get(Organisation, org_id)
        if membership is not None and membership.status != MembershipStatus.ACTIVE:
            raise Forbidden("Your membership in this organisation is not active", code="membership_inactive")
    if org is None or org.deleted_at is not None:
        raise Forbidden("No access to this organisation", code="no_organisation")
    if org.status != OrgStatus.ACTIVE and not principal.is_superadmin:
        raise Forbidden("Organisation is suspended", code="organisation_suspended")
    if (
        principal.user
        and (org.settings or {}).get("require_mfa")
        and not principal.user.mfa_enabled
        and not request.url.path.startswith(("/api/v1/me", "/api/v1/auth"))
    ):
        raise Forbidden("Your organisation requires multi-factor authentication", code="mfa_required")

    await bind_tenant(db, org.id)
    ctx = Ctx(
        db=db,
        principal=principal,
        org=org,
        membership=membership,
        permissions=await _permissions_for(db, membership, principal),
        request_id=getattr(request.state, "request_id", None),
        ip=client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )
    request.state.ctx = ctx
    return ctx


async def get_ctx(
    request: Request, db: AsyncSession = Depends(get_db), principal: Principal = Depends(get_principal)
) -> Ctx:
    return await resolve_ctx(request, db, principal)


def require_permission(*codes: str, any_of: bool = False) -> Callable[..., Awaitable[Ctx]]:
    """Dependency factory: ``ctx: Ctx = Depends(require_permission("courses.edit"))``."""

    async def _dep(ctx: Ctx = Depends(get_ctx)) -> Ctx:
        ok = ctx.can_any(*codes) if any_of else ctx.can(*codes)
        if not ok:
            raise Forbidden(
                "You do not have permission to perform this action", details={"required": list(codes)}
            )
        return ctx

    return _dep


async def require_superadmin(request: Request, ctx: Ctx = Depends(get_ctx)) -> Ctx:
    if not ctx.principal.is_superadmin:
        raise Forbidden("Super admin access required")
    await bind_tenant(ctx.db, ctx.org_id, bypass=True)  # platform views span tenants
    return ctx
