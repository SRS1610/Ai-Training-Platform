"""/search: global, permission-aware search with grouped results and frontend links."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from app.auth.deps import Ctx, get_ctx
from app.core.errors import BadRequest
from app.modules.search import service

router = APIRouter(prefix="/search", tags=["search"])


class SearchItem(BaseModel):
    id: Any
    type: str
    title: str
    subtitle: str | None = None
    snippet: str | None = None
    status: str | None = None
    link: str
    score: float
    meta: dict[str, Any] = {}


class SearchGroup(BaseModel):
    type: str
    label: str
    items: list[SearchItem]


class SearchOut(BaseModel):
    query: str
    total: int
    groups: list[SearchGroup]
    types_searched: list[str]
    fuzzy: bool


@router.get("", response_model=SearchOut)
async def search(
    q: str = Query(..., min_length=1, max_length=200),
    types: str | None = Query(None, description=f"Comma separated subset of: {', '.join(service.TYPES)}"),
    limit: int = Query(5, ge=1, le=25, description="Max results per type"),
    semantic: bool = Query(
        True, description="Include semantic knowledge-base matches when AI search is available"
    ),
    ctx: Ctx = Depends(get_ctx),
) -> SearchOut:
    if len(q.strip()) < 2:
        raise BadRequest("Search query must be at least 2 characters")
    wanted = None
    if types:
        wanted = [t.strip() for t in types.split(",") if t.strip()]
        unknown = sorted(set(wanted) - set(service.TYPES))
        if unknown:
            raise BadRequest(f"Unknown search types: {', '.join(unknown)}")
    return SearchOut.model_validate(await service.search(ctx, q, wanted, limit, semantic))
