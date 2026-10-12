"""/platform: super-admin administration across tenants (requires ``users.is_superadmin``)."""

from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Query

from app.auth.deps import Ctx, require_superadmin
from app.core.pagination import Page, PageParams, page_params
from app.modules.platform import service
from app.modules.platform.schemas import (
    HealthOut,
    PlanChange,
    PlatformOrgDetail,
    PlatformOrgOut,
    PlatformUserOut,
    StatusChange,
    SuperadminSet,
)

router = APIRouter(prefix="/platform", tags=["platform"])


@router.get("/organisations", response_model=Page[PlatformOrgOut])
async def list_organisations(
    q: str | None = Query(None, max_length=200),
    status: Literal["active", "suspended", "closed"] | None = None,
    plan: str | None = Query(None, max_length=32),
    include_deleted: bool = False,
    params: PageParams = Depends(page_params),
    ctx: Ctx = Depends(require_superadmin),
) -> Page[PlatformOrgOut]:
    items, total = await service.list_orgs(ctx, params, q, status, plan, include_deleted)
    return Page(items=items, total=total, page=params.page, page_size=params.page_size)


@router.get("/organisations/{org_id}", response_model=PlatformOrgDetail)
async def get_organisation(org_id: uuid.UUID, ctx: Ctx = Depends(require_superadmin)):
    return await service.org_detail(ctx, org_id)


@router.post("/organisations/{org_id}/suspend", response_model=PlatformOrgDetail)
async def suspend_organisation(
    org_id: uuid.UUID, body: StatusChange | None = None, ctx: Ctx = Depends(require_superadmin)
):
    return await service.set_org_status(ctx, org_id, True, body.reason if body else None)


@router.post("/organisations/{org_id}/reactivate", response_model=PlatformOrgDetail)
async def reactivate_organisation(
    org_id: uuid.UUID, body: StatusChange | None = None, ctx: Ctx = Depends(require_superadmin)
):
    return await service.set_org_status(ctx, org_id, False, body.reason if body else None)


@router.patch("/organisations/{org_id}/plan", response_model=PlatformOrgDetail)
async def change_plan(org_id: uuid.UUID, body: PlanChange, ctx: Ctx = Depends(require_superadmin)):
    return await service.change_plan(ctx, org_id, body)


@router.get("/users", response_model=Page[PlatformUserOut])
async def list_users(
    q: str | None = Query(None, max_length=320),
    superadmin: bool | None = None,
    status: Literal["active", "suspended", "deleted"] | None = None,
    params: PageParams = Depends(page_params),
    ctx: Ctx = Depends(require_superadmin),
) -> Page[PlatformUserOut]:
    items, total = await service.list_users(ctx, params, q, superadmin, status)
    return Page(items=items, total=total, page=params.page, page_size=params.page_size)


@router.put("/users/{user_id}/superadmin", response_model=PlatformUserOut)
async def set_superadmin(user_id: uuid.UUID, body: SuperadminSet, ctx: Ctx = Depends(require_superadmin)):
    return await service.set_superadmin(ctx, user_id, body.is_superadmin)


@router.get("/health", response_model=HealthOut)
async def platform_health(ctx: Ctx = Depends(require_superadmin)) -> HealthOut:
    return HealthOut(**await service.health(ctx))
