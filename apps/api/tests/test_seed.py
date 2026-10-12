"""Demo seeder: the minimal profile builds a consistent, backdated demo dataset through the real API."""

from __future__ import annotations

import time
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import func, select, text

from app.models.ai import AIMessage, AISession, AIUsage
from app.models.assignment import Grade
from app.models.content import Course, CourseVersion
from app.models.identity import User
from app.models.learning import Enrolment
from app.models.platform import Certificate, Payment
from app.models.simulation import SimulationSession
from app.models.tenancy import Organisation
from app.seed import people as P
from app.seed import runner
from app.seed.api import Api


async def _login(client, email: str) -> dict[str, str]:
    r = await client.post("/api/v1/auth/login", json={"email": email, "password": P.PASSWORD})
    assert r.status_code == 200, r.text
    client.cookies.clear()
    h = {"Authorization": f"Bearer {r.json()['tokens']['access_token']}"}
    me = (await client.get("/api/v1/me", headers=h)).json()
    h["X-Organisation-Id"] = me["organisation"]["id"]
    return h


async def test_minimal_seed_builds_consistent_demo_data(client, db):
    started = time.perf_counter()
    summary = await runner.seed("minimal", api=Api(client), log=lambda *_a, **_k: None)
    assert time.perf_counter() - started < 60
    assert summary["counts"]["certificates"] >= 3

    # Organisations, plans, branding and the idempotency marker
    nw = await db.scalar(select(Organisation).where(Organisation.name == "Northwind Technologies"))
    assert nw.plan_code == "enterprise" and nw.branding["primary_color"] == "#4f46e5"
    assert nw.settings["gamification_enabled"] is True and nw.settings["demo_seed"]["profile"] == "minimal"
    assert (await runner.existing_seed())["profile"] == "minimal"
    contoso = await db.scalar(select(Organisation).where(Organisation.name == "Contoso Training Co"))
    assert contoso.plan_code == "business"
    assert (
        await db.scalar(
            select(func.count()).select_from(Payment).where(Payment.organisation_id == contoso.id)
        )
        >= 3
    )

    users = (await db.execute(select(User).where(User.email.like("%.demo")))).scalars().all()
    assert all(u.email_verified_at is not None for u in users)
    assert next(u for u in users if u.email == P.SUPERADMIN["email"]).is_superadmin

    # Flagship course: published twice, learners pinned to both versions
    course = await db.scalar(
        select(Course).where(
            Course.organisation_id == nw.id, Course.title == "IT Support Troubleshooting Fundamentals"
        )
    )
    versions = (
        await db.execute(
            select(CourseVersion.id, CourseVersion.version_number).where(CourseVersion.course_id == course.id)
        )
    ).all()
    assert sorted(v for _, v in versions) == [1, 2]
    pinned = {
        v
        for (v,) in (
            await db.execute(
                select(CourseVersion.version_number)
                .join(Enrolment, Enrolment.course_version_id == CourseVersion.id)
                .where(Enrolment.course_id == course.id)
            )
        ).all()
    }
    assert pinned == {1, 2}
    assert len(course.learning_objectives) >= 5

    # ~90 days of history, causally ordered, nothing in the future
    now = datetime.now(UTC)
    first, last = (
        await db.execute(
            select(func.min(Enrolment.created_at), func.max(Enrolment.created_at)).where(
                Enrolment.organisation_id == nw.id
            )
        )
    ).one()
    assert (now - first) > timedelta(days=60) and last <= now
    bad = await db.scalar(
        text(
            "SELECT count(*) FROM lesson_progress lp JOIN enrolments e ON e.id = lp.enrolment_id "
            "WHERE coalesce(lp.completed_at, lp.created_at) < e.created_at OR lp.completed_at > now()"
        )
    )
    assert bad == 0

    # Alex: an in-progress course due soon, a completed course with a valid certificate, a streak
    alex = next(u for u in users if u.email == "learner@northwind.demo")
    enrols = (await db.execute(select(Enrolment).where(Enrolment.user_id == alex.id))).scalars().all()
    it = next(e for e in enrols if e.course_id == course.id)
    assert it.status == "in_progress" and 30 < it.progress_pct < 100
    assert date.today() < it.due_date <= date.today() + timedelta(days=7)
    assert any(e.status == "completed" for e in enrols)
    cert = await db.scalar(select(Certificate).where(Certificate.user_id == alex.id))
    r = await client.get(f"/api/v1/verify/{cert.certificate_number}")
    assert r.status_code == 200 and r.json()["valid"] is True, r.text
    bands = {
        b
        for (b,) in (
            await db.execute(select(SimulationSession.band).where(SimulationSession.user_id == alex.id))
        ).all()
    }
    assert {"Needs Improvement", "Competent"} <= bands

    h = await _login(client, "learner@northwind.demo")
    dash = (await client.get("/api/v1/dashboard/learner", headers=h)).json()
    assert dash["stats"]["streak_days"] >= 5
    assert dash["stats"]["courses_in_progress"] >= 1 and dash["stats"]["certificates"] >= 1
    assert dash["recommendations"]

    # Tutor: a grounded explanation with citations, and hint mode during the graded simulation
    modes = (
        await db.execute(
            select(AIMessage.mode, AIMessage.citations)
            .join(AISession, AISession.id == AIMessage.session_id)
            .where(AISession.user_id == alex.id, AIMessage.role == "assistant")
        )
    ).all()
    assert any(m == "hint" for m, _ in modes)
    assert any(m == "explain" and c for m, c in modes)

    # Grading: AI recommendation plus a human final grade that overrides it with a reason
    assert (
        await db.scalar(
            select(func.count())
            .select_from(Grade)
            .where(
                Grade.organisation_id == nw.id, Grade.source == "human", Grade.override_reason.is_not(None)
            )
        )
        >= 1
    )
    cost = await db.scalar(select(func.sum(AIUsage.cost_usd)).where(AIUsage.organisation_id == nw.id))
    assert cost and float(cost) > 0.5

    # Tenancy: the second organisation can't see Northwind's course
    ch = await _login(client, "learner@contoso.demo")
    assert (await client.get(f"/api/v1/courses/{course.id}", headers=ch)).status_code == 404
