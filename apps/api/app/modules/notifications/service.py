"""Notification inbox, preferences, push subscriptions and delivery helpers."""

from __future__ import annotations

import functools
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any

import structlog
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.notify import EMAIL_DEFAULT, notify
from app.models.platform import Notification, NotificationPreference
from app.modules.notifications.push import get_push_provider, push_settings

log = structlog.get_logger(__name__)

CHANNELS = ("email", "in_app", "push")

# Catalogue shown on the preferences screen (type -> label).
NOTIFICATION_TYPES: dict[str, str] = {
    "training_assigned": "Training assigned to me",
    "assignment_assigned": "Assignment assigned to me",
    "assignment_due": "Upcoming due dates",
    "assignment_overdue": "Overdue training",
    "course_completed": "Course completed",
    "assessment_passed": "Assessment passed",
    "assessment_failed": "Assessment not passed",
    "certificate_issued": "Certificate issued",
    "instructor_feedback": "Instructor feedback on my work",
    "simulation_completed": "Simulation results",
    "badge_earned": "Badges earned",
    "review_requested": "Review requests",
    "generation_ready": "AI generation ready for review",
    "ai_budget_alert": "AI budget alerts",
    "billing_alert": "Billing alerts",
    "system": "System announcements",
}

MAX_PUSH_SUBSCRIPTIONS = 10


# ----------------------------------------------------------------------------- event handler safety


def safe_handler(fn: Callable[[AsyncSession, dict[str, Any]], Awaitable[None]]):
    """Run an event handler inside a SAVEPOINT so a failure in a side effect (notification, points) never
    breaks the business transaction that emitted the event."""

    @functools.wraps(fn)
    async def wrapper(db: AsyncSession, payload: dict[str, Any]) -> None:
        try:
            async with db.begin_nested():
                await fn(db, payload)
        except Exception:
            log.exception("event_handler.failed", handler=fn.__qualname__)

    return wrapper


# ----------------------------------------------------------------------------- sending


async def send_notification(
    db: AsyncSession,
    *,
    organisation_id: uuid.UUID,
    user_id: uuid.UUID,
    type: str,
    title: str,
    body: str = "",
    link: str | None = None,
    data: dict[str, Any] | None = None,
) -> Notification:
    """``app.core.notify.notify`` plus push hand-off: when push is queued but no Web Push provider is
    configured the channel is recorded as ``skipped``; otherwise delivery is enqueued."""
    n = await notify(
        db,
        organisation_id=organisation_id,
        user_id=user_id,
        type=type,
        title=title,
        body=body,
        link=link,
        data=data,
    )
    if (n.channels or {}).get("push") == "queued":
        if not get_push_provider().configured:
            n.channels = {**n.channels, "push": "skipped"}
            await db.flush()
        elif n.id is not None:
            from app.workers import enqueue

            await enqueue("notifications.deliver_push", db=db, notification_id=str(n.id))
    return n


async def deliver_push(db: AsyncSession, notification: Notification) -> str:
    """Deliver one notification to all of the user's push subscriptions; prunes expired subscriptions."""
    pref = await db.scalar(
        select(NotificationPreference).where(NotificationPreference.user_id == notification.user_id)
    )
    subs = list((pref.push_subscriptions if pref else []) or [])
    provider = get_push_provider()
    if not subs or not provider.configured:
        result = "skipped"
    else:
        payload = {
            "title": notification.title,
            "body": notification.body,
            "link": notification.link,
            "type": notification.type,
            "id": str(notification.id),
        }
        outcomes = []
        keep = []
        for sub in subs:
            outcome = await provider.send(sub, payload)
            outcomes.append(outcome)
            if outcome != "expired":
                keep.append(sub)
        if pref is not None and len(keep) != len(subs):
            pref.push_subscriptions = keep
        result = (
            "sent"
            if "sent" in outcomes
            else ("expired" if outcomes and all(o == "expired" for o in outcomes) else "failed")
        )
    notification.channels = {**(notification.channels or {}), "push": result}
    await db.flush()
    return result


