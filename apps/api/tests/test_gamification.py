"""Gamification: points via events, badges, levels, streaks, leaderboard, admin badge CRUD, disabled orgs."""

from __future__ import annotations

import uuid
from datetime import timedelta

from sqlalchemy import func, select

from app.core.db import get_sessionmaker
from app.models.learning import ActivityDay
from app.models.platform import Notification, PointsLedger
from app.modules.gamification import service as g
from tests.factories import add_member, set_plan, signup
from tests.ops_seed import (
    complete_lessons,
    emit_event,
    enrol,
    seed_assessment,
    seed_attempt,
    seed_course,
    seed_sim_session,
    seed_simulation,
    tenant_session,
    today,
)

API = "/api/v1/gamification"


async def _ledger_total(org_id, user_id) -> int:
    async with get_sessionmaker()() as s:
        s.info["rls_bypass"] = True
        return int(
            await s.scalar(
                select(func.coalesce(func.sum(PointsLedger.points), 0)).where(
                    PointsLedger.organisation_id == org_id, PointsLedger.user_id == user_id
                )
            )
        )


async def _ledger_by_reason(org_id, user_id) -> dict[str, int]:
    async with get_sessionmaker()() as s:
        s.info["rls_bypass"] = True
        rows = await s.execute(
            select(PointsLedger.reason, func.sum(PointsLedger.points))
            .where(PointsLedger.organisation_id == org_id, PointsLedger.user_id == user_id)
            .group_by(PointsLedger.reason)
        )
        return {r: int(n) for r, n in rows.all()}


def test_levels():
    assert g.level_for(0)["level"] == 1
    lvl = g.level_for(175)
    assert lvl["level"] == 2 and lvl["next_level_points"] == 250 and lvl["progress_pct"] == 50.0
    top = g.level_for(10**6)
    assert top["level"] == 10 and top["next_level"] is None and top["progress_pct"] == 100.0


async def test_points_badges_and_me(client):
    admin = await signup(client)
    learner = await add_member(admin.org_id, "learner")
    org, uid = admin.org_id, learner.user_id
    async with tenant_session(org) as s:
        course = await seed_course(s, org, modules=1, lessons_per_module=2)
        e = await enrol(s, org, uid, course)
        await complete_lessons(s, org, e, course.lessons[:1])
        assessment, qs = await seed_assessment(
            s, org, course.id, questions=[{"prompt": "Q1"}, {"prompt": "Q2"}]
        )
        await seed_attempt(s, org, uid, assessment, {qs[0].id: True, qs[1].id: True})
        sim, sc = await seed_simulation(s, org, course.id)
        await seed_sim_session(s, org, uid, sim, sc, score=95, band="Expert", passed=True, dimensions={})

    lesson_id = course.lessons[0].id
    await emit_event(
        org,
        "lesson.completed",
        {"user_id": uid, "enrolment_id": e.id, "course_id": course.id, "lesson_id": lesson_id},
    )
    # re-completing the same lesson does not double-award
    await emit_event(
        org,
        "lesson.completed",
        {"user_id": uid, "enrolment_id": e.id, "course_id": course.id, "lesson_id": lesson_id},
    )
    assert await _ledger_total(org, uid) == 10

    await emit_event(
        org,
        "assessment.attempt_graded",
        {
            "user_id": uid,
            "attempt_id": uuid.uuid4(),
            "assessment_id": assessment.id,
            "course_id": course.id,
            "percentage": 100.0,
            "passed": True,
        },
    )
    assert await _ledger_total(org, uid) == 10 + 50 + 50
    # failed attempts earn nothing
    await emit_event(
        org,
        "assessment.attempt_graded",
        {
            "user_id": uid,
            "attempt_id": uuid.uuid4(),
            "assessment_id": uuid.uuid4(),
            "course_id": course.id,
            "percentage": 20.0,
            "passed": False,
        },
    )
    assert await _ledger_total(org, uid) == 110

    # simulation: best-of per simulation
    sim_payload = {
        "user_id": uid,
        "session_id": uuid.uuid4(),
        "simulation_id": sim.id,
        "course_id": course.id,
        "total_score": 60,
        "band": "developing",
        "passed": True,
    }
    await emit_event(org, "simulation.completed", sim_payload)
    assert await _ledger_total(org, uid) == 160
    await emit_event(org, "simulation.completed", {**sim_payload, "band": "expert", "total_score": 95})
    assert await _ledger_total(org, uid) == 260
    await emit_event(org, "simulation.completed", {**sim_payload, "band": "novice"})
    assert await _ledger_total(org, uid) == 260

    await emit_event(
        org,
        "submission.graded",
        {
            "user_id": uid,
            "submission_id": uuid.uuid4(),
            "assignment_id": uuid.uuid4(),
            "course_id": course.id,
            "final_score": 80,
            "passed": True,
        },
    )
    await emit_event(
        org,
        "course.completed",
        {"user_id": uid, "enrolment_id": e.id, "course_id": course.id, "final_score": 90},
    )
    await emit_event(
        org,
        "certificate.issued",
        {
            "user_id": uid,
            "certificate_id": uuid.uuid4(),
            "course_id": course.id,
            "certificate_number": "CERT-1",
        },
    )
    by_reason = await _ledger_by_reason(org, uid)
    assert by_reason["assignment_passed"] == 75 and by_reason["course_completed"] == 200
    # The certificates module may auto-issue a certificate on course.completed (another +100).
    assert by_reason["certificate_issued"] in (100, 200)
    total = await _ledger_total(org, uid)
    assert total == 260 + 75 + 200 + by_reason["certificate_issued"]

    r = await client.get(f"{API}/me", headers=learner.headers)
    assert r.status_code == 200, r.text
    me = r.json()
    assert me["enabled"] is True
    assert me["points"] == total
    assert me["level"] == g.level_for(total) and me["level"]["name"] == "Practitioner"
    earned = {b["key"] for b in me["badges"]}
    assert {"first_steps", "quiz_ace", "simulation_expert"} <= earned, earned
    assert "course_finisher" not in earned  # enrolment row is not completed in the DB
    assert me["streak"]["current"] == 1 and me["streak"]["active_today"] is True
    assert me["rank"] == 1
    assert me["recent_points"][0]["reason"] in ("certificate_issued", "course_completed")

    async with get_sessionmaker()() as s:
        s.info["rls_bypass"] = True
        types = (
            (
                await s.execute(
                    select(Notification.title).where(
                        Notification.user_id == uid, Notification.type == "badge_earned"
                    )
                )
            )
            .scalars()
            .all()
        )
    assert "Badge earned: Quiz Ace" in types


