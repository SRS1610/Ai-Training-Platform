"""Notifications: inbox API, preferences, push subscriptions, event subscribers and due-date reminders."""

from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from sqlalchemy import select

from app.core.db import get_sessionmaker
from app.models.learning import Enrolment
from app.models.platform import Notification
from app.modules.notifications import push as push_mod
from app.modules.notifications import service as nsvc
from app.modules.notifications.tasks import run_due_reminders
from tests.factories import add_member, signup
from tests.ops_seed import (
    emit_event,
    enrol,
    now,
    seed_assignment,
    seed_course,
    seed_simulation,
    seed_submission,
    tenant_session,
    today,
)

API = "/api/v1/notifications"


async def _notifications(user_id: uuid.UUID) -> list[Notification]:
    async with get_sessionmaker()() as s:
        s.info["rls_bypass"] = True
        return list(
            (
                await s.execute(
                    select(Notification)
                    .where(Notification.user_id == user_id)
                    .order_by(Notification.created_at)
                )
            ).scalars()
        )


async def test_assignment_event_creates_notification_and_inbox_flow(client):
    admin = await signup(client)
    learner = await add_member(admin.org_id, "learner")
    async with tenant_session(admin.org_id) as s:
        course = await seed_course(s, admin.org_id, title="Cyber Hygiene")
    await emit_event(
        admin.org_id,
        "enrolment.created",
        {
            "user_id": learner.user_id,
            "enrolment_id": uuid.uuid4(),
            "course_id": course.id,
            "assigned_by": admin.user_id,
            "due_date": today() + timedelta(days=10),
        },
    )
    # self-enrolment does not notify
    await emit_event(
        admin.org_id,
        "enrolment.created",
        {
            "user_id": learner.user_id,
            "enrolment_id": uuid.uuid4(),
            "course_id": course.id,
            "assigned_by": None,
        },
    )

    r = await client.get(API, headers=learner.headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] == 1
    item = body["items"][0]
    assert item["type"] == "training_assigned"
    assert "Cyber Hygiene" in item["title"]
    assert item["link"] == f"/app/learn/{course.id}"
    assert item["read_at"] is None

    assert (await client.get(f"{API}/unread-count", headers=learner.headers)).json() == {"count": 1}
    # another member cannot touch it
    other = await add_member(admin.org_id, "learner")
    assert (await client.post(f"{API}/{item['id']}/read", headers=other.headers)).status_code == 404
    assert (await client.delete(f"{API}/{item['id']}", headers=other.headers)).status_code == 404

    r = await client.post(f"{API}/{item['id']}/read", headers=learner.headers)
    assert r.status_code == 200 and r.json()["read_at"] is not None
    assert (await client.get(f"{API}/unread-count", headers=learner.headers)).json() == {"count": 0}
    assert (await client.get(API, params={"unread": "true"}, headers=learner.headers)).json()["total"] == 0
    assert (await client.post(f"{API}/{item['id']}/unread", headers=learner.headers)).json()[
        "read_at"
    ] is None

    r = await client.post(f"{API}/read-all", headers=learner.headers)
    assert r.json() == {"updated": 1}
    assert (await client.delete(f"{API}/{item['id']}", headers=learner.headers)).status_code == 204
    assert (await client.get(API, headers=learner.headers)).json()["total"] == 0


async def test_notifications_are_tenant_isolated(client):
    a = await signup(client, org_name="Tenant N1")
    b = await signup(client, org_name="Tenant N2")
    async with tenant_session(a.org_id) as s:
        course = await seed_course(s, a.org_id)
    await emit_event(
        a.org_id,
        "course.completed",
        {
            "user_id": a.user_id,
            "enrolment_id": uuid.uuid4(),
            "course_id": course.id,
            "course_version_id": None,
            "final_score": 91.0,
        },
    )
    a_items = (await client.get(API, headers=a.headers)).json()["items"]
    assert [i["type"] for i in a_items] == ["course_completed"]
    assert (await client.get(API, headers=b.headers)).json()["total"] == 0
    assert (await client.post(f"{API}/{a_items[0]['id']}/read", headers=b.headers)).status_code == 404


