"""/users: organisation member directory and member administration."""

from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, Query, Response, UploadFile

from app.auth.deps import Ctx, require_permission
from app.core.pagination import Page, PageParams, page_params
from app.modules.users import service
from app.modules.users.schemas import (
    ImportResult,
    MemberCreate,
    MemberCreated,
    MemberDetail,
    MemberOut,
    MemberUpdate,
    RolesSet,
)

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=Page[MemberOut])
async def list_members(
    q: str | None = Query(None, max_length=200, description="Search name, email, employee id, job title"),
    role: str | None = Query(None, max_length=64),
    department_id: uuid.UUID | None = None,
    team_id: uuid.UUID | None = None,
    status: Literal["active", "suspended", "invited"] | None = None,
    params: PageParams = Depends(page_params),
    ctx: Ctx = Depends(require_permission("users.view")),
) -> Page[MemberOut]:
    items, total = await service.list_members(ctx, params, q=q, role=role, department_id=department_id,
                                              team_id=team_id, status=status)
    return Page(items=items, total=total, page=params.page, page_size=params.page_size)


@router.post("", response_model=MemberCreated, status_code=201)
async def create_member(body: MemberCreate, ctx: Ctx = Depends(require_permission("users.create"))):
    return await service.create_member(ctx, body)


@router.post("/import", response_model=ImportResult)
async def import_members(
    file: UploadFile = File(..., description="CSV with columns: email, role (or roles), department"),
    default_role: str = Form("learner"),
    ctx: Ctx = Depends(require_permission("users.create")),
) -> ImportResult:
    data = await file.read(service.MAX_IMPORT_BYTES + 1)
    return await service.import_csv(ctx, data, [default_role])


@router.get("/{user_id}", response_model=MemberDetail)
async def get_member(user_id: uuid.UUID, ctx: Ctx = Depends(require_permission("users.view"))):
    return await service.member_detail(ctx, user_id)


@router.patch("/{user_id}", response_model=MemberOut)
async def update_member(user_id: uuid.UUID, body: MemberUpdate, ctx: Ctx = Depends(require_permission("users.edit"))):
    return await service.update_member(ctx, user_id, body)


@router.put("/{user_id}/roles", response_model=MemberOut)
async def set_roles(user_id: uuid.UUID, body: RolesSet, ctx: Ctx = Depends(require_permission("roles.manage"))):
    return await service.set_roles(ctx, user_id, body.roles)


@router.post("/{user_id}/suspend", response_model=MemberOut)
async def suspend(user_id: uuid.UUID, ctx: Ctx = Depends(require_permission("users.edit"))):
    return await service.set_status(ctx, user_id, suspend=True)


@router.post("/{user_id}/reactivate", response_model=MemberOut)
async def reactivate(user_id: uuid.UUID, ctx: Ctx = Depends(require_permission("users.edit"))):
    return await service.set_status(ctx, user_id, suspend=False)


@router.delete("/{user_id}", status_code=204)
async def remove_member(user_id: uuid.UUID, ctx: Ctx = Depends(require_permission("users.delete"))):
    await service.remove_member(ctx, user_id)
    return Response(status_code=204)