async def push_sweep(db: AsyncSession, *, max_age_hours: int = 24, limit: int = 500) -> int:
    """Deliver queued pushes (rows whose ``channels.push == 'queued'``) created by any module."""
    since = datetime.now(UTC) - timedelta(hours=max_age_hours)
    rows = (
        (
            await db.execute(
                select(Notification)
                .where(Notification.channels["push"].astext == "queued", Notification.created_at >= since)
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    for n in rows:
        await deliver_push(db, n)
    return len(rows)


# ----------------------------------------------------------------------------- inbox


def _inbox(org_id: uuid.UUID, user_id: uuid.UUID):
    return select(Notification).where(Notification.organisation_id == org_id, Notification.user_id == user_id)


def list_stmt(org_id: uuid.UUID, user_id: uuid.UUID, *, unread: bool | None, type: str | None):
    stmt = _inbox(org_id, user_id)
    if unread is True:
        stmt = stmt.where(Notification.read_at.is_(None))
    elif unread is False:
        stmt = stmt.where(Notification.read_at.is_not(None))
    if type:
        stmt = stmt.where(Notification.type == type)
    return stmt.order_by(Notification.created_at.desc(), Notification.id.desc())


async def unread_count(db: AsyncSession, org_id: uuid.UUID, user_id: uuid.UUID) -> int:
    return int(
        await db.scalar(
            select(func.count())
            .select_from(Notification)
            .where(
                Notification.organisation_id == org_id,
                Notification.user_id == user_id,
                Notification.read_at.is_(None),
            )
        )
        or 0
    )


async def get_own(
    db: AsyncSession, org_id: uuid.UUID, user_id: uuid.UUID, notification_id: uuid.UUID
) -> Notification | None:
    return await db.scalar(_inbox(org_id, user_id).where(Notification.id == notification_id))


async def mark_all_read(db: AsyncSession, org_id: uuid.UUID, user_id: uuid.UUID) -> int:
    result = await db.execute(
        update(Notification)
        .where(
            Notification.organisation_id == org_id,
            Notification.user_id == user_id,
            Notification.read_at.is_(None),
        )
        .values(read_at=datetime.now(UTC))
    )
    return int(result.rowcount or 0)


# ----------------------------------------------------------------------------- preferences


async def get_or_create_pref(db: AsyncSession, user_id: uuid.UUID) -> NotificationPreference:
    pref = await db.scalar(select(NotificationPreference).where(NotificationPreference.user_id == user_id))
    if pref is None:
        pref = NotificationPreference(user_id=user_id, settings={}, push_subscriptions=[])
        db.add(pref)
        await db.flush()
    return pref


def effective_preferences(pref: NotificationPreference | None) -> list[dict[str, Any]]:
    stored = (pref.settings if pref else {}) or {}
    out = []
    for key, label in NOTIFICATION_TYPES.items():
        p = stored.get(key, {}) or {}
        out.append(
            {
                "type": key,
                "label": label,
                "in_app": bool(p.get("in_app", True)),
                "email": bool(p.get("email", key in EMAIL_DEFAULT)),
                "push": bool(p.get("push", False)),
            }
        )
    return out


def merge_preferences(pref: NotificationPreference, updates: dict[str, dict[str, bool]]) -> None:
    current = dict(pref.settings or {})
    for type_key, channels in updates.items():
        merged = dict(current.get(type_key, {}) or {})
        merged.update({c: bool(v) for c, v in channels.items() if v is not None})
        current[type_key] = merged
    pref.settings = current


def add_push_subscription(pref: NotificationPreference, sub: dict[str, Any]) -> None:
    subs = [s for s in (pref.push_subscriptions or []) if s.get("endpoint") != sub["endpoint"]]
    subs.append(sub)
    pref.push_subscriptions = subs[-MAX_PUSH_SUBSCRIPTIONS:]


def remove_push_subscription(pref: NotificationPreference, endpoint: str) -> bool:
    subs = list(pref.push_subscriptions or [])
    keep = [s for s in subs if s.get("endpoint") != endpoint]
    pref.push_subscriptions = keep
    return len(keep) != len(subs)


def push_public_config() -> dict[str, Any]:
    s = push_settings()
    return {
        "push_enabled": bool(s.VAPID_PUBLIC_KEY and s.VAPID_PRIVATE_KEY),
        "vapid_public_key": s.VAPID_PUBLIC_KEY,
    }
