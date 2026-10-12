"""/organisations: current organisation settings (organisation.manage) and creating organisations."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import Ctx, get_current_user, require_permission
from app.core.db import DbSession
from app.core.middleware import client_ip
from app.models.identity import User
from app.modules.organisations import service
from app.modules.organisations.schemas import DomainIn, DomainStatus, OrgCreate, OrgOut, OrgUpdate

router = APIRouter(prefix="/organisations", tags=["organisations"])
_manage = require_permission("organisation.manage")


@router.post("", response_model=OrgOut, status_code=201)
async def create_organisation(
    body: OrgCreate,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = DbSession,
) -> OrgOut:
    return await service.create_additional(db, user, body, client_ip(request))


@router.get("/current", response_model=OrgOut)
async def get_current(ctx: Ctx = Depends(_manage)) -> OrgOut:
    return service.org_out(ctx.org)


@router.patch("/current", response_model=OrgOut)
async def update_current(body: OrgUpdate, ctx: Ctx = Depends(_manage)) -> OrgOut:
    return await service.update_current(ctx, body)


@router.get("/current/domain", response_model=DomainStatus)
async def get_domain(ctx: Ctx = Depends(_manage)) -> DomainStatus:
    return service.domain_status(ctx.org)


@router.put("/current/domain", response_model=DomainStatus)
async def set_domain(body: DomainIn, ctx: Ctx = Depends(_manage)) -> DomainStatus:
    return await service.set_domain(ctx, body.domain)


@router.post("/current/domain/verify", response_model=DomainStatus)
async def verify_domain(ctx: Ctx = Depends(_manage)) -> DomainStatus:
    return await service.verify_domain(ctx)


@router.delete("/current/domain", status_code=204)
async def remove_domain(ctx: Ctx = Depends(_manage)):
    await service.remove_domain(ctx)
    return Response(status_code=204)
