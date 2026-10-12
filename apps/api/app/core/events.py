"""In-process domain event bus.

Handlers run synchronously inside the emitting transaction (same ``AsyncSession``), so side effects such
as marking a lesson complete or issuing a certificate commit or roll back atomically with the cause.
Slow follow-up work (emails, AI grading, PDF rendering) should be *enqueued* from a handler via
``app.workers.enqueue``.

Event catalogue (payloads always include ``organisation_id`` and ``user_id`` as ``uuid.UUID``):

==============================  ==================================================================
``enrolment.created``           enrolment_id, course_id, assigned_by (optional), due_date (optional)
``lesson.completed``            enrolment_id, course_id, lesson_id
``course.completed``            enrolment_id, course_id, course_version_id, final_score
``assessment.attempt_graded``   attempt_id, assessment_id, course_id, percentage, passed
``submission.submitted``        submission_id, assignment_id, course_id, version_number
``submission.graded``           submission_id, assignment_id, course_id, final_score, passed, grade_id
``simulation.completed``        session_id, simulation_id, course_id, total_score, band, passed
``certificate.issued``          certificate_id, course_id, certificate_number
``generation.completed``        generation_id, kind (user_id = requester)
==============================  ==================================================================
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Awaitable, Callable
from typing import Any

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

log = structlog.get_logger(__name__)

Handler = Callable[[AsyncSession, dict[str, Any]], Awaitable[None]]
_handlers: dict[str, list[Handler]] = defaultdict(list)


def subscribe(event: str) -> Callable[[Handler], Handler]:
    def decorator(fn: Handler) -> Handler:
        if fn not in _handlers[event]:
            _handlers[event].append(fn)
        return fn

    return decorator


async def emit(db: AsyncSession, event: str, payload: dict[str, Any]) -> None:
    for handler in list(_handlers.get(event, [])):
        log.debug("event.dispatch", event_name=event, handler=handler.__qualname__)
        await handler(db, payload)


def handlers_for(event: str) -> list[Handler]:
    return list(_handlers.get(event, []))
