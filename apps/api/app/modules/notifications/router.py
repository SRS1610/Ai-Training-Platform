"""/notifications: in-app inbox, read state, per-type × channel preferences and Web Push subscriptions."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import Ctx, get_ctx, get_current_user
from app.core.db import DbSession
from app.core.errors import NotFound
from app.core.pagination import Page, PageParams, page_params, paginate
from app.models.identity import User
from app.modules.notifications import events as _events  # noqa: F401  (registers subscribers)
from app.modules.notifications import service
from app.modules.notifications.schemas import (
    NotificationOut,
    PreferencesIn,
    PreferencesOut,
    PushSubscriptionIn,
    PushSubscriptionOut,
    PushUnsubscribeIn,
    ReadAllOut,
    UnreadCountOut,
)

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=Page[NotificationOut])
async def list_notifications(
    unread: bool | None = Query(None, description="true = unread only, false = read only"),
    type: str | None = Query(None, max_length=48),
    params: PageParams = Depends(page_params),
    ctx: Ctx = Depends(get_ctx),
) -> Page[NotificationOut]:
    stmt = service.list_stmt(ctx.org_id, ctx.user_id, unread=unread, type=type)
    items, total = await paginate(ctx.db, stmt, params)
    return Page(
        items=[NotificationOut.model_validate(n) for n in items],
        total=total,
        page=params.page,
        page_size=params.page_size,
    )


@router.get("/unread-count", response_model=UnreadCountOut)
async def unread_count(ctx: Ctx = Depends(get_ctx)) -> UnreadCountOut:
    return UnreadCountOut(count=await service.unread_count(ctx.db, ctx.org_id, ctx.user_id))


@router.post("/read-all", response_model=ReadAllOut)
async def read_all(ctx: Ctx = Depends(get_ctx)) -> ReadAllOut:
    return ReadAllOut(updated=await service.mark_all_read(ctx.db, ctx.org_id, ctx.user_id))


# --- preferences & push (declared before /{id} routes) ---------------------------------------------


async def _prefs_out(db: AsyncSession, user: User) -> PreferencesOut:
    pref = await service.get_or_create_pref(db, user.id)
    cfg = service.push_public_config()
    return PreferencesOut(
        preferences=service.effective_preferences(pref),
        push_enabled=cfg["push_enabled"],
        vapid_public_key=cfg["vapid_public_key"],
        push_subscriptions=len(pref.push_subscriptions or []),
    )


@router.get("/preferences", response_model=PreferencesOut)
async def get_preferences(user: User = Depends(get_current_user), db: AsyncSession = DbSession):
    return await _prefs_out(db, user)


@router.put("/preferences", response_model=PreferencesOut)
async def update_preferences(
    body: PreferencesIn, user: User = Depends(get_current_user), db: AsyncSession = DbSession
) -> PreferencesOut:
    pref = await service.get_or_create_pref(db, user.id)
    service.merge_preferences(pref, {k: v.model_dump() for k, v in body.preferences.items()})
    await db.flush()
    return await _prefs_out(db, user)


@router.post("/push-subscriptions", response_model=PushSubscriptionOut, status_code=201)
async def subscribe_push(
    body: PushSubscriptionIn, user: User = Depends(get_current_user), db: AsyncSession = DbSession
) -> PushSubscriptionOut:
    pref = await service.get_or_create_pref(db, user.id)
    service.add_push_subscription(
        pref,
        {
            "endpoint": body.endpoint,
            "keys": body.keys.model_dump(),
            "expiration_time": body.expiration_time,
            "user_agent": body.user_agent,
            "created_at": datetime.now(UTC).isoformat(),
        },
    )
    await db.flush()
    return PushSubscriptionOut(
        subscribed=True,
        push_subscriptions=len(pref.push_subscriptions),
        push_enabled=service.push_public_config()["push_enabled"],
    )


@router.delete("/push-subscriptions", response_model=PushSubscriptionOut)
async def unsubscribe_push(
    body: PushUnsubscribeIn, user: User = Depends(get_current_user), db: AsyncSession = DbSession
) -> PushSubscriptionOut:
    pref = await service.get_or_create_pref(db, user.id)
    if not service.remove_push_subscription(pref, body.endpoint):
        raise NotFound("Push subscription not found")
    await db.flush()
    return PushSubscriptionOut(
        subscribed=False,
        push_subscriptions=len(pref.push_subscriptions),
        push_enabled=service.push_public_config()["push_enabled"],
    )


# --- single notification ------------------------------------------------------------------------------


@router.post("/{notification_id}/read", response_model=NotificationOut)
async def mark_read(notification_id: uuid.UUID, ctx: Ctx = Depends(get_ctx)) -> NotificationOut:
    n = await service.get_own(ctx.db, ctx.org_id, ctx.user_id, notification_id)
    if n is None:
        raise NotFound("Notification not found")
    if n.read_at is None:
        n.read_at = datetime.now(UTC)
        await ctx.db.flush()
    return NotificationOut.model_validate(n)


@router.post("/{notification_id}/unread", response_model=NotificationOut)
async def mark_unread(notification_id: uuid.UUID, ctx: Ctx = Depends(get_ctx)) -> NotificationOut:
    n = await service.get_own(ctx.db, ctx.org_id, ctx.user_id, notification_id)
    if n is None:
        raise NotFound("Notification not found")
    n.read_at = None
    await ctx.db.flush()
    return NotificationOut.model_validate(n)


@router.delete("/{notification_id}", status_code=204)
async def delete_notification(notification_id: uuid.UUID, ctx: Ctx = Depends(get_ctx)) -> Response:
    n = await service.get_own(ctx.db, ctx.org_id, ctx.user_id, notification_id)
    if n is None:
        raise NotFound("Notification not found")
    await ctx.db.delete(n)
    await ctx.db.flush()
    return Response(status_code=204)
