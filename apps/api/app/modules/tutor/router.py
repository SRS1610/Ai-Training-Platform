"""/ai/tutor: AI tutor sessions and messages (``learning.access`` + plan/org feature "tutor")."""

from __future__ import annotations

import json
import uuid
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import delete, select

from app.auth.deps import Ctx, get_ctx
from app.core.pagination import Page, PageParams, page_params, paginate
from app.models.ai import AIMessage, AISession, AISessionKind
from app.modules.tutor import service
from app.modules.tutor.schemas import ExchangeOut, MessageIn, MessageOut, RatingIn, SessionCreate, SessionOut

router = APIRouter(prefix="/ai/tutor", tags=["ai-tutor"])


@router.post("/sessions", response_model=SessionOut, status_code=201)
async def create_session(body: SessionCreate, ctx: Ctx = Depends(get_ctx)) -> SessionOut:
    return SessionOut.model_validate(await service.create_session(ctx, body))


@router.get("/sessions", response_model=Page[SessionOut])
async def list_sessions(
    ctx: Ctx = Depends(get_ctx), params: PageParams = Depends(page_params), course_id: uuid.UUID | None = None
) -> Page[SessionOut]:
    ctx.require("learning.access")
    stmt = select(AISession).where(
        AISession.organisation_id == ctx.org_id,
        AISession.user_id == ctx.user_id,
        AISession.kind == AISessionKind.TUTOR,
    )
    if course_id:
        stmt = stmt.where(AISession.course_id == course_id)
    items, total = await paginate(ctx.db, stmt.order_by(AISession.updated_at.desc()), params)
    return Page(
        items=[SessionOut.model_validate(s) for s in items],
        total=total,
        page=params.page,
        page_size=params.page_size,
    )


@router.get("/sessions/{session_id}", response_model=SessionOut)
async def get_session(session_id: uuid.UUID, ctx: Ctx = Depends(get_ctx)) -> SessionOut:
    return SessionOut.model_validate(await service.get_session(ctx, session_id))


@router.delete("/sessions/{session_id}", status_code=204)
async def delete_session(session_id: uuid.UUID, ctx: Ctx = Depends(get_ctx)) -> None:
    s = await service.get_session(ctx, session_id)
    await ctx.db.execute(delete(AIMessage).where(AIMessage.session_id == s.id))
    await ctx.db.delete(s)


@router.get("/sessions/{session_id}/messages", response_model=list[MessageOut])
async def list_messages(session_id: uuid.UUID, ctx: Ctx = Depends(get_ctx)) -> list[MessageOut]:
    s = await service.get_session(ctx, session_id)
    return [MessageOut.model_validate(m) for m in await service.messages(ctx, s)]


@router.post("/sessions/{session_id}/messages", response_model=ExchangeOut)
async def send_message(session_id: uuid.UUID, body: MessageIn, ctx: Ctx = Depends(get_ctx)) -> ExchangeOut:
    s = await service.get_session(ctx, session_id)
    return await service.send_message(ctx, s, body)


def _sse(event: str, data: object) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


@router.post("/sessions/{session_id}/messages/stream")
async def send_message_stream(
    session_id: uuid.UUID, body: MessageIn, ctx: Ctx = Depends(get_ctx)
) -> StreamingResponse:
    """SSE variant. Events: ``meta`` (mode, citations, message ids), ``delta`` ({text}) chunks, ``done`` (the
    stored assistant message). The answer is generated and leak-screened in full before streaming starts,
    so hint-mode screening can never be bypassed by partial output."""
    s = await service.get_session(ctx, session_id)
    exchange = await service.send_message(ctx, s, body)
    await ctx.db.commit()
    msg = exchange.assistant_message

    async def events() -> AsyncIterator[str]:
        yield _sse(
            "meta",
            {
                "session_id": exchange.session_id,
                "user_message_id": exchange.user_message.id,
                "assistant_message_id": msg.id,
                "mode": exchange.mode,
                "citations": msg.citations,
                "offline": exchange.offline,
            },
        )
        words = msg.content.split(" ")
        for i in range(0, len(words), 6):
            piece = " ".join(words[i : i + 6]) + (" " if i + 6 < len(words) else "")
            yield _sse("delta", {"text": piece})
        yield _sse("done", msg.model_dump(mode="json"))

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/messages/{message_id}/rating", response_model=MessageOut)
async def rate(message_id: uuid.UUID, body: RatingIn, ctx: Ctx = Depends(get_ctx)) -> MessageOut:
    return MessageOut.model_validate(await service.rate_message(ctx, message_id, body.rating))
