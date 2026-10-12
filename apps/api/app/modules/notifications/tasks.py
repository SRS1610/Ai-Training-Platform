"""Background tasks: due-date reminders (hourly via beat) and Web Push delivery."""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Any

import structlog
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import system_session
from app.models.assignment import Assignment, Submission, SubmissionStatus
from app.models.content import Course
from app.models.learning import Enrolment, EnrolmentStatus
from app.models.platform import Notification
from app.modules.notifications.service import deliver_push, push_sweep, send_notification
from app.workers import task

log = structlog.get_logger(__name__)

DUE_SOON_DAYS = 3
OPEN_SUBMISSION_STATUSES = (SubmissionStatus.DRAFT, SubmissionStatus.RETURNED)


def _days_word(days: int) -> str:
    return "today" if days == 0 else ("tomorrow" if days == 1 else f"in {days} days")


async def _enrolment_reminders(db: AsyncSession, today: date) -> dict[str, int]:
    counts = {"due": 0, "overdue": 0}
    rows = (
        await db.execute(
            select(Enrolment, Course.title)
            .join(Course, Course.id == Enrolment.course_id)
            .where(
                Enrolment.due_date.is_not(None),
                Enrolment.status.in_([EnrolmentStatus.NOT_STARTED, EnrolmentStatus.IN_PROGRESS]),
                Enrolment.due_date <= today + timedelta(days=DUE_SOON_DAYS),
                Course.deleted_at.is_(None),
            )
        )
    ).all()
    for enrolment, course_title in rows:
        sent = dict(enrolment.reminders_sent or {})
        due = enrolment.due_date
        assert due is not None
        if due < today:
            key = f"overdue:{due.isoformat()}"
            if key in sent:
                continue
            await send_notification(
                db,
                organisation_id=enrolment.organisation_id,
                user_id=enrolment.user_id,
                type="assignment_overdue",
                title=f"Overdue: {course_title}",
                body=f'"{course_title}" was due on {due.isoformat()}. Please complete it as soon as possible.',
                link=f"/app/learn/{enrolment.course_id}",
                data={
                    "enrolment_id": str(enrolment.id),
                    "course_id": str(enrolment.course_id),
                    "due_date": due.isoformat(),
                },
            )
            counts["overdue"] += 1
        else:
            key = f"due_soon:{due.isoformat()}"
            if key in sent:
                continue
            days = (due - today).days
            await send_notification(
                db,
                organisation_id=enrolment.organisation_id,
                user_id=enrolment.user_id,
                type="assignment_due",
                title=f"Due {_days_word(days)}: {course_title}",
                body=f'"{course_title}" is due on {due.isoformat()} ({enrolment.progress_pct:.0f}% complete).',
                link=f"/app/learn/{enrolment.course_id}",
                data={
                    "enrolment_id": str(enrolment.id),
                    "course_id": str(enrolment.course_id),
                    "due_date": due.isoformat(),
                },
            )
            counts["due"] += 1
        sent[key] = datetime.now(UTC).isoformat()
        enrolment.reminders_sent = sent
    await db.flush()
    return counts


async def _already_notified(
    db: AsyncSession, user_id: uuid.UUID, type_: str, submission_id: uuid.UUID, due_key: str
) -> bool:
    return (
        await db.scalar(
            select(Notification.id)
            .where(
                Notification.user_id == user_id,
                Notification.type == type_,
                Notification.data["submission_id"].astext == str(submission_id),
                Notification.data["due_at"].astext == due_key,
            )
            .limit(1)
        )
        is not None
    )


async def _submission_reminders(db: AsyncSession, now: datetime) -> dict[str, int]:
    counts = {"due": 0, "overdue": 0}
    rows = (
        await db.execute(
            select(Submission, Assignment.title)
            .join(
                Assignment, and_(Assignment.id == Submission.assignment_id, Assignment.deleted_at.is_(None))
            )
            .where(
                Submission.due_at.is_not(None),
                Submission.status.in_(OPEN_SUBMISSION_STATUSES),
                Submission.due_at <= now + timedelta(days=DUE_SOON_DAYS),
            )
        )
    ).all()
    for sub, title in rows:
        due_at = sub.due_at
        assert due_at is not None
        due_key = due_at.astimezone(UTC).isoformat()
        overdue = due_at < now
        type_ = "assignment_overdue" if overdue else "assignment_due"
        if await _already_notified(db, sub.user_id, type_, sub.id, due_key):
            continue
        if overdue:
            n_title = f"Overdue: {title}"
            body = f'Your submission for "{title}" was due on {due_at:%Y-%m-%d %H:%M} UTC.'
        else:
            n_title = f"Due soon: {title}"
            body = f'Your submission for "{title}" is due on {due_at:%Y-%m-%d %H:%M} UTC.'
        await send_notification(
            db,
            organisation_id=sub.organisation_id,
            user_id=sub.user_id,
            type=type_,
            title=n_title,
            body=body,
            link=f"/app/assignments/{sub.assignment_id}",
            data={"submission_id": str(sub.id), "assignment_id": str(sub.assignment_id), "due_at": due_key},
        )
        counts["overdue" if overdue else "due"] += 1
    return counts


async def run_due_reminders(db: AsyncSession, *, now: datetime | None = None) -> dict[str, Any]:
    now = now or datetime.now(UTC)
    enrol = await _enrolment_reminders(db, now.date())
    subs = await _submission_reminders(db, now)
    pushed = await push_sweep(db)
    return {"enrolments": enrol, "submissions": subs, "push_delivered": pushed}


@task("notifications.due_reminders")
async def due_reminders(**_: Any) -> dict[str, Any]:
    """Hourly: due-soon (≤3 days) and overdue reminders for enrolments and assignment submissions."""
    async with system_session() as db:
        result = await run_due_reminders(db)
    log.info("notifications.due_reminders", **result)
    return result


@task("notifications.deliver_push")
async def deliver_push_task(notification_id: str, **_: Any) -> str | None:
    async with system_session() as db:
        n = await db.get(Notification, uuid.UUID(notification_id))
        if n is None or (n.channels or {}).get("push") != "queued":
            return None  # not committed yet (picked up by the sweep) or already delivered
        return await deliver_push(db, n)


@task("notifications.push_sweep")
async def push_sweep_task(**_: Any) -> int:
    async with system_session() as db:
        return await push_sweep(db)
