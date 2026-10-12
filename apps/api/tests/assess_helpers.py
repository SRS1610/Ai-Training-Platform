"""Arrange helpers for assessment / assignment / certificate tests (direct model inserts, RLS bypass)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from app.core.db import get_sessionmaker
from app.models.content import Course, CourseVersion
from app.models.learning import Enrolment

API = "/api/v1"


async def make_course(org_id: uuid.UUID, *, title: str = "Network Fundamentals", instructor_id: uuid.UUID | None = None,
                      **fields: Any) -> tuple[uuid.UUID, uuid.UUID]:
    """Create a published course with one version. Returns (course_id, version_id)."""
    async with get_sessionmaker()() as s:
        s.info["rls_bypass"] = True
        course = Course(organisation_id=org_id, slug=f"c-{uuid.uuid4().hex[:8]}", title=title, status="published",
                        instructor_id=instructor_id, **fields)
        s.add(course)
        await s.flush()
        version = CourseVersion(organisation_id=org_id, course_id=course.id, version_number=1,
                                snapshot={"title": title}, published_at=datetime.now(UTC))
        s.add(version)
        await s.flush()
        course.current_version_id = version.id
        await s.commit()
        return course.id, version.id


async def enrol(org_id: uuid.UUID, user_id: uuid.UUID, course_id: uuid.UUID, version_id: uuid.UUID) -> uuid.UUID:
    async with get_sessionmaker()() as s:
        s.info["rls_bypass"] = True
        e = Enrolment(organisation_id=org_id, user_id=user_id, course_id=course_id, course_version_id=version_id,
                      status="in_progress", started_at=datetime.now(UTC))
        s.add(e)
        await s.commit()
        return e.id


async def update_row(model: type, row_id: uuid.UUID, **values: Any) -> None:
    async with get_sessionmaker()() as s:
        s.info["rls_bypass"] = True
        row = await s.get(model, row_id)
        for k, v in values.items():
            setattr(row, k, v)
        await s.commit()


async def fetch(model: type, row_id: uuid.UUID) -> Any:
    async with get_sessionmaker()() as s:
        s.info["rls_bypass"] = True
        return await s.get(model, row_id)
