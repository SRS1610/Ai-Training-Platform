"""Organisation profile, branding, policy settings, custom domains and creating additional organisations."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.bootstrap import create_organisation
from app.auth.deps import Ctx
from app.core.audit import write_audit
from app.core.errors import BadRequest, Conflict
from app.models.identity import User
from app.models.tenancy import Organisation
from app.modules.billing import plans
from app.modules.organisations import domains
from app.modules.organisations.schemas import DomainStatus, OrgCreate, OrgOut, OrgSettingsOut, OrgUpdate

SETTING_KEYS = ("gamification_enabled", "require_mfa", "retention_days", "default_locale")
FEATURES = (
    "ai_tutor",
    "simulations",
    "ai_generation",
    "analytics_advanced",
    "sso",
    "custom_branding",
    "api_access",
    "gamification",
)


def org_out(org: Organisation) -> OrgOut:
    s = org.settings or {}
    defaults = OrgSettingsOut()
    return OrgOut(
        id=org.id,
        name=org.name,
        slug=org.slug,
        kind=org.kind,
        status=org.status,
        logo_url=org.logo_url,
        branding=org.branding or {},
        custom_domain=org.custom_domain,
        custom_domain_verified=org.custom_domain_verified_at is not None,
        custom_domain_verified_at=org.custom_domain_verified_at,
        plan_code=org.plan_code,
        settings=OrgSettingsOut(**{k: s.get(k, getattr(defaults, k)) for k in SETTING_KEYS}),
        features={f: plans.has_feature(org, f) for f in FEATURES},
        created_at=org.created_at,
    )


async def update_current(ctx: Ctx, body: OrgUpdate) -> OrgOut:
    """Partial update. Branding / logo require the ``custom_branding`` plan feature."""
    org = ctx.org
    data = body.model_dump(exclude_unset=True, mode="json")
    changes: dict[str, Any] = {}
    if "name" in data and data["name"]:
        changes["name"] = data["name"].strip()
        org.name = changes["name"]
    if "logo_url" in data or "branding" in data:
        plans.require_feature(org, "custom_branding")
    if "logo_url" in data:
        org.logo_url = data["logo_url"]
        changes["logo_url"] = data["logo_url"]
    if data.get("branding") is not None:
        incoming = body.branding.model_dump(exclude_unset=True, mode="json") if body.branding else {}
        merged = {**(org.branding or {})}
        for k, v in incoming.items():
            if v is None:
                merged.pop(k, None)
            else:
                merged[k] = v
        org.branding = merged
        changes["branding"] = incoming
    if data.get("settings") is not None:
        incoming = {
            k: v
            for k, v in (body.settings.model_dump(exclude_unset=True) if body.settings else {}).items()
            if v is not None
        }
        if incoming.get("require_mfa") and ctx.principal.user and not ctx.principal.user.mfa_enabled:
            raise BadRequest(
                "Enable multi-factor authentication on your own account before requiring it",
                code="mfa_required_for_admin",
            )
        org.settings = {**(org.settings or {}), **incoming}
        changes["settings"] = incoming
    await ctx.db.flush()
    if changes:
        await ctx.audit("organisation.updated", "organisation", org.id, changes=changes)
    await ctx.db.refresh(org)
    return org_out(org)


def domain_status(org: Organisation, status: str | None = None) -> DomainStatus:
    if not org.custom_domain:
        return DomainStatus(domain=None, verified=False, verified_at=None, status="none")
    verified = org.custom_domain_verified_at is not None
    info = domains.instructions(org.id, org.custom_domain)
    return DomainStatus(
        domain=org.custom_domain,
        verified=verified,
        verified_at=org.custom_domain_verified_at,
        status=status or ("verified" if verified else "pending"),
        **info,
    )


async def set_domain(ctx: Ctx, raw_domain: str) -> DomainStatus:
    plans.require_feature(ctx.org, "custom_branding")
    domain = domains.normalise_domain(raw_domain)
    taken = await ctx.db.scalar(
        select(Organisation.id).where(Organisation.custom_domain == domain, Organisation.id != ctx.org_id)
    )
    if taken:
        raise Conflict("This domain is already in use by another organisation", code="domain_taken")
    if ctx.org.custom_domain != domain:
        ctx.org.custom_domain = domain
        ctx.org.custom_domain_verified_at = None
        await ctx.db.flush()
        await ctx.audit("organisation.domain_set", "organisation", ctx.org_id, domain=domain)
    return domain_status(ctx.org)


async def remove_domain(ctx: Ctx) -> None:
    if ctx.org.custom_domain:
        old = ctx.org.custom_domain
        ctx.org.custom_domain = None
        ctx.org.custom_domain_verified_at = None
        await ctx.db.flush()
        await ctx.audit("organisation.domain_removed", "organisation", ctx.org_id, domain=old)


async def verify_domain(ctx: Ctx) -> DomainStatus:
    plans.require_feature(ctx.org, "custom_branding")
    org = ctx.org
    if not org.custom_domain:
        raise BadRequest("Set a custom domain first", code="no_domain")
    if org.custom_domain_verified_at:
        return domain_status(org)
    status = await domains.check(org.id, org.custom_domain)
    if status == "verified":
        org.custom_domain_verified_at = datetime.now(UTC)
        await ctx.db.flush()
        await ctx.audit("organisation.domain_verified", "organisation", org.id, domain=org.custom_domain)
    return domain_status(org, status)


async def create_additional(db: AsyncSession, user: User, body: OrgCreate, ip: str | None) -> OrgOut:
    """Create a new organisation; the caller becomes its org_admin."""
    org = await create_organisation(db, name=body.name.strip(), owner_user_id=user.id, kind=body.kind)
    if user.default_organisation_id is None:
        user.default_organisation_id = org.id
    await write_audit(
        db,
        action="organisation.created",
        organisation_id=org.id,
        actor_user_id=user.id,
        actor_label=user.email,
        entity_type="organisation",
        entity_id=org.id,
        ip_address=ip,
        meta={"name": org.name, "kind": org.kind},
    )
    await db.refresh(org)
    return org_out(org)
