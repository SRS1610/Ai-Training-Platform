"""Notification entry point used by all modules. Creates an in-app notification and dispatches email
(and Web Push when subscribed) according to the user's preferences. Delivery is best-effort and never
breaks the calling transaction."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.email import send_email
from app.models.identity import User
from app.models.platform import Notification, NotificationPreference

# Types emailed by default (others are in-app only unless the user opts in).
EMAIL_DEFAULT = {
    "assignment_assigned", "assignment_due", "assignment_overdue", "course_completed", "certificate_issued",
    "instructor_feedback", "training_assigned", "ai_budget_alert", "assessment_failed",
}


async def notify(
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
    pref = await db.scalar(select(NotificationPreference).where(NotificationPreference.user_id == user_id))
    channel_prefs = ((pref.settings if pref else {}) or {}).get(type, {})
    channels: dict[str, str] = {"in_app": "delivered"}
    n = Notification(organisation_id=organisation_id, user_id=user_id, type=type, title=title, body=body,
                     link=link, data=data or {}, channels=channels)
    if channel_prefs.get("in_app", True):
        db.add(n)
    if channel_prefs.get("email", type in EMAIL_DEFAULT):
        user = await db.get(User, user_id)
        if user and user.email:
            await send_email(user.email, title, [body] if body else [title],
                             f"{settings.PUBLIC_WEB_URL}{link}" if link else None, "View")
            channels["email"] = "sent"
    if channel_prefs.get("push", False) and pref and pref.push_subscriptions:
        channels["push"] = "queued"  # Web Push delivery handled by the notifications worker
    n.channels = channels
    await db.flush()
    return n
