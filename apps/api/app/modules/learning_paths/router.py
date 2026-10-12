"""/learning-paths: CRUD + ordering (enrolments.manage), bulk enrolment, learner path progress."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, Query, Response

from app.auth.deps import Ctx, require_permission
from app.core.pagination import Page, PageParams, page_params
from app.modules.learning_paths import schemas as s
from app.modules.learning_paths import service as svc

router = APIRouter(prefix="/learning-paths", tags=["learning-paths"])
manager = require_permission("enrolments.manage")
member = require_permission("enrolments.manage", "learning.access", any_of=True)
learner = require_permission("learning.access")


@router.get("", response_model=Page[s.PathOut])
async def list_paths(
    status: str | None = None,
    search: str | None = Query(None, max_length=200),
    params: PageParams = Depends(page_params),
    ctx: Ctx = Depends(member),
) -> Any:
    """Managers see every path; learners see published (non-personalised) paths."""
    items, total = await svc.list_paths(ctx, params, status, search)
    return Page(items=items, total=total, page=params.page, page_size=params.page_size)


@router.post("", response_model=s.PathOut, status_code=201)
async def create_path(body: s.PathIn, ctx: Ctx = Depends(manager)) -> Any:
    return (await svc.to_out(ctx, [await svc.create_path(ctx, body)]))[0]


@router.get("/me", response_model=list[s.MyPath])
async def my_paths(ctx: Ctx = Depends(learner)) -> Any:
    return await svc.my_paths(ctx)


@router.get("/{path_id}", response_model=s.PathOut)
async def get_path(path_id: uuid.UUID, ctx: Ctx = Depends(member)) -> Any:
    return (await svc.to_out(ctx, [await svc.visible_path(ctx, path_id)]))[0]


@router.patch("/{path_id}", response_model=s.PathOut)
async def update_path(path_id: uuid.UUID, body: s.PathUpdate, ctx: Ctx = Depends(manager)) -> Any:
    return (await svc.to_out(ctx, [await svc.update_path(ctx, path_id, body)]))[0]


@router.put("/{path_id}/items", response_model=s.PathOut)
async def set_items(path_id: uuid.UUID, body: s.PathItemsIn, ctx: Ctx = Depends(manager)) -> Any:
    return (await svc.to_out(ctx, [await svc.set_items(ctx, path_id, body.items)]))[0]


@router.delete("/{path_id}", status_code=204)
async def delete_path(path_id: uuid.UUID, ctx: Ctx = Depends(manager)) -> Response:
    await svc.delete_path(ctx, path_id)
    return Response(status_code=204)


@router.post("/{path_id}/enrol", response_model=s.PathEnrolOut)
async def enrol(path_id: uuid.UUID, body: s.PathEnrolIn, ctx: Ctx = Depends(manager)) -> Any:
    return await svc.enrol(ctx, path_id, body)


@router.post("/{path_id}/join", response_model=s.PathEnrolOut)
async def join(path_id: uuid.UUID, ctx: Ctx = Depends(learner)) -> Any:
    return await svc.join(ctx, path_id)