async def test_all_event_subscribers(client):
    admin = await signup(client)
    learner = await add_member(admin.org_id, "learner")
    org = admin.org_id
    async with tenant_session(org) as s:
        course = await seed_course(s, org)
        assignment = await seed_assignment(s, org, course.id)
        sim, _ = await seed_simulation(s, org, course.id)
    uid = learner.user_id
    await emit_event(
        org,
        "assessment.attempt_graded",
        {
            "user_id": uid,
            "attempt_id": uuid.uuid4(),
            "assessment_id": uuid.uuid4(),
            "course_id": course.id,
            "percentage": 40.0,
            "passed": False,
        },
    )
    await emit_event(
        org,
        "assessment.attempt_graded",
        {
            "user_id": uid,
            "attempt_id": uuid.uuid4(),
            "assessment_id": uuid.uuid4(),
            "course_id": course.id,
            "percentage": 90.0,
            "passed": True,
        },
    )
    await emit_event(
        org,
        "certificate.issued",
        {
            "user_id": uid,
            "certificate_id": uuid.uuid4(),
            "course_id": course.id,
            "certificate_number": "CERT-2026-000101",
        },
    )
    await emit_event(
        org,
        "submission.graded",
        {
            "user_id": uid,
            "submission_id": uuid.uuid4(),
            "assignment_id": assignment.id,
            "course_id": course.id,
            "final_score": 82.0,
            "passed": True,
            "grade_id": uuid.uuid4(),
        },
    )
    session_id = uuid.uuid4()
    await emit_event(
        org,
        "simulation.completed",
        {
            "user_id": uid,
            "session_id": session_id,
            "simulation_id": sim.id,
            "course_id": course.id,
            "total_score": 88.0,
            "band": "expert",
            "passed": True,
        },
    )
    types = [n.type for n in await _notifications(uid)]
    for t in (
        "assessment_failed",
        "assessment_passed",
        "certificate_issued",
        "instructor_feedback",
        "simulation_completed",
    ):
        assert t in types, types
    notes = {n.type: n for n in await _notifications(uid)}
    assert notes["instructor_feedback"].link == f"/app/assignments/{assignment.id}"
    assert notes["simulation_completed"].link == f"/app/simulations/session/{session_id}"
    assert "CERT-2026-000101" in notes["certificate_issued"].body


async def test_preferences_roundtrip_and_suppression(client):
    admin = await signup(client)
    r = await client.get(f"{API}/preferences", headers=admin.headers)
    assert r.status_code == 200
    prefs = {p["type"]: p for p in r.json()["preferences"]}
    assert prefs["training_assigned"]["email"] is True and prefs["badge_earned"]["email"] is False
    assert r.json()["push_enabled"] is False

    r = await client.put(
        f"{API}/preferences",
        headers=admin.headers,
        json={
            "preferences": {
                "course_completed": {"in_app": False, "email": False},
                "badge_earned": {"push": True},
            }
        },
    )
    assert r.status_code == 200, r.text
    prefs = {p["type"]: p for p in r.json()["preferences"]}
    assert prefs["course_completed"]["in_app"] is False and prefs["course_completed"]["push"] is False
    assert prefs["badge_earned"]["push"] is True and prefs["badge_earned"]["in_app"] is True

    bad = await client.put(
        f"{API}/preferences", headers=admin.headers, json={"preferences": {"nope": {"email": True}}}
    )
    assert bad.status_code == 422

    async with tenant_session(admin.org_id) as s:
        course = await seed_course(s, admin.org_id)
    await emit_event(
        admin.org_id,
        "course.completed",
        {"user_id": admin.user_id, "enrolment_id": uuid.uuid4(), "course_id": course.id, "final_score": 80},
    )
    assert (await client.get(API, headers=admin.headers)).json()["total"] == 0


