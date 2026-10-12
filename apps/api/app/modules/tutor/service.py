"""AI tutor: RAG-grounded explanations with citations, hint-only mode during graded work, safety screens."""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime
from typing import Any

import structlog
from praxis_ai import prompts as P
from praxis_ai.safety import detect_injection, moderate, screen_output
from praxis_ai.text import keywords
from sqlalchemy import select

from app.auth.deps import Ctx
from app.core.errors import Forbidden, NotFound
from app.models.ai import AIMessage, AISession, AISessionKind
from app.models.content import Course
from app.modules.ai import gateway
from app.modules.tutor import context as C
from app.modules.tutor.schemas import ExchangeOut, MessageIn, MessageOut, SessionCreate

log = structlog.get_logger(__name__)
HISTORY_TURNS = 6

SELF_HARM_REPLY = (
    "I'm really sorry you're feeling this way. I'm an AI tutor and can't help with this, but you "
    "don't have to go through it alone — please reach out to someone you trust, your manager or HR, "
    "or a local crisis line (in Australia, Lifeline 13 11 14; elsewhere, your local emergency number). "
    "If you're in immediate danger, call emergency services now."
)
REFUSE_REPLY = (
    "I can't help with that request. I'm here to help you learn your course material — ask me about it!"
)
NO_SOURCES_REPLY = (
    "I couldn't find this in your organisation's approved course materials, so I won't guess. "
    "Try rephrasing, or ask your instructor to add a source on this topic to the knowledge base."
)


def _require_learner(ctx: Ctx) -> None:
    ctx.require("learning.access")


async def _gate(ctx: Ctx) -> gateway.Resolved:
    r = await gateway.resolve(ctx.db, ctx.org_id)
    gateway.check_feature(r, "tutor")
    return r


async def create_session(ctx: Ctx, body: SessionCreate) -> AISession:
    _require_learner(ctx)
    await _gate(ctx)
    title = body.title
    if body.course_id is not None:
        course = await ctx.db.scalar(
            select(Course).where(
                Course.id == body.course_id, Course.organisation_id == ctx.org_id, Course.deleted_at.is_(None)
            )
        )
        if course is None:
            raise NotFound("Course not found")
        if not course.ai_tutor_enabled:
            raise Forbidden("The AI tutor is disabled for this course", code="tutor_disabled")
        cc = await C.course_context(ctx.db, ctx.org_id, ctx.user_id, course.id, None)
        if not C.enrolled(cc.enrolment) and not ctx.can_any("courses.edit", "courses.create"):
            raise Forbidden("Enrol in this course to use its AI tutor", code="not_enrolled")
        title = title or f"Tutor: {course.title}"
    s = AISession(
        organisation_id=ctx.org_id,
        user_id=ctx.user_id,
        kind=AISessionKind.TUTOR,
        title=title,
        course_id=body.course_id,
        lesson_id=body.lesson_id,
        context={},
    )
    ctx.db.add(s)
    await ctx.db.flush()
    return s


async def get_session(ctx: Ctx, session_id: uuid.UUID) -> AISession:
    _require_learner(ctx)
    s = await ctx.db.scalar(
        select(AISession).where(
            AISession.id == session_id,
            AISession.organisation_id == ctx.org_id,
            AISession.user_id == ctx.user_id,
            AISession.kind == AISessionKind.TUTOR,
        )
    )
    if s is None:
        raise NotFound("Tutor session not found")
    return s


async def messages(ctx: Ctx, session: AISession) -> list[AIMessage]:
    return list(
        (
            await ctx.db.scalars(
                select(AIMessage)
                .where(AIMessage.session_id == session.id, AIMessage.organisation_id == ctx.org_id)
                .order_by(AIMessage.created_at, AIMessage.id)
            )
        ).all()
    )


def _hint_fallback(question: str) -> str:
    terms = keywords(question, 3)
    focus = f" Focus on how **{', '.join(terms)}** connect to what you're observing." if terms else ""
    return (
        "I can't share the answer while this graded activity is in progress, but here's a hint: list the "
        f"evidence you have so far and what each possible cause would predict.{focus} Which check would "
        "confirm or rule out your leading idea?"
    )