async def test_streaks_and_streak_badge(client):
    admin = await signup(client)
    org, uid = admin.org_id, admin.user_id
    async with tenant_session(org) as s:
        for d in range(0, 7):  # today and the 6 days before
            s.add(ActivityDay(organisation_id=org, user_id=uid, day=today() - timedelta(days=d)))
        for d in range(20, 22):  # an older 2-day island
            s.add(ActivityDay(organisation_id=org, user_id=uid, day=today() - timedelta(days=d)))
    async with tenant_session(org) as s:
        st = await g.streak(s, org, uid)
        assert st["current"] == 7 and st["longest"] == 7
        awarded = await g.evaluate_badges(s, org, uid)
        assert "streak_7" in {b.key for b in awarded}
        # streak broken if last activity was 2+ days ago
        assert (await g.streak(s, org, uid, today=today() + timedelta(days=2)))["current"] == 0


async def test_leaderboard_period_department_and_opt_out(client):
    admin = await signup(client)
    org = admin.org_id
    a = await add_member(org, "learner", full_name="Alice")
    b = await add_member(org, "learner", full_name="Bob")
    c = await add_member(org, "learner", full_name="Carol")
    async with tenant_session(org) as s:
        from app.models.tenancy import Department, OrganisationUser

        dept = Department(organisation_id=org, name="Support")
        s.add(dept)
        await s.flush()
        m = await s.scalar(
            select(OrganisationUser).where(
                OrganisationUser.organisation_id == org, OrganisationUser.user_id == b.user_id
            )
        )
        m.department_id = dept.id
        s.add_all(
            [
                PointsLedger(organisation_id=org, user_id=a.user_id, points=300, reason="x"),
                PointsLedger(organisation_id=org, user_id=b.user_id, points=100, reason="x"),
                PointsLedger(
                    organisation_id=org,
                    user_id=b.user_id,
                    points=500,
                    reason="x",
                    created_at=g.period_start("month") - timedelta(days=5),
                ),
                PointsLedger(organisation_id=org, user_id=c.user_id, points=50, reason="x"),
            ]
        )
    r = await client.get(f"{API}/leaderboard", params={"period": "week"}, headers=a.headers)
    assert r.status_code == 200, r.text
    names = [e["full_name"] for e in r.json()["entries"]]
    assert names == ["Alice", "Bob", "Carol"]
    assert r.json()["me"]["rank"] == 1 and r.json()["entries"][0]["is_me"] is True

    r = await client.get(f"{API}/leaderboard", params={"period": "all"}, headers=a.headers)
    assert [e["full_name"] for e in r.json()["entries"]][:2] == ["Bob", "Alice"]
    assert r.json()["entries"][0]["points"] == 600 and r.json()["entries"][0]["level"] == 4

    r = await client.get(
        f"{API}/leaderboard", params={"period": "all", "department_id": str(dept.id)}, headers=a.headers
    )
    assert [e["full_name"] for e in r.json()["entries"]] == ["Bob"]
    assert r.json()["me"]["rank"] is None

    assert (
        await client.put(f"{API}/me/leaderboard-opt-out", json={"opt_out": True}, headers=b.headers)
    ).status_code == 200
    r = await client.get(f"{API}/leaderboard", params={"period": "all"}, headers=b.headers)
    assert "Bob" not in [e["full_name"] for e in r.json()["entries"]]
    assert r.json()["me"]["opted_out"] is True

    assert (
        await client.get(f"{API}/leaderboard", params={"period": "year"}, headers=a.headers)
    ).status_code == 422
    # Auditor (analytics.view, no learning.access) may view; tenant isolation of entries
    other = await signup(client, org_name="Other Org")
    r = await client.get(f"{API}/leaderboard", params={"period": "all"}, headers=other.headers)
    assert r.json()["entries"] == []