async def test_push_subscription_and_delivery(client, monkeypatch):
    admin = await signup(client)
    sub = {"endpoint": "https://push.example.com/send/abc", "keys": {"p256dh": "BPk", "auth": "xyz"}}
    assert (
        await client.post(
            f"{API}/push-subscriptions", headers=admin.headers, json={**sub, "endpoint": "http://insecure"}
        )
    ).status_code == 422
    r = await client.post(f"{API}/push-subscriptions", headers=admin.headers, json=sub)
    assert r.status_code == 201 and r.json()["push_subscriptions"] == 1
    # idempotent per endpoint
    r = await client.post(f"{API}/push-subscriptions", headers=admin.headers, json=sub)
    assert r.json()["push_subscriptions"] == 1
    await client.put(
        f"{API}/preferences", headers=admin.headers, json={"preferences": {"system": {"push": True}}}
    )

    # No VAPID keys -> recorded as skipped
    async with tenant_session(admin.org_id) as s:
        n = await nsvc.send_notification(
            s, organisation_id=admin.org_id, user_id=admin.user_id, type="system", title="Hello"
        )
        assert n.channels["push"] == "skipped"

    # Configured provider -> delivered; expired subscriptions are pruned
    sent: list[dict] = []

    class FakeProvider(push_mod.WebPushProvider):
        configured = True

        async def send(self, subscription, payload):
            sent.append(payload)
            return "sent"

    monkeypatch.setattr(nsvc, "get_push_provider", lambda: FakeProvider())
    async with tenant_session(admin.org_id) as s:
        n = await nsvc.send_notification(
            s, organisation_id=admin.org_id, user_id=admin.user_id, type="system", title="Queued"
        )
        assert n.channels["push"] == "queued"
    async with get_sessionmaker()() as s:
        s.info["rls_bypass"] = True
        assert await nsvc.push_sweep(s) >= 1
        await s.commit()
    assert sent and sent[-1]["title"] == "Queued"
    rows = await _notifications(admin.user_id)
    assert [r.channels.get("push") for r in rows if r.title == "Queued"] == ["sent"]

    r = await client.request(
        "DELETE", f"{API}/push-subscriptions", headers=admin.headers, json={"endpoint": sub["endpoint"]}
    )
    assert r.status_code == 200 and r.json()["push_subscriptions"] == 0


def test_push_provider_selection(monkeypatch):
    push_mod.push_settings.cache_clear()
    monkeypatch.delenv("VAPID_PUBLIC_KEY", raising=False)
    monkeypatch.delenv("VAPID_PRIVATE_KEY", raising=False)
    assert isinstance(push_mod.get_push_provider(), push_mod.NullWebPushProvider)
    monkeypatch.setenv("VAPID_PUBLIC_KEY", "pub")
    monkeypatch.setenv("VAPID_PRIVATE_KEY", "priv")
    push_mod.push_settings.cache_clear()
    assert isinstance(push_mod.get_push_provider(), push_mod.PyWebPushProvider)
    push_mod.push_settings.cache_clear()


async def test_due_reminders_dedupe_and_overdue(client):
    admin = await signup(client)
    learner = await add_member(admin.org_id, "learner")
    org = admin.org_id
    async with tenant_session(org) as s:
        c1 = await seed_course(s, org, title="Due Soon Course")
        c2 = await seed_course(s, org, title="Overdue Course")
        c3 = await seed_course(s, org, title="Far Future Course")
        c4 = await seed_course(s, org, title="Done Course")
        e1 = await enrol(
            s, org, learner.user_id, c1, due_date=today() + timedelta(days=2), assigned_by=admin.user_id
        )
        await enrol(
            s, org, learner.user_id, c2, due_date=today() - timedelta(days=1), assigned_by=admin.user_id
        )
        await enrol(s, org, learner.user_id, c3, due_date=today() + timedelta(days=20))
        await enrol(s, org, learner.user_id, c4, due_date=today() - timedelta(days=3), status="completed")
        assignment = await seed_assignment(s, org, c1.id, title="Lab report")
        await seed_submission(
            s, org, learner.user_id, assignment, status="draft", due_at=now() + timedelta(days=1)
        )

    async with get_sessionmaker()() as s:
        s.info["rls_bypass"] = True
        result = await run_due_reminders(s)
        await s.commit()
    assert result["enrolments"]["due"] >= 1 and result["enrolments"]["overdue"] >= 1
    notes = await _notifications(learner.user_id)
    titles = sorted(n.title for n in notes)
    assert any("Due Soon Course" in t and t.startswith("Due in 2 days") for t in titles), titles
    assert any(t == "Overdue: Overdue Course" for t in titles)
    assert any(t == "Due soon: Lab report" for t in titles)
    assert not any("Far Future" in t or "Done Course" in t for t in titles)

    # Second run is a no-op for this learner (dedupe via reminders_sent / notification data)
    async with get_sessionmaker()() as s:
        s.info["rls_bypass"] = True
        await run_due_reminders(s)
        await s.commit()
        e = await s.get(Enrolment, e1.id)
        assert any(k.startswith("due_soon:") for k in e.reminders_sent)
    assert len(await _notifications(learner.user_id)) == len(notes)


@pytest.mark.parametrize("path", ["", "/unread-count", "/preferences"])
async def test_requires_auth(client, path):
    assert (await client.get(f"{API}{path}")).status_code == 401
