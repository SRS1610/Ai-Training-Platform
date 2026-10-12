"""/gamification: my points/level/badges/streak, leaderboard, badge administration."""

from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.auth.deps import Ctx, get_ctx, require_permission
from app.core.errors import BadRequest, Conflict, Forbidden, NotFound
from app.models.platform import Badge, UserBadge
from app.models.tenancy import MembershipStatus, OrganisationUser
from app.modules.gamification import events as _events  # noqa: F401  (registers subscribers)
from app.modules.gamification import service as g
from app.modules.gamification.schemas import (
    AwardIn,
    BadgeCreate,
    BadgeListOut,
    BadgeOut,
    BadgeUpdate,
    GamificationMeOut,
    LeaderboardOut,
    OptOutIn,
)

router = APIRouter(prefix="/gamification", tags=["gamification"])

_member = require_permission("learning.access", "analytics.view", any_of=True)


@router.get("/me", response_model=GamificationMeOut)
async def my_gamification(ctx: Ctx = Depends(get_ctx)) -> GamificationMeOut:
    return GamificationMeOut.model_validate(await g.my_summary(ctx.db, ctx.org, ctx.user_id))


@router.put("/me/leaderboard-opt-out", response_model=OptOutIn)
async def set_opt_out(body: OptOutIn, ctx: Ctx = Depends(get_ctx)) -> OptOutIn:
    user = ctx.user
    user.preferences = {**(user.preferences or {}), "leaderboard_opt_out": body.opt_out}
    await ctx.db.flush()
    return body


@router.get("/leaderboard", response_model=LeaderboardOut)
async def get_leaderboard(
    period: Literal["week", "month", "all"] = "week",
    department_id: uuid.UUID | None = None,
    limit: int = Query(20, ge=1, le=100),
    ctx: Ctx = Depends(_member),
) -> LeaderboardOut:
    data = await g.leaderboard(
        ctx.db, ctx.org, ctx.user_id, period=period, department_id=department_id, limit=limit
    )
    return LeaderboardOut.model_validate(data)


# ----------------------------------------------------------------------------- badges


async def _badge(ctx: Ctx, badge_id: uuid.UUID) -> Badge:
    badge = await ctx.db.scalar(
        select(Badge).where(Badge.id == badge_id, Badge.organisation_id == ctx.org_id)
    )
    if badge is None:
        raise NotFound("Badge not found")
    return badge


@router.get("/badges", response_model=BadgeListOut)
async def list_badges(ctx: Ctx = Depends(get_ctx)) -> BadgeListOut:
    await g.ensure_default_badges(ctx.db, ctx.org_id)
    counts = (
        select(UserBadge.badge_id, func.count().label("n"))
        .where(UserBadge.organisation_id == ctx.org_id)
        .group_by(UserBadge.badge_id)
        .subquery()
    )
    mine = (
        select(UserBadge.badge_id, UserBadge.awarded_at)
        .where(UserBadge.organisation_id == ctx.org_id, UserBadge.user_id == ctx.user_id)
        .subquery()
    )
    rows = (
        await ctx.db.execute(
            select(Badge, func.coalesce(counts.c.n, 0), mine.c.awarded_at)
            .outerjoin(counts, counts.c.badge_id == Badge.id)
            .outerjoin(mine, mine.c.badge_id == Badge.id)
            .where(Badge.organisation_id == ctx.org_id)
            .order_by(Badge.name)
        )
    ).all()
    items = [
        BadgeOut(**g.badge_dict(b), earned=awarded is not None, awarded_at=awarded, earned_count=int(n))
        for b, n, awarded in rows
    ]
    return BadgeListOut(enabled=g.is_enabled(ctx.org), items=items, criteria_types=g.CRITERIA_TYPES)


@router.post("/badges", response_model=BadgeOut, status_code=201)
async def create_badge(
    body: BadgeCreate, ctx: Ctx = Depends(require_permission("organisation.manage"))
) -> BadgeOut:
    await g.ensure_default_badges(ctx.db, ctx.org_id)
    if await ctx.db.scalar(
        select(Badge.id).where(Badge.organisation_id == ctx.org_id, Badge.key == body.key)
    ):
        raise Conflict("A badge with this key already exists")
    badge = Badge(organisation_id=ctx.org_id, **body.model_dump())
    ctx.db.add(badge)
    try:
        await ctx.db.flush()
    except IntegrityError as exc:  # pragma: no cover - race with a concurrent create
        raise Conflict("A badge with this key already exists") from exc
    await ctx.audit("badge.created", "badge", badge.id, key=badge.key)
    return BadgeOut(**g.badge_dict(badge), earned_count=0)


@router.patch("/badges/{badge_id}", response_model=BadgeOut)
async def update_badge(
    badge_id: uuid.UUID, body: BadgeUpdate, ctx: Ctx = Depends(require_permission("organisation.manage"))
) -> BadgeOut:
    badge = await _badge(ctx, badge_id)
    for k, v in body.model_dump(exclude_unset=True).items():
        if v is not None:
            setattr(badge, k, v)
    await ctx.db.flush()
    await ctx.audit("badge.updated", "badge", badge.id, fields=sorted(body.model_dump(exclude_unset=True)))
    return BadgeOut(**g.badge_dict(badge))


@router.delete("/badges/{badge_id}", status_code=204)
async def delete_badge(
    badge_id: uuid.UUID, ctx: Ctx = Depends(require_permission("organisation.manage"))
) -> Response:
    badge = await _badge(ctx, badge_id)
    await ctx.audit("badge.deleted", "badge", badge.id, key=badge.key)
    await ctx.db.delete(badge)
    await ctx.db.flush()
    return Response(status_code=204)


@router.post("/badges/{badge_id}/award", response_model=BadgeOut)
async def award_badge(
    badge_id: uuid.UUID, body: AwardIn, ctx: Ctx = Depends(require_permission("organisation.manage"))
) -> BadgeOut:
    if not g.is_enabled(ctx.org):
        raise Forbidden("Gamification is disabled for this organisation", code="gamification_disabled")
    badge = await _badge(ctx, badge_id)
    member = await ctx.db.scalar(
        select(OrganisationUser.id).where(
            OrganisationUser.organisation_id == ctx.org_id,
            OrganisationUser.user_id == body.user_id,
            OrganisationUser.status == MembershipStatus.ACTIVE,
        )
    )
    if member is None:
        raise NotFound("User not found in this organisation")
    if not await g.grant_badge(ctx.db, ctx.org_id, body.user_id, badge):
        raise BadRequest("The user already has this badge")
    await ctx.audit("badge.awarded", "badge", badge.id, user_id=str(body.user_id))
    return BadgeOut(**g.badge_dict(badge), earned=True)
