"""/departments: organisation structure (read: users.view, write: users.edit)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, Response

from app.auth.deps import Ctx, require_permission
from app.modules.departments import service
from app.modules.departments.schemas import DepartmentCreate, DepartmentNode, DepartmentOut, DepartmentUpdate

router = APIRouter(prefix="/departments", tags=["departments"])


@router.get("", response_model=list[DepartmentOut])
async def list_departments(q: str | None = Query(None, max_length=200),
                           ctx: Ctx = Depends(require_permission("users.view"))):
    return await service.list_departments(ctx, q)


@router.get("/tree", response_model=list[DepartmentNode])
async def department_tree(ctx: Ctx = Depends(require_permission("users.view"))):
    return await service.tree(ctx)


@router.post("", response_model=DepartmentOut, status_code=201)
async def create_department(body: DepartmentCreate, ctx: Ctx = Depends(require_permission("users.edit"))):
    return await service.create_department(ctx, body)


@router.get("/{department_id}", response_model=DepartmentOut)
async def get_department(department_id: uuid.UUID, ctx: Ctx = Depends(require_permission("users.view"))):
    return await service.department_out(ctx, await service.get_department(ctx, department_id))


@router.patch("/{department_id}", response_model=DepartmentOut)
async def update_department(department_id: uuid.UUID, body: DepartmentUpdate,
                            ctx: Ctx = Depends(require_permission("users.edit"))):
    return await service.update_department(ctx, department_id, body)


@router.delete("/{department_id}", status_code=204)
async def delete_department(department_id: uuid.UUID, ctx: Ctx = Depends(require_permission("users.edit"))):
    await service.delete_department(ctx, department_id)
    return Response(status_code=204)
