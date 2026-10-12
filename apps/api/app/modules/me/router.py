"""/me: the signed-in user's profile, organisations and effective permissions in the active org."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import Ctx, get_ctx, get_current_user
from app.core.db import get_db
from app.models.identity import User
from app.models.tenancy import MembershipStatus, OrganisationUser

router = APIRouter(prefix="/me", tags=["me"])


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    full_name: str
    avatar_url: str | None
    locale: str
    timezone: str
    email_verified: bool = False
    mfa_enabled: bool
    is_superadmin: bool
    default_organisation_id: uuid.UUID | None
    preferences: dict[str, Any]
    created_at: datetime


class OrgSummary(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    kind: str
    logo_url: str | None
    branding: dict[str, Any]
    plan_code: str
    roles: list[str]


class MeOut(BaseModel):
    user: UserOut
    organisation: OrgSummary
    permissions: list[str]
    organisations: list[OrgSummary]
    settings: dict[str, Any]


class MeUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=200)
    avatar_url: str | None = Field(default=None, max_length=1024)
    locale: str | None = Field(default=None, max_length=16)
    timezone: str | None = Field(default=None, max_length=64)
    default_organisation_id: uuid.UUID | None = None
    preferences: dict[str, Any] | None = None


def _user_out(user: User) -> UserOut:
    out = UserOut.model_validate(user)
    out.email_verified = user.email_verified_at is not None
    return out


def _org_summary(m: OrganisationUser) -> OrgSummary:
    o = m.organisation
    return OrgSummary(
        id=o.id,
        name=o.name,
        slug=o.slug,
        kind=o.kind,
        logo_url=o.logo_url,
        branding=o.branding or {},
        plan_code=o.plan_code,
        roles=sorted(r.key for r in m.roles),
    )


async def _memberships(
    db: AsyncSession, user_id: uuid.UUID, known: OrganisationUser | None = None
) -> list[OrganisationUser]:
    """Active memberships (oldest first). ``known`` is the request's already-loaded membership: it is
    excluded from the query so its roles/permissions are not re-fetched (the common single-org case
    then needs one query and no ``selectin`` round trips)."""
    stmt = (
        select(OrganisationUser)
        .where(OrganisationUser.user_id == user_id, OrganisationUser.status == MembershipStatus.ACTIVE)
        .order_by(OrganisationUser.created_at)
    )
    if known is not None and known.status == MembershipStatus.ACTIVE:
        stmt = stmt.where(OrganisationUser.id != known.id)
    rows = list((await db.execute(stmt)).scalars().all())
    if known is not None and known.status == MembershipStatus.ACTIVE:
        rows = sorted([known, *rows], key=lambda m: m.created_at)
    return [m for m in rows if m.organisation.deleted_at is None]


@router.get("", response_model=MeOut)
async def me(ctx: Ctx = Depends(get_ctx)) -> MeOut:
    user = ctx.user
    memberships = await _memberships(ctx.db, user.id, ctx.membership)
    current = next((m for m in memberships if m.organisation_id == ctx.org_id), None)
    org_summary = (
        _org_summary(current)
        if current
        else OrgSummary(
            id=ctx.org.id,
            name=ctx.org.name,
            slug=ctx.org.slug,
            kind=ctx.org.kind,
            logo_url=ctx.org.logo_url,
            branding=ctx.org.branding or {},
            plan_code=ctx.org.plan_code,
            roles=["super_admin"],
        )
    )
    s = ctx.org.settings or {}
    return MeOut(
        user=_user_out(user),
        organisation=org_summary,
        permissions=sorted(ctx.permissions),
        organisations=[_org_summary(m) for m in memberships],
        settings={
            "gamification_enabled": s.get("gamification_enabled", True),
            "require_mfa": s.get("require_mfa", False),
        },
    )


@router.patch("", response_model=UserOut)
async def update_me(
    body: MeUpdate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    data = body.model_dump(exclude_unset=True)
    if "default_organisation_id" in data and data["default_organisation_id"]:
        ids = {m.organisation_id for m in await _memberships(db, user.id)}
        if data["default_organisation_id"] not in ids:
            data.pop("default_organisation_id")
    if "preferences" in data:
        data["preferences"] = {**(user.preferences or {}), **(data["preferences"] or {})}
    for k, v in data.items():
        setattr(user, k, v)
    await db.flush()
    return _user_out(user)


@router.get("/organisations", response_model=list[OrgSummary])
async def my_organisations(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return [_org_summary(m) for m in await _memberships(db, user.id)]
