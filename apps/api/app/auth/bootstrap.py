"""Idempotent seeding of the permission catalogue and system role templates; organisation bootstrap."""

from __future__ import annotations

import re
import secrets
import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.rbac import DEFAULT_ROLES, PERMISSIONS
from app.core.db import tenant_scope
from app.models.ai import AIConfiguration
from app.models.platform import Subscription
from app.models.tenancy import (
    MembershipStatus,
    Organisation,
    OrganisationUser,
    OrgKind,
    Permission,
    Role,
)


async def ensure_rbac_catalogue(session: AsyncSession) -> None:
    for p in PERMISSIONS:
        await session.execute(
            insert(Permission)
            .values(code=p.code, description=p.description, category=p.category)
            .on_conflict_do_update(
                index_elements=[Permission.code], set_={"description": p.description, "category": p.category}
            )
        )
    perms = {p.code: p for p in (await session.execute(select(Permission))).scalars()}
    for key, spec in DEFAULT_ROLES.items():
        role = await session.scalar(select(Role).where(Role.organisation_id.is_(None), Role.key == key))
        if role is None:
            role = Role(
                organisation_id=None,
                key=key,
                name=spec["name"],
                description=spec["description"],
                is_system=True,
            )
            session.add(role)
        role.name, role.description = spec["name"], spec["description"]
        role.permissions = [perms[c] for c in spec["permissions"]]
    await session.flush()


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug[:60] or "org"


async def unique_org_slug(session: AsyncSession, name: str) -> str:
    base = slugify(name)
    slug = base
    while await session.scalar(select(Organisation.id).where(Organisation.slug == slug)):
        slug = f"{base}-{secrets.token_hex(3)}"
    return slug


async def copy_system_roles(session: AsyncSession, org_id: uuid.UUID) -> dict[str, Role]:
    templates = (await session.execute(select(Role).where(Role.organisation_id.is_(None)))).scalars().all()
    roles: dict[str, Role] = {}
    for t in templates:
        r = Role(
            organisation_id=org_id,
            key=t.key,
            name=t.name,
            description=t.description,
            is_system=True,
            permissions=list(t.permissions),
        )
        session.add(r)
        roles[t.key] = r
    await session.flush()
    return roles


async def create_organisation(
    session: AsyncSession,
    *,
    name: str,
    owner_user_id: uuid.UUID | None,
    kind: str = OrgKind.BUSINESS,
    owner_role_keys: tuple[str, ...] = ("org_admin",),
    plan_code: str = "free",
) -> Organisation:
    org = Organisation(
        name=name,
        slug=await unique_org_slug(session, name),
        kind=kind,
        plan_code=plan_code,
        settings={"gamification_enabled": True, "retention_days": 2555, "require_mfa": False},
        branding={"primary_color": "#4f46e5"},
    )
    session.add(org)
    await session.flush()
    async with tenant_scope(session, org.id):
        await _bootstrap_org(session, org, owner_user_id, owner_role_keys, plan_code)
    return org


async def _bootstrap_org(
    session: AsyncSession,
    org: Organisation,
    owner_user_id: uuid.UUID | None,
    owner_role_keys: tuple[str, ...],
    plan_code: str,
) -> None:
    roles = await copy_system_roles(session, org.id)
    session.add(
        AIConfiguration(
            organisation_id=org.id,
            features={
                "tutor": True,
                "content_generation": True,
                "grading": True,
                "simulation_ai": True,
                "recommendations": True,
            },
            tutor_behaviour={"tone": "encouraging", "socratic": True, "cite_sources": True},
            monthly_budget_usd=None,  # None = use the plan's AI budget (billing/plans.py)
        )
    )
    session.add(Subscription(organisation_id=org.id, plan_code=plan_code, status="active", seats=1))
    if owner_user_id:
        session.add(
            OrganisationUser(
                organisation_id=org.id,
                user_id=owner_user_id,
                status=MembershipStatus.ACTIVE,
                joined_at=datetime.now(UTC),
                roles=[roles[k] for k in owner_role_keys if k in roles],
            )
        )
    await session.flush()