def _cited(text: str, citations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    used = {int(n) for n in re.findall(r"\[(\d+)\]", text)}
    return [c for c in citations if c["index"] in used] or citations


async def send_message(ctx: Ctx, session: AISession, body: MessageIn) -> ExchangeOut:
    """Answer a learner question. Pipeline: moderation → graded-context guard → retrieval (approved-only
    when knowledge_only) → prompt (protected facts never included) → gateway → output leak screen."""
    r = await _gate(ctx)
    question = body.content.strip()
    lesson_id = body.lesson_id or session.lesson_id
    mod = moderate(question)
    injection = detect_injection(question)
    # Explicit wall-clock timestamps: both messages share one transaction, where now() is constant.
    user_msg = AIMessage(
        created_at=datetime.now(UTC),
        organisation_id=ctx.org_id,
        session_id=session.id,
        role="user",
        content=question,
        safety={"moderation": mod.as_dict(), "injection": injection.as_dict()},
    )
    ctx.db.add(user_msg)
    await ctx.db.flush()
    if not session.title:
        session.title = question[:80]
    session.updated_at = datetime.now(UTC)

    safety: dict[str, Any] = {"injection": injection.as_dict()} if injection.flagged else {}
    citations: list[dict[str, Any]] = []
    model: str | None = None
    tokens_in = tokens_out = 0
    offline = r.offline
    if mod.flagged:
        mode = "refuse"
        text = SELF_HARM_REPLY if "self_harm" in mod.categories else REFUSE_REPLY
        safety["moderation"] = mod.as_dict()
    else:
        graded = await C.graded_context(ctx.db, ctx.org_id, ctx.user_id, session.course_id, question)
        mode = "hint" if graded.active else "explain"
        cc = await C.course_context(ctx.db, ctx.org_id, ctx.user_id, session.course_id, lesson_id)
        profile = await C.learner_profile(ctx.db, ctx.org_id, ctx.user_id, cc)
        chunks = await gateway.retrieve(
            ctx.db,
            organisation_id=ctx.org_id,
            query=question,
            course_id=session.course_id,
            k=4,
            approved_only=r.knowledge_only,
        )
        lesson = cc.lesson_text
        passages = [{"title": c.title, "heading": c.heading, "content": c.content} for c in chunks]
        if graded.active:
            safety["graded_context"] = graded.items
            lesson = C.redact_text(lesson or "", graded.protected) or None
            for p in passages:
                p["content"] = C.redact_text(p["content"], graded.protected)
            # The learner profile's previous mistakes are prompts only; still drop any that restate a key.
            profile["previous_mistakes"] = [
                m
                for m in profile.get("previous_mistakes", [])
                if not screen_output(m, graded.protected).leaked
            ]
        citations = [{"index": i, **c.citation()} for i, c in enumerate(chunks, 1)]
        if r.knowledge_only and not chunks and not lesson:
            text = NO_SOURCES_REPLY
            safety["no_sources"] = True
        else:
            history = [m for m in await messages(ctx, session) if m.id != user_msg.id][-HISTORY_TURNS:]
            convo: list[dict[str, Any]] = [
                {"role": m.role, "content": m.content} for m in history if m.role in ("user", "assistant")
            ]
            convo.append(
                {
                    "role": "user",
                    "trusted": True,
                    "content": P.tutor_user_message(
                        question=question, passages=passages, lesson_text=lesson, profile=profile
                    ),
                }
            )
            system = P.tutor_system(
                mode=mode,
                course=cc.title,
                behaviour=r.tutor_behaviour,
                knowledge_only=r.knowledge_only,
                graded=graded.labels,
            )
            result = await gateway.generate_text(
                ctx.db,
                organisation_id=ctx.org_id,
                user_id=ctx.user_id,
                feature="tutor",
                system=system,
                messages=convo,
                course_id=session.course_id,
                max_tokens=900,
            )
            text, model, offline = result.text.strip(), result.model, result.offline
            tokens_in, tokens_out = result.tokens_in, result.tokens_out
            if result.flags.get("injection"):
                safety["injection"] = result.flags["injection"]
            if graded.active:
                screen = screen_output(text, graded.protected)
                if screen.leaked:
                    log.warning("tutor.leak_blocked", session_id=str(session.id), matches=len(screen.matches))
                    text = _hint_fallback(question)
                    safety["leak_blocked"] = True
                    safety["leak_matches"] = len(screen.matches)
            if not text:
                text = "I'm not sure how to answer that — could you rephrase your question?"
            citations = _cited(text, citations) if citations else []
    assistant = AIMessage(
        created_at=datetime.now(UTC),
        organisation_id=ctx.org_id,
        session_id=session.id,
        role="assistant",
        content=text,
        mode=mode,
        citations=citations,
        safety=safety,
        model=model,
        tokens_in=tokens_in,
        tokens_out=tokens_out,
    )
    ctx.db.add(assistant)
    await ctx.db.flush()
    await ctx.db.refresh(user_msg)
    await ctx.db.refresh(assistant)
    return ExchangeOut(
        session_id=session.id,
        user_message=MessageOut.model_validate(user_msg),
        assistant_message=MessageOut.model_validate(assistant),
        mode=mode,
        offline=offline,
    )


async def rate_message(ctx: Ctx, message_id: uuid.UUID, rating: int) -> AIMessage:
    _require_learner(ctx)
    msg = await ctx.db.scalar(
        select(AIMessage)
        .join(AISession, AISession.id == AIMessage.session_id)
        .where(
            AIMessage.id == message_id,
            AIMessage.organisation_id == ctx.org_id,
            AISession.user_id == ctx.user_id,
            AIMessage.role == "assistant",
        )
    )
    if msg is None:
        raise NotFound("Message not found")
    msg.feedback_rating = rating
    await ctx.db.flush()
    return msg
