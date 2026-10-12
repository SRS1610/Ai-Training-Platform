"""/teams: teams and team membership (read: users.view, write: users.edit)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, Response

from app.auth.deps import Ctx, require_permission
from app.core.pagination import Page, PageParams, page_params
from app.modules.teams import service
from app.modules.teams.schemas import TeamCreate, TeamMemberOut, TeamMembersAdd, TeamOut, TeamUpdate

router = APIRouter(prefix="/teams", tags=["teams"])


@router.get("", response_model=list[TeamOut])
async def list_teams(
    department_id: uuid.UUID | None = None,
    q: str | None = Query(None, max_length=200),
    ctx: Ctx = Depends(require_permission("users.view")),
):
    return await service.list_teams(ctx, department_id, q)


@router.post("", response_model=TeamOut, status_code=201)
async def create_team(body: TeamCreate, ctx: Ctx = Depends(require_permission("users.edit"))):
    return await service.create_team(ctx, body)


@router.get("/{team_id}", response_model=TeamOut)
async def get_team(team_id: uuid.UUID, ctx: Ctx = Depends(require_permission("users.view"))):
    return await service.team_out(ctx, await service.get_team(ctx, team_id))


@router.patch("/{team_id}", response_model=TeamOut)
async def update_team(
    team_id: uuid.UUID, body: TeamUpdate, ctx: Ctx = Depends(require_permission("users.edit"))
):
    return await service.update_team(ctx, team_id, body)


@router.delete("/{team_id}", status_code=204)
async def delete_team(team_id: uuid.UUID, ctx: Ctx = Depends(require_permission("users.edit"))):
    await service.delete_team(ctx, team_id)
    return Response(status_code=204)


@router.get("/{team_id}/members", response_model=Page[TeamMemberOut])
async def team_members(
    team_id: uuid.UUID,
    params: PageParams = Depends(page_params),
    ctx: Ctx = Depends(require_permission("users.view")),
):
    items, total = await service.list_members(ctx, team_id, params)
    return Page(items=items, total=total, page=params.page, page_size=params.page_size)


@router.post("/{team_id}/members", response_model=TeamOut)
async def add_team_members(
    team_id: uuid.UUID, body: TeamMembersAdd, ctx: Ctx = Depends(require_permission("users.edit"))
):
    await service.add_members(ctx, team_id, body.user_ids)
    return await service.team_out(ctx, await service.get_team(ctx, team_id))


@router.delete("/{team_id}/members/{user_id}", status_code=204)
async def remove_team_member(
    team_id: uuid.UUID, user_id: uuid.UUID, ctx: Ctx = Depends(require_permission("users.edit"))
):
    await service.remove_member(ctx, team_id, user_id)
    return Response(status_code=204)
