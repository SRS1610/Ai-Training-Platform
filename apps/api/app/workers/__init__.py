"""Background work. Tasks live in ``app/modules/<name>/tasks.py`` and are registered with ``@task``.

``enqueue(name, **kwargs)`` sends a task to Celery, or runs it inline when
``CELERY_TASK_ALWAYS_EAGER`` is set (tests / single-process dev). Task functions are ``async`` and
receive JSON-serialisable keyword arguments; they open their own DB session via
``app.core.db.system_session(org_id)``.
"""

from __future__ import annotations

import asyncio
import importlib
import pkgutil
from collections.abc import Awaitable, Callable
from typing import Any

import structlog
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from app.core.config import settings

log = structlog.get_logger(__name__)
TaskFn = Callable[..., Awaitable[Any]]
TASKS: dict[str, TaskFn] = {}
_pending: set[asyncio.Task] = set()


def task(name: str) -> Callable[[TaskFn], TaskFn]:
    def decorator(fn: TaskFn) -> TaskFn:
        TASKS[name] = fn
        return fn

    return decorator


def load_task_modules() -> None:
    import app.modules as modules_pkg

    for mod in pkgutil.iter_modules(modules_pkg.__path__):
        try:
            importlib.import_module(f"app.modules.{mod.name}.tasks")
        except ModuleNotFoundError as exc:
            if exc.name != f"app.modules.{mod.name}.tasks":
                raise


async def run_task(name: str, **kwargs: Any) -> Any:
    if name not in TASKS:
        load_task_modules()
    return await TASKS[name](**kwargs)


AFTER_COMMIT_KEY = "praxis_after_commit_tasks"


@event.listens_for(Session, "after_commit")
def _dispatch_after_commit(session: Session) -> None:
    for name, kwargs in session.info.pop(AFTER_COMMIT_KEY, []):
        _dispatch(name, kwargs)


@event.listens_for(Session, "after_rollback")
def _discard_after_rollback(session: Session) -> None:
    session.info.pop(AFTER_COMMIT_KEY, None)


def _dispatch(name: str, kwargs: dict[str, Any]) -> None:
    if settings.CELERY_TASK_ALWAYS_EAGER:
        t = asyncio.get_running_loop().create_task(_safe_run(name, kwargs))
        _pending.add(t)
        t.add_done_callback(_pending.discard)
        return
    from app.workers.celery_app import celery_app

    celery_app.send_task("praxis.run", args=[name], kwargs=kwargs)


async def enqueue(
    name: str, *, db: AsyncSession | None = None, inline_await: bool = False, **kwargs: Any
) -> None:
    """Queue a task.

    Pass ``db`` whenever the task reads rows written in the current transaction: the task is then held
    until that transaction COMMITS (and dropped on rollback), so workers never race the writer.
    Without ``db`` the task is dispatched immediately. ``inline_await`` runs it inline in eager mode.
    """
    if db is not None and not inline_await:
        db.sync_session.info.setdefault(AFTER_COMMIT_KEY, []).append((name, kwargs))
        return
    if settings.CELERY_TASK_ALWAYS_EAGER:
        if inline_await:
            await run_task(name, **kwargs)
            return
        t = asyncio.get_running_loop().create_task(_safe_run(name, kwargs))
        _pending.add(t)
        t.add_done_callback(_pending.discard)
        return
    from app.workers.celery_app import celery_app

    celery_app.send_task("praxis.run", args=[name], kwargs=kwargs)


async def _safe_run(name: str, kwargs: dict[str, Any]) -> None:
    try:
        await run_task(name, **kwargs)
    except Exception:
        log.exception("task.failed", task=name)


async def drain() -> None:
    """Wait for eager background tasks (tests)."""
    while _pending:
        await asyncio.gather(*list(_pending), return_exceptions=True)
