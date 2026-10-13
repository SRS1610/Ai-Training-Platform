"""Demo seeder: the minimal profile builds a consistent, backdated demo dataset through the real API."""

from __future__ import annotations

import time
from datetime import UTC, datetime, timedelta

import pytest
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
from app.seed.build import Seeder
from app.seed.timeline import LOCAL_TZ, Clock, days_ago, earlier_today, local_today


def _last_utc(hour: int, minute: int) -> datetime:
    """The most recent instant (at or before now) with this UTC time of day."""
    now = datetime.now(UTC)
    t = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    return t if t <= now else t - timedelta(days=1)


@pytest.mark.parametrize(
    "pinned",
    [
        datetime(2026, 10, 12, 23, 30, tzinfo=UTC),  # 10:30 next day in Sydney: local date = UTC date + 1
        datetime(2026, 10, 13, 1, 0, tzinfo=UTC),  # 12:00 in Sydney
        datetime(2026, 10, 13, 13, 10, tzinfo=UTC),  # 00:10 in Sydney, just after local midnight
        datetime(2026, 6, 30, 14, 5, tzinfo=UTC),  # 00:05 in Sydney in winter (UTC+10)
    ],
)
def test_seed_clock_counts_local_days(pinned):
    """Whatever the UTC time of day, whole days back land on consecutive *local* calendar days (so streaks
    hold), "today" activity is on the local today and in the past, and due dates count from local today."""
    sd = Seeder(None, "minimal", log=lambda *_a: None, clock=Clock(pinned))  # type: ignore[arg-type]
    assert abs((sd.now - pinned).total_seconds()) < 5
    today = pinned.astimezone(LOCAL_TZ).date()
    assert sd.today == local_today(pinned) == today
    for k in range(1, 40):  # crosses the October daylight-saving change
        for hour in (9, 12, 16, 18):
            at = days_ago(k, hour, now=pinned)
            assert at.astimezone(LOCAL_TZ).date() == today - timedelta(days=k)
            assert at.astimezone(LOCAL_TZ).hour == hour and at < pinned
    t = earlier_today(pinned)
    assert t.astimezone(LOCAL_TZ).date() == today and t < pinned - timedelta(minutes=1)
    assert sd.due(5) == (today + timedelta(days=5)).isoformat()


async def _login(client, email: str) -> dict[str, str]:
    r = await client.post("/api/v1/auth/login", json={"email": email, "password": P.PASSWORD})
    assert r.status_code == 200, r.text
    client.cookies.clear()
    h = {"Authorization": f"Bearer {r.json()['tokens']['access_token']}"}
    me = (await client.get("/api/v1/me", headers=h)).json()
    h["X-Organisation-Id"] = me["organisation"]["id"]
    return h


async def test_minimal_seed_builds_consistent_demo_data(client, db):
    # Pin the seeder's clock to 23:30 UTC (10:30 the next morning in Sydney), the time of day at which UTC
    # and local calendar days disagree: the streak and due dates must still come out right.
    started = time.perf_counter()
    summary = await runner.seed("minimal", api=Api(client), log=lambda *_a, **_k: None, now=_last_utc(23, 30))
    assert time.perf_counter() - started < 150  # generous: ~50 s on a loaded machine
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

    # Timed attempts finish within their time limit; lesson positions are unique within a module; nobody
    # was enrolled before their account existed; nobody logged in in the future (seeded tenants only: the
    # test database is shared with the rest of the suite).
    orgs = list(
        (
            await db.execute(
                text(
                    "SELECT DISTINCT ou.organisation_id FROM organisation_users ou "
                    "JOIN users u ON u.id = ou.user_id WHERE u.email LIKE '%.demo'"
                )
            )
        ).scalars()
    )
    for sql in (
        "SELECT count(*) FROM assessment_attempts WHERE submitted_at > expires_at "
        "AND organisation_id = ANY(:o)",
        "SELECT count(*) FROM (SELECT module_id, position FROM lessons WHERE deleted_at IS NULL "
        "AND organisation_id = ANY(:o) GROUP BY 1, 2 HAVING count(*) > 1) d",
        "SELECT count(*) FROM enrolments e JOIN users u ON u.id = e.user_id "
        "WHERE e.created_at < u.created_at AND e.organisation_id = ANY(:o)",
        "SELECT count(*) FROM users u JOIN organisation_users ou ON ou.user_id = u.id "
        "WHERE u.last_login_at > now() AND ou.organisation_id = ANY(:o)",
        # An override reason is only given when the human grade really differs from the AI's.
        "SELECT count(*) FROM grades h JOIN grades a ON a.target_id = h.target_id AND a.source = 'ai' "
        "WHERE h.source = 'human' AND h.override_reason IS NOT NULL AND abs(h.score - a.score) <= 0.05 "
        "AND h.organisation_id = ANY(:o)",
    ):
        assert await db.scalar(text(sql), {"o": orgs}) == 0, sql

    # Alex: an in-progress course due soon, a completed course with a valid certificate, a streak
    alex = next(u for u in users if u.email == "learner@northwind.demo")
    enrols = (await db.execute(select(Enrolment).where(Enrolment.user_id == alex.id))).scalars().all()
    it = next(e for e in enrols if e.course_id == course.id)
    assert it.status == "in_progress" and 30 < it.progress_pct < 100
    local = local_today()
    assert local < it.due_date <= local + timedelta(days=7)
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
    # The AI recommendation's summary quotes the score that was persisted.
    for score, summary in (
        await db.execute(
            select(Grade.score, Grade.summary).where(
                Grade.organisation_id == nw.id, Grade.source == "ai", Grade.target_type == "submission"
            )
        )
    ).all():
        assert f"({score:g}/100)" in summary, (score, summary)
    cost = await db.scalar(select(func.sum(AIUsage.cost_usd)).where(AIUsage.organisation_id == nw.id))
    assert cost and float(cost) > 0.5

    # Tenancy: the second organisation can't see Northwind's course
    ch = await _login(client, "learner@contoso.demo")
    assert (await client.get(f"/api/v1/courses/{course.id}", headers=ch)).status_code == 404
