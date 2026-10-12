"""Celery application. A single generic task dispatches to the async task registry in ``app.workers``.

Run:  celery -A app.workers.celery_app worker -l info -Q default,ai
      celery -A app.workers.celery_app beat -l info
"""

from __future__ import annotations

import asyncio

from celery import Celery
from celery.schedules import crontab

from app.core.config import settings
from app.core.logging import configure_logging

celery_app = Celery("praxis", broker=settings.celery_broker, backend=None)
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    task_default_queue="default",
    task_routes={"praxis.run": {"queue": "default"}},
    broker_connection_retry_on_startup=True,
    beat_schedule={
        "due-date-reminders": {"task": "praxis.run", "schedule": crontab(minute=0, hour="*"),
                               "args": ["notifications.due_reminders"]},
        "ai-budget-check": {"task": "praxis.run", "schedule": crontab(minute="*/15"),
                            "args": ["ai.budget_check"]},
        "retention-sweep": {"task": "praxis.run", "schedule": crontab(minute=30, hour=3),
                            "args": ["privacy.retention_sweep"]},
    },
)

_loop: asyncio.AbstractEventLoop | None = None


def _get_loop() -> asyncio.AbstractEventLoop:
    global _loop
    if _loop is None or _loop.is_closed():
        _loop = asyncio.new_event_loop()
        asyncio.set_event_loop(_loop)
    return _loop


@celery_app.on_after_configure.connect
def _setup(sender, **_kw):  # noqa: ANN001
    configure_logging()


@celery_app.task(name="praxis.run", bind=True, max_retries=3, default_retry_delay=30)
def run(self, name: str, **kwargs):  # noqa: ANN001
    from app.workers import run_task

    try:
        return _get_loop().run_until_complete(run_task(name, **kwargs))
    except Exception as exc:  # retry transient failures with backoff
        raise self.retry(exc=exc, countdown=30 * (2 ** self.request.retries)) from exc
