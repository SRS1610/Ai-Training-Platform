"""Teams (optionally inside a department) and team membership."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert

from app.auth.deps import Ctx
from app.core.errors import BadRequest, NotFound
from app.core.pagination import PageParams, paginate
from app.models.identity import User
from app.models.tenancy import OrganisationUser, Team, TeamMember
from app.modules.teams.schemas import TeamCreate, TeamMemberOut, TeamOut, TeamUpdate
from app.modules.users.service import department_in_org, get_membership


async def get_team(ctx: Ctx, team_id: uuid.UUID) -> Team:
    t = await ctx.db.scalar(select(Team).where(Team.id == team_id, Team.organisation_id == ctx.org_id,
                                               Team.deleted_at.is_(None)))
    if t is None:
        raise NotFound("Team not found")
    return t


async def _member_counts(ctx: Ctx, team_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    if not team_ids:
        return {}
    return dict((await ctx.db.execute(
        select(TeamMember.team_id, func.count()).where(TeamMember.organisation_id == ctx.org_id,
                                                       TeamMember.team_id.in_(team_ids))
        .group_by(TeamMember.team_id))).tuples().all())


def _out(t: Team, counts: dict[uuid.UUID, int]) -> TeamOut:
    return TeamOut(id=t.id, name=t.name, description=t.description, department_id=t.department_id,
                   lead_user_id=t.lead_user_id, member_count=counts.get(t.id, 0), created_at=t.created_at)


async def team_out(ctx: Ctx, t: Team) -> TeamOut:
    return _out(t, await _member_counts(ctx, [t.id]))


async def list_teams(ctx: Ctx, department_id: uuid.UUID | None, q: str | None) -> list[TeamOut]:
    stmt = select(Team).where(Team.organisation_id == ctx.org_id, Team.deleted_at.is_(None))
    if department_id:
        stmt = stmt.where(Team.department_id == department_id)
    if q:
        stmt = stmt.where(Team.name.ilike(f"%{q.strip()}%"))
    rows = (await ctx.db.execute(stmt.order_by(Team.name))).scalars().all()
    counts = await _member_counts(ctx, [t.id for t in rows])
    return [_out(t, counts) for t in rows]


async def _validate(ctx: Ctx, data: dict) -> None:
    if data.get("department_id"):
        await department_in_org(ctx.db, ctx.org_id, data["department_id"])
    if data.get("lead_user_id"):
        await get_membership(ctx.db, ctx.org_id, data["lead_user_id"])


async def create_team(ctx: Ctx, body: TeamCreate) -> TeamOut:
    data = body.model_dump()
    await _validate(ctx, data)
    t = Team(organisation_id=ctx.org_id, **data)
    ctx.db.add(t)
    await ctx.db.flush()
    await ctx.db.refresh(t)
    if t.lead_user_id:  # the lead is a member of their own team
        await ctx.db.execute(insert(TeamMember).values(organisation_id=ctx.org_id, team_id=t.id,
                                                       user_id=t.lead_user_id).on_conflict_do_nothing())
    await ctx.audit("team.created", "team", t.id, name=t.name)
    return await team_out(ctx, t)


async def update_team(ctx: Ctx, team_id: uuid.UUID, body: TeamUpdate) -> TeamOut:
    t = await get_team(ctx, team_id)
    data = body.model_dump(exclude_unset=True)
    if "name" in data and data["name"] is None:
        data.pop("name")
    await _validate(ctx, data)
    for k, v in data.items():
        setattr(t, k, v)
    await ctx.db.flush()
    await ctx.db.refresh(t)
    await ctx.audit("team.updated", "team", t.id, fields=sorted(data.keys()))
    return await team_out(ctx, t)


async def delete_team(ctx: Ctx, team_id: uuid.UUID) -> None:
    t = await get_team(ctx, team_id)
    await ctx.db.execute(delete(TeamMember).where(TeamMember.organisation_id == ctx.org_id,
                                                  TeamMember.team_id == t.id))
    t.deleted_at = datetime.now(UTC)
    await ctx.db.flush()
    await ctx.audit("team.deleted", "team", t.id, name=t.name)


async def list_members(ctx: Ctx, team_id: uuid.UUID, params: PageParams) -> tuple[list[TeamMemberOut], int]:
    await get_team(ctx, team_id)
    stmt = (
        select(OrganisationUser)
        .join(TeamMember, (TeamMember.user_id == OrganisationUser.user_id)
              & (TeamMember.organisation_id == OrganisationUser.organisation_id))
        .join(User, User.id == OrganisationUser.user_id)
        .where(TeamMember.team_id == team_id, OrganisationUser.organisation_id == ctx.org_id)
        .order_by(func.lower(User.full_name))
    )
    rows, total = await paginate(ctx.db, stmt, params)
    return [TeamMemberOut(user_id=m.user_id, email=m.user.email, full_name=m.user.full_name,
                          avatar_url=m.user.avatar_url, job_title=m.job_title) for m in rows], total


async def add_members(ctx: Ctx, team_id: uuid.UUID, user_ids: list[uuid.UUID]) -> int:
    t = await get_team(ctx, team_id)
    ids = list(dict.fromkeys(user_ids))
    valid = set((await ctx.db.execute(select(OrganisationUser.user_id).where(
        OrganisationUser.organisation_id == ctx.org_id, OrganisationUser.user_id.in_(ids)))).scalars().all())
    missing = [str(i) for i in ids if i not in valid]
    if missing:
        raise BadRequest("Some users are not members of this organisation", code="not_member",
                         details={"user_ids": missing})
    result = await ctx.db.execute(
        insert(TeamMember).values([{"organisation_id": ctx.org_id, "team_id": t.id, "user_id": u} for u in ids])
        .on_conflict_do_nothing())
    added = max(int(result.rowcount or 0), 0)
    await ctx.audit("team.members_added", "team", t.id, user_ids=[str(i) for i in ids], added=added)
    return added


async def remove_member(ctx: Ctx, team_id: uuid.UUID, user_id: uuid.UUID) -> None:
    t = await get_team(ctx, team_id)
    result = await ctx.db.execute(delete(TeamMember).where(
        TeamMember.organisation_id == ctx.org_id, TeamMember.team_id == t.id, TeamMember.user_id == user_id))
    if not result.rowcount:
        raise NotFound("User is not a member of this team")
    await ctx.audit("team.member_removed", "team", t.id, user_id=str(user_id))
