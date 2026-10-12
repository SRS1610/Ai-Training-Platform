"""/sso/connections: enterprise SSO configuration (organisation.manage + plan feature ``sso``)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response

from app.auth.deps import Ctx, require_permission
from app.modules.sso import service
from app.modules.sso.schemas import SSOCreate, SSOOut, SSOTestResult, SSOUpdate

router = APIRouter(prefix="/sso", tags=["sso"])
_manage = require_permission("organisation.manage")


@router.get("/connections", response_model=list[SSOOut])
async def list_connections(ctx: Ctx = Depends(_manage)):
    return [service.to_out(c) for c in await service.list_connections(ctx)]


@router.post("/connections", response_model=SSOOut, status_code=201)
async def create_connection(body: SSOCreate, ctx: Ctx = Depends(_manage)):
    return service.to_out(await service.create_connection(ctx, body))


@router.get("/connections/{conn_id}", response_model=SSOOut)
async def get_connection(conn_id: uuid.UUID, ctx: Ctx = Depends(_manage)):
    service.ensure_enabled(ctx)
    return service.to_out(await service.get_connection(ctx, conn_id))


@router.patch("/connections/{conn_id}", response_model=SSOOut)
async def update_connection(conn_id: uuid.UUID, body: SSOUpdate, ctx: Ctx = Depends(_manage)):
    return service.to_out(await service.update_connection(ctx, conn_id, body))


@router.delete("/connections/{conn_id}", status_code=204)
async def delete_connection(conn_id: uuid.UUID, ctx: Ctx = Depends(_manage)):
    await service.delete_connection(ctx, conn_id)
    return Response(status_code=204)


@router.post("/connections/{conn_id}/verify-domains", response_model=SSOOut)
async def verify_domains(conn_id: uuid.UUID, ctx: Ctx = Depends(_manage)):
    return service.to_out(await service.verify_domains(ctx, conn_id))


@router.post("/connections/{conn_id}/test", response_model=SSOTestResult)
async def test_connection(conn_id: uuid.UUID, ctx: Ctx = Depends(_manage)):
    return await service.test_connection(ctx, conn_id)
