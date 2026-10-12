"""Shared helpers for the courses / enrolments / progress / dashboard tests."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from httpx import AsyncClient

from app.core.db import get_sessionmaker
from app.models.assessment import Assessment, AssessmentAttempt
from app.models.assignment import Assignment
from app.models.simulation import Simulation
from tests.factories import Account, add_member, set_plan, signup

API = "/api/v1"


async def org_with_admin(client: AsyncClient, name: str = "Learning Org") -> Account:
    admin = await signup(client, org_name=name)
    await set_plan(admin.org_id, "business")
    return admin


async def create_course(client: AsyncClient, acct: Account, **kw: Any) -> dict[str, Any]:
    body = {"title": kw.pop("title", f"Course {uuid.uuid4().hex[:6]}"), **kw}
    r = await client.post(f"{API}/courses", json=body, headers=acct.headers)
    assert r.status_code == 201, r.text
    return r.json()


async def add_module(
    client: AsyncClient, acct: Account, course_id: str, title: str = "Module"
) -> dict[str, Any]:
    r = await client.post(f"{API}/courses/{course_id}/modules", json={"title": title}, headers=acct.headers)
    assert r.status_code == 201, r.text
    return r.json()


async def add_lesson(
    client: AsyncClient,
    acct: Account,
    course_id: str,
    module_id: str,
    title: str = "Lesson",
    lesson_type: str = "text",
    content: dict[str, Any] | None = None,
    **kw: Any,
) -> dict[str, Any]:
    if content is None and lesson_type == "text":
        content = {"body_markdown": f"# {title}\nBody"}
    body = {"title": title, "lesson_type": lesson_type, "content": content or {}, **kw}
    r = await client.post(
        f"{API}/courses/{course_id}/modules/{module_id}/lessons", json=body, headers=acct.headers
    )
    assert r.status_code == 201, r.text
    return r.json()


async def publish(client: AsyncClient, acct: Account, course_id: str, changelog: str = "v") -> dict[str, Any]:
    r = await client.post(
        f"{API}/courses/{course_id}/publish", json={"changelog": changelog}, headers=acct.headers
    )
    assert r.status_code == 200, r.text
    return r.json()


async def published_course(
    client: AsyncClient, acct: Account, n_lessons: int = 2, **course_kw: Any
) -> tuple[dict[str, Any], dict[str, Any], list[dict[str, Any]]]:
    course = await create_course(client, acct, **course_kw)
    module = await add_module(client, acct, course["id"])
    lessons = [
        await add_lesson(client, acct, course["id"], module["id"], title=f"L{i + 1}")
        for i in range(n_lessons)
    ]
    await publish(client, acct, course["id"])
    return course, module, lessons


async def learner_in(org_id: uuid.UUID, *roles: str) -> Account:
    return await add_member(org_id, *(roles or ("learner",)))


async def enrol(client: AsyncClient, learner: Account, course_id: str) -> dict[str, Any]:
    r = await client.post(f"{API}/enrolments", json={"course_id": course_id}, headers=learner.headers)
    assert r.status_code == 201, r.text
    return r.json()


async def insert(*rows: Any) -> list[Any]:
    """Insert rows owned by other modules directly (RLS bypass)."""
    async with get_sessionmaker()() as s:
        s.info["rls_bypass"] = True
        for row in rows:
            s.add(row)
        await s.commit()
        return list(rows)


async def make_assessment(org_id: uuid.UUID, title: str = "Quiz 1") -> Assessment:
    (a,) = await insert(Assessment(organisation_id=org_id, title=title, status="published"))
    return a


async def make_assignment(org_id: uuid.UUID, title: str = "Assignment 1", **kw: Any) -> Assignment:
    (a,) = await insert(
        Assignment(
            organisation_id=org_id,
            title=title,
            expected_output="SECRET MODEL ANSWER",
            status="published",
            **kw,
        )
    )
    return a


async def make_simulation(org_id: uuid.UUID, title: str = "Helpdesk sim") -> Simulation:
    (sim,) = await insert(Simulation(organisation_id=org_id, title=title, status="published"))
    return sim


async def graded_attempt(
    org_id: uuid.UUID, user_id: uuid.UUID, assessment_id: uuid.UUID, pct: float, n: int = 1
) -> AssessmentAttempt:
    now = datetime.now(UTC)
    (att,) = await insert(
        AssessmentAttempt(
            organisation_id=org_id,
            assessment_id=assessment_id,
            user_id=user_id,
            attempt_number=n,
            status="graded",
            started_at=now,
            submitted_at=now,
            score=pct,
            max_score=100,
            percentage=pct,
            passed=pct >= 70,
        )
    )
    return att
