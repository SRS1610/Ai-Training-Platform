"""Shared arrangement helpers for the AI test modules (rows inserted directly with RLS bypass)."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Any

from httpx import AsyncClient
from praxis_ai.providers.base import AIProvider
from praxis_ai.results import ChatResult, ProviderError

from app.core.db import get_sessionmaker
from app.models.content import Course, CourseModule, CourseVersion, Lesson, Skill
from app.models.learning import Enrolment
from app.workers import drain


@asynccontextmanager
async def bypass_session() -> AsyncIterator[Any]:
    async with get_sessionmaker()() as s:
        s.info["rls_bypass"] = True
        try:
            yield s
            await s.commit()
        except Exception:
            await s.rollback()
            raise


async def make_skill(org_id: uuid.UUID, name: str) -> uuid.UUID:
    async with bypass_session() as s:
        sk = Skill(organisation_id=org_id, name=name)
        s.add(sk)
        await s.flush()
        return sk.id


async def make_course(
    org_id: uuid.UUID,
    author_id: uuid.UUID,
    *,
    title: str = "Helpdesk Fundamentals",
    lessons: Sequence[dict[str, Any]] = (),
    publish: bool = True,
    skill_ids: Sequence[uuid.UUID] = (),
) -> dict[str, Any]:
    """Create a course with one module and the given lessons ({title, body, skill_ids}); optionally publish a
    schema-v1 snapshot. Returns ids."""
    async with bypass_session() as s:
        course = Course(
            organisation_id=org_id,
            slug=f"c-{uuid.uuid4().hex[:8]}",
            title=title,
            description=f"{title} description",
            status="published" if publish else "draft",
            created_by=author_id,
        )
        s.add(course)
        await s.flush()
        if skill_ids:
            from app.models.content import course_skills

            await s.execute(
                course_skills.insert(), [{"course_id": course.id, "skill_id": sid} for sid in skill_ids]
            )
        module = CourseModule(organisation_id=org_id, course_id=course.id, title="Module 1", position=0)
        s.add(module)
        await s.flush()
        snap_lessons = []
        lesson_ids = []
        for i, spec in enumerate(lessons):
            lsn = Lesson(
                organisation_id=org_id,
                course_id=course.id,
                module_id=module.id,
                title=spec["title"],
                lesson_type="text",
                content={"body_markdown": spec.get("body", "")},
                position=i,
                skill_ids=[str(x) for x in spec.get("skill_ids", [])],
            )
            s.add(lsn)
            await s.flush()
            lesson_ids.append(lsn.id)
            snap_lessons.append(
                {
                    "id": str(lsn.id),
                    "module_id": str(module.id),
                    "title": lsn.title,
                    "summary": None,
                    "lesson_type": "text",
                    "content": lsn.content,
                    "position": i,
                    "is_required": True,
                    "skill_ids": lsn.skill_ids,
                    "activities": [],
                }
            )
        version_id = None
        if publish:
            snapshot = {
                "schema_version": 1,
                "course": {
                    "id": str(course.id),
                    "title": title,
                    "description": course.description,
                    "learning_objectives": [],
                    "skills": [{"id": str(x)} for x in skill_ids],
                },
                "modules": [
                    {"id": str(module.id), "title": module.title, "position": 0, "lessons": snap_lessons}
                ],
            }
            v = CourseVersion(
                organisation_id=org_id,
                course_id=course.id,
                version_number=1,
                snapshot=snapshot,
                published_at=datetime.now(UTC),
            )
            s.add(v)
            await s.flush()
            course.current_version_id = v.id
            version_id = v.id
        return {
            "course_id": course.id,
            "module_id": module.id,
            "lesson_ids": lesson_ids,
            "version_id": version_id,
        }


async def enrol(org_id: uuid.UUID, user_id: uuid.UUID, course: dict[str, Any]) -> uuid.UUID:
    async with bypass_session() as s:
        e = Enrolment(
            organisation_id=org_id,
            user_id=user_id,
            course_id=course["course_id"],
            course_version_id=course["version_id"],
            status="in_progress",
            progress_pct=20.0,
        )
        s.add(e)
        await s.flush()
        return e.id


async def add_kb_text(
    client: AsyncClient,
    headers: dict[str, str],
    title: str,
    text: str,
    *,
    course_id: uuid.UUID | None = None,
    approve: bool = True,
) -> dict[str, Any]:
    body: dict[str, Any] = {"title": title, "text": text}
    if course_id:
        body["course_id"] = str(course_id)
    r = await client.post("/api/v1/knowledge/documents/text", json=body, headers=headers)
    assert r.status_code == 202, r.text
    await drain()
    doc_id = r.json()["id"]
    if approve:
        r = await client.post(f"/api/v1/knowledge/documents/{doc_id}/approve", headers=headers)
        assert r.status_code == 200, r.text
    r = await client.get(f"/api/v1/knowledge/documents/{doc_id}", headers=headers)
    assert r.json()["status"] == "ready", r.json()
    return r.json()


class FakeProvider(AIProvider):
    """Scripted provider: returns ``replies`` in order (last one repeats) and records every call."""

    name = "openai"

    def __init__(
        self,
        *replies: str,
        fail: bool = False,
        tokens: tuple[int, int] = (100, 50),
        model: str = "gpt-4o-mini",
    ) -> None:
        from app.core.config import settings

        super().__init__(embedding_dim=settings.AI_EMBEDDING_DIM)
        self.replies = list(replies) or ["ok"]
        self.fail = fail
        self.calls: list[list[dict[str, Any]]] = []
        self.tokens = tokens
        self.model = model

    async def chat(self, messages, *, model=None, temperature=0.3, max_tokens=1024, json_mode=False):  # noqa: ANN001
        self.calls.append(
            [
                {
                    "role": getattr(m, "role", None) or m["role"],
                    "content": getattr(m, "content", None) or m["content"],
                }
                for m in messages
            ]
        )
        if self.fail:
            raise ProviderError("boom", provider="openai", status=503, retryable=True)
        text = self.replies.pop(0) if len(self.replies) > 1 else self.replies[0]
        return ChatResult(
            text=text,
            tokens_in=self.tokens[0],
            tokens_out=self.tokens[1],
            model=self.model,
            provider="openai",
        )

    async def embed(self, texts, *, model=None):  # noqa: ANN001
        from praxis_ai.providers import OfflineProvider

        return await OfflineProvider(embedding_dim=self.embedding_dim).embed(texts)

    def prompt_text(self) -> str:
        return "\n".join(m["content"] for call in self.calls for m in call)
