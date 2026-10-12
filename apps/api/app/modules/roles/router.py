"""/roles: organisation roles and the permission catalogue (roles.manage)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response

from app.auth.deps import Ctx, require_permission
from app.modules.roles import service
from app.modules.roles.schemas import PermissionOut, RoleCreate, RoleOut, RoleUpdate

router = APIRouter(prefix="/roles", tags=["roles"])
# Anyone who administers members needs the role list (e.g. invitation forms).
_can_read = require_permission("roles.manage", "users.view", "users.create", any_of=True)


@router.get("", response_model=list[RoleOut])
async def list_roles(ctx: Ctx = Depends(_can_read)):
    return await service.list_roles(ctx)


@router.get("/permissions", response_model=list[PermissionOut])
async def permission_catalogue(ctx: Ctx = Depends(require_permission("roles.manage"))):
    return [
        PermissionOut(code=p.code, description=p.description, category=p.category)
        for p in await service.catalogue(ctx)
    ]


@router.post("", response_model=RoleOut, status_code=201)
async def create_role(body: RoleCreate, ctx: Ctx = Depends(require_permission("roles.manage"))):
    return await service.create_role(ctx, body)


@router.get("/{role_id}", response_model=RoleOut)
async def get_role(role_id: uuid.UUID, ctx: Ctx = Depends(require_permission("roles.manage"))):
    return await service.role_out(ctx, await service.get_role(ctx, role_id))


@router.patch("/{role_id}", response_model=RoleOut)
async def update_role(
    role_id: uuid.UUID, body: RoleUpdate, ctx: Ctx = Depends(require_permission("roles.manage"))
):
    return await service.update_role(ctx, role_id, body)


@router.delete("/{role_id}", status_code=204)
async def delete_role(role_id: uuid.UUID, ctx: Ctx = Depends(require_permission("roles.manage"))):
    await service.delete_role(ctx, role_id)
    return Response(status_code=204)