async def test_disabled_gamification(client):
    admin = await signup(client)
    await set_plan(admin.org_id, "free", gamification_enabled=False)
    async with tenant_session(admin.org_id) as s:
        course = await seed_course(s, admin.org_id)
    await emit_event(
        admin.org_id,
        "course.completed",
        {"user_id": admin.user_id, "enrolment_id": uuid.uuid4(), "course_id": course.id, "final_score": 90},
    )
    assert await _ledger_total(admin.org_id, admin.user_id) == 0
    me = (await client.get(f"{API}/me", headers=admin.headers)).json()
    assert me["enabled"] is False and me["points"] == 0 and me["badges"] == []
    lb = (await client.get(f"{API}/leaderboard", headers=admin.headers)).json()
    assert lb["enabled"] is False and lb["entries"] == []
    assert (await client.get(f"{API}/badges", headers=admin.headers)).json()["enabled"] is False


async def test_badge_admin_crud_and_permissions(client):
    admin = await signup(client)
    learner = await add_member(admin.org_id, "learner")
    r = await client.get(f"{API}/badges", headers=learner.headers)
    assert r.status_code == 200
    keys = {b["key"] for b in r.json()["items"]}
    assert {"first_steps", "quiz_ace", "simulation_expert", "streak_7", "knowledge_seeker"} <= keys

    payload = {
        "key": "team_player",
        "name": "Team Player",
        "description": "Helped colleagues",
        "criteria": {"type": "manual"},
    }
    assert (await client.post(f"{API}/badges", json=payload, headers=learner.headers)).status_code == 403
    r = await client.post(f"{API}/badges", json=payload, headers=admin.headers)
    assert r.status_code == 201, r.text
    badge_id = r.json()["id"]
    assert (await client.post(f"{API}/badges", json=payload, headers=admin.headers)).status_code == 409
    bad = {**payload, "key": "bad_one", "criteria": {"type": "nonsense"}}
    assert (await client.post(f"{API}/badges", json=bad, headers=admin.headers)).status_code == 422

    r = await client.patch(f"{API}/badges/{badge_id}", json={"name": "Team Hero"}, headers=admin.headers)
    assert r.status_code == 200 and r.json()["name"] == "Team Hero"

    r = await client.post(
        f"{API}/badges/{badge_id}/award", json={"user_id": str(learner.user_id)}, headers=admin.headers
    )
    assert r.status_code == 200, r.text
    assert (
        await client.post(
            f"{API}/badges/{badge_id}/award", json={"user_id": str(learner.user_id)}, headers=admin.headers
        )
    ).status_code == 400
    me = (await client.get(f"{API}/me", headers=learner.headers)).json()
    assert "team_player" in {b["key"] for b in me["badges"]}

    other = await signup(client, org_name="Other Badge Org")
    assert (
        await client.patch(f"{API}/badges/{badge_id}", json={"name": "x"}, headers=other.headers)
    ).status_code == 404
    assert (await client.delete(f"{API}/badges/{badge_id}", headers=admin.headers)).status_code == 204
    keys = {b["key"] for b in (await client.get(f"{API}/badges", headers=admin.headers)).json()["items"]}
    assert "team_player" not in keys and "first_steps" in keys  # defaults are not re-seeded / lost
