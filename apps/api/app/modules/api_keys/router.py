"""/api-keys: organisation API keys (api_keys.manage + plan feature ``api_access``)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response

from app.auth.deps import Ctx, require_permission
from app.core.pagination import Page, PageParams, page_params
from app.modules.api_keys import service
from app.modules.api_keys.schemas import ApiKeyCreate, ApiKeyCreated, ApiKeyOut

router = APIRouter(prefix="/api-keys", tags=["api-keys"])
_manage = require_permission("api_keys.manage")


@router.get("", response_model=Page[ApiKeyOut])
async def list_keys(
    include_revoked: bool = False, params: PageParams = Depends(page_params), ctx: Ctx = Depends(_manage)
) -> Page[ApiKeyOut]:
    rows, total = await service.list_keys(ctx, params, include_revoked)
    return Page(
        items=[service.to_out(k) for k in rows], total=total, page=params.page, page_size=params.page_size
    )


@router.post("", response_model=ApiKeyCreated, status_code=201)
async def create_key(body: ApiKeyCreate, ctx: Ctx = Depends(_manage)) -> ApiKeyCreated:
    return await service.create_key(ctx, body)


@router.delete("/{key_id}", status_code=204)
async def revoke_key(key_id: uuid.UUID, ctx: Ctx = Depends(_manage)):
    await service.revoke_key(ctx, key_id)
    return Response(status_code=204)
