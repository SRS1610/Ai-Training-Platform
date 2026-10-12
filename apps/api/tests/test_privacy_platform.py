"""Privacy (consents, export, deletion, retention) and super-admin platform administration."""

from __future__ import annotations

import io
import json
import uuid
import zipfile
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.core.db import get_sessionmaker
from app.models.ai import AIMessage, AISession
from app.models.identity import AuthSession, User, UserStatus
from app.models.platform import AuditLog, Certificate, DataRequest, Notification
from app.models.tenancy import Organisation, OrganisationUser
from app.modules.privacy.tasks import retention_sweep
from app.workers import drain
from tests.factories import PASSWORD, add_member, signup

API = "/api/v1"


async def _seed_personal_data(org_id: uuid.UUID, user_id: uuid.UUID, *, age_days: int = 0) -> None:
    created = datetime.now(UTC) - timedelta(days=age_days)
    async with get_sessionmaker()() as s:
        s.info["rls_bypass"] = True
        s.add(
            Notification(
                organisation_id=org_id,
                user_id=user_id,
                type="system",
                title=f"Hello {age_days}",
                created_at=created,
            )
        )
        sess = AISession(
            organisation_id=org_id,
            user_id=user_id,
            title="Tutor chat",
            created_at=created,
            updated_at=created,
        )
        s.add(sess)
        await s.flush()
        s.add(
            AIMessage(
                organisation_id=org_id,
                session_id=sess.id,
                role="user",
                content=f"question {age_days}",
                created_at=created,
            )
        )
        await s.commit()


async def _make_superadmin(user_id: uuid.UUID) -> None:
    async with get_sessionmaker()() as s:
        s.info["rls_bypass"] = True
        (await s.get(User, user_id)).is_superadmin = True
        await s.commit()


# ----------------------------------------------------------------------------- consents


async def test_consents_are_append_only(client, db):
    acct = await signup(client)
    c = (await client.get(f"{API}/privacy/consents", headers=acct.headers)).json()
    assert c["current"]["terms"]["granted"] is True and c["current"]["marketing"]["granted"] is False
    r = await client.put(
        f"{API}/privacy/consents",
        headers=acct.headers,
        json={
            "consents": [
                {"purpose": "marketing", "granted": True},
                {"purpose": "ai_processing", "granted": True},
            ]
        },
    )
    assert r.status_code == 200
    assert r.json()["current"]["marketing"]["granted"] is True and len(r.json()["history"]) == 5
    r = await client.put(
        f"{API}/privacy/consents",
        headers=acct.headers,
        json={"consents": [{"purpose": "marketing", "granted": False}]},
    )
    assert r.json()["current"]["marketing"]["granted"] is False and len(r.json()["history"]) == 6
    bad = await client.put(
        f"{API}/privacy/consents",
        headers=acct.headers,
        json={"consents": [{"purpose": "terms", "granted": False}]},
    )
    assert bad.status_code == 400 and bad.json()["error"]["code"] == "consent_required"
    invalid = await client.put(
        f"{API}/privacy/consents",
        headers=acct.headers,
        json={"consents": [{"purpose": "telepathy", "granted": True}]},
    )
    assert invalid.status_code == 422


# ----------------------------------------------------------------------------- export


async def test_data_export_zip(client):
    admin = await signup(client)
    learner = await add_member(admin.org_id, "learner")
    await _seed_personal_data(admin.org_id, learner.user_id)
    r = await client.post(f"{API}/privacy/export", headers=learner.headers)
    assert r.status_code == 202 and r.json()["status"] == "pending"
    rid = r.json()["id"]
    await drain()
    reqs = (await client.get(f"{API}/privacy/requests", headers=learner.headers)).json()
    assert reqs[0]["id"] == rid and reqs[0]["status"] == "completed", reqs
    assert reqs[0]["download_url"] == f"/api/v1/privacy/requests/{rid}/download"
    other = await add_member(admin.org_id, "learner")
    assert (
        await client.get(f"{API}/privacy/requests/{rid}/download", headers=other.headers)
    ).status_code == 404
    dl = await client.get(f"{API}/privacy/requests/{rid}/download", headers=learner.headers)
    assert dl.status_code == 200 and dl.headers["content-type"] == "application/zip"
    zf = zipfile.ZipFile(io.BytesIO(dl.content))
    assert {"README.txt", "data.json", "sections/profile.json"} <= set(zf.namelist())
    data = json.loads(zf.read("data.json"))
    assert data["profile"]["email"] == learner.email
    assert "password_hash" not in data["profile"] and "mfa_secret_encrypted" not in data["profile"]
    assert all("refresh_token_hash" not in s for s in data["sessions"])
    assert data["memberships"][0]["roles"] == ["learner"]
    assert data["notifications"][0]["title"] == "Hello 0"
    assert data["ai_messages"][0]["content"] == "question 0"
    for section in (
        "enrolments",
        "assessment_attempts",
        "attempt_answers",
        "submissions",
        "submission_versions",
        "simulation_sessions",
        "simulation_actions",
        "certificates",
        "consents",
    ):
        assert section in data


# ----------------------------------------------------------------------------- deletion


async def test_delete_account_anonymises(client, db):
    admin = await signup(client)
    learner = await add_member(admin.org_id, "learner")
    await _seed_personal_data(admin.org_id, learner.user_id)
    async with get_sessionmaker()() as s:
        s.info["rls_bypass"] = True
        from app.models.content import Course

        course = Course(organisation_id=admin.org_id, slug=f"c-{uuid.uuid4().hex[:6]}", title="Safety 101")
        s.add(course)
        await s.flush()
        s.add(
            Certificate(
                organisation_id=admin.org_id,
                certificate_number=f"CERT-{uuid.uuid4().hex[:8]}",
                user_id=learner.user_id,
                course_id=course.id,
                learner_name="Test Member",
                course_title="Safety 101",
                organisation_name="Acme",
                issued_at=datetime.now(UTC),
                verification_hash="x" * 64,
            )
        )
        await s.commit()
    wrong = await client.post(
        f"{API}/privacy/delete-account", json={"password": "wrong-password-123"}, headers=learner.headers
    )
    assert wrong.status_code == 400
    r = await client.post(
        f"{API}/privacy/delete-account", json={"password": PASSWORD}, headers=learner.headers
    )
    assert r.status_code == 204, r.text
    assert (await client.get(f"{API}/me", headers=learner.headers)).status_code == 401
    user = await db.get(User, learner.user_id)
    await db.refresh(user)
    assert user.email == f"deleted-{learner.user_id}@deleted.invalid" and user.full_name == "Deleted user"
    assert user.password_hash is None and user.status == UserStatus.DELETED and user.deleted_at
    assert (
        await db.scalar(select(OrganisationUser).where(OrganisationUser.user_id == learner.user_id)) is None
    )
    assert (
        await db.scalar(
            select(AuthSession).where(
                AuthSession.user_id == learner.user_id, AuthSession.revoked_at.is_(None)
            )
        )
        is None
    )
    assert await db.scalar(select(Notification).where(Notification.user_id == learner.user_id)) is None
    assert await db.scalar(select(AISession).where(AISession.user_id == learner.user_id)) is None
    assert await db.scalar(select(Certificate).where(Certificate.user_id == learner.user_id)) is not None
    audit = (
        (
            await db.execute(
                select(AuditLog).where(
                    AuditLog.organisation_id == admin.org_id, AuditLog.action == "privacy.account_deleted"
                )
            )
        )
        .scalars()
        .all()
    )
    assert audit and audit[0].actor_label == f"deleted-user:{learner.user_id}"
    req = await db.scalar(
        select(DataRequest).where(DataRequest.user_id == learner.user_id, DataRequest.kind == "deletion")
    )
    assert req.status == "completed"
    login = await client.post(f"{API}/auth/login", json={"email": learner.email, "password": PASSWORD})
    assert login.status_code == 401
    # The admin's audit chain is still intact
    assert (await client.get(f"{API}/audit-logs/verify", headers=admin.headers)).json()["valid"] is True


async def test_delete_blocked_for_sole_admin_with_members(client, db):
    admin = await signup(client, org_name="Busy Org")
    await add_member(admin.org_id, "learner")
    r = await client.post(f"{API}/privacy/delete-account", json={"password": PASSWORD}, headers=admin.headers)
    assert r.status_code == 409 and r.json()["error"]["details"]["organisations"] == ["Busy Org"]


async def test_delete_sole_member_closes_org(client, db):
    solo = await signup(client, org_name=None)
    r = await client.post(f"{API}/privacy/delete-account", json={"password": PASSWORD}, headers=solo.headers)
    assert r.status_code == 204
    org = await db.get(Organisation, solo.org_id)
    await db.refresh(org)
    assert org.status == "closed" and org.deleted_at is not None


# ----------------------------------------------------------------------------- retention


async def test_retention_policy_and_sweep(client, db):
    admin = await signup(client)
    learner = await add_member(admin.org_id, "learner")
    assert (await client.get(f"{API}/privacy/retention", headers=admin.headers)).json()[
        "retention_days"
    ] == 2555
    assert (
        await client.put(f"{API}/privacy/retention", json={"retention_days": 5}, headers=admin.headers)
    ).status_code == 422
    r = await client.put(f"{API}/privacy/retention", json={"retention_days": 30}, headers=admin.headers)
    assert r.status_code == 200 and r.json()["retention_days"] == 30
    assert (
        await client.put(f"{API}/privacy/retention", json={"retention_days": 30}, headers=learner.headers)
    ).status_code == 403
    await _seed_personal_data(admin.org_id, learner.user_id, age_days=60)
    await _seed_personal_data(admin.org_id, learner.user_id, age_days=1)
    audit_before = len(
        (await db.execute(select(AuditLog.id).where(AuditLog.organisation_id == admin.org_id))).all()
    )
    run = (await client.post(f"{API}/privacy/retention/run", headers=admin.headers)).json()
    assert (
        run["notifications_deleted"] == 1
        and run["ai_messages_deleted"] == 1
        and run["ai_sessions_deleted"] == 1
    )
    titles = (
        (await db.execute(select(Notification.title).where(Notification.user_id == learner.user_id)))
        .scalars()
        .all()
    )
    assert titles == ["Hello 1"]
    audit_after = len(
        (await db.execute(select(AuditLog.id).where(AuditLog.organisation_id == admin.org_id))).all()
    )
    assert audit_after > audit_before  # never deleted; the sweep itself is audited
    # Nightly task variant
    await _seed_personal_data(admin.org_id, learner.user_id, age_days=90)
    totals = await retention_sweep(organisation_id=str(admin.org_id))
    assert totals["organisations"] == 1 and totals["notifications_deleted"] == 1


# ----------------------------------------------------------------------------- platform


async def test_platform_requires_superadmin(client):
    admin = await signup(client)
    for path in ("/platform/organisations", "/platform/users", "/platform/health"):
        assert (await client.get(f"{API}{path}", headers=admin.headers)).status_code == 403


async def test_platform_org_admin_actions(client, db):
    sa = await signup(client, org_name="Platform HQ")
    await _make_superadmin(sa.user_id)
    customer = await signup(client, org_name=f"Customer {uuid.uuid4().hex[:6]}")
    await add_member(customer.org_id, "learner")
    r = await client.get(f"{API}/platform/organisations", params={"q": "Customer"}, headers=sa.headers)
    assert r.status_code == 200
    row = next(o for o in r.json()["items"] if o["id"] == str(customer.org_id))
    assert row["member_count"] == 2 and row["course_count"] == 0 and row["plan_code"] == "free"
    d = (await client.get(f"{API}/platform/organisations/{customer.org_id}", headers=sa.headers)).json()
    assert d["admins"][0]["email"] == customer.email and d["subscription"]["plan_code"] == "free"

    r = await client.post(
        f"{API}/platform/organisations/{customer.org_id}/suspend",
        json={"reason": "fraud"},
        headers=sa.headers,
    )
    assert r.status_code == 200 and r.json()["status"] == "suspended"
    blocked = await client.get(f"{API}/users", headers=customer.headers)
    assert blocked.status_code == 403 and blocked.json()["error"]["code"] == "organisation_suspended"
    r = await client.post(f"{API}/platform/organisations/{customer.org_id}/reactivate", headers=sa.headers)
    assert r.json()["status"] == "active"
    assert (await client.get(f"{API}/users", headers=customer.headers)).status_code == 200

    r = await client.patch(
        f"{API}/platform/organisations/{customer.org_id}/plan",
        headers=sa.headers,
        json={"plan_code": "business", "feature_overrides": {"sso": True}, "seats": 50},
    )
    assert r.status_code == 200 and r.json()["plan_code"] == "business"
    assert r.json()["feature_overrides"] == {"sso": True} and r.json()["settings"]["seats"] == 50
    feats = (await client.get(f"{API}/organisations/current", headers=customer.headers)).json()["features"]
    assert feats["sso"] is True and feats["custom_branding"] is True
    bad = await client.patch(
        f"{API}/platform/organisations/{customer.org_id}/plan",
        headers=sa.headers,
        json={"plan_code": "platinum"},
    )
    assert bad.status_code == 400
    platform_actions = (
        (
            await db.execute(
                select(AuditLog.action).where(
                    AuditLog.organisation_id.is_(None), AuditLog.action.like("platform.%")
                )
            )
        )
        .scalars()
        .all()
    )
    assert {"platform.org_suspended", "platform.org_reactivated", "platform.org_plan_changed"} <= set(
        platform_actions
    )
    org_actions = (
        (await db.execute(select(AuditLog.action).where(AuditLog.organisation_id == customer.org_id)))
        .scalars()
        .all()
    )
    assert "platform.org_suspended" in org_actions
    assert (
        await client.get(f"{API}/platform/organisations/{uuid.uuid4()}", headers=sa.headers)
    ).status_code == 404


async def test_platform_users_and_superadmin_grants(client):
    sa = await signup(client)
    await _make_superadmin(sa.user_id)
    target = await signup(client)
    r = await client.get(f"{API}/platform/users", params={"q": target.email}, headers=sa.headers)
    assert r.json()["total"] == 1 and r.json()["items"][0]["organisation_count"] == 1
    r = await client.put(
        f"{API}/platform/users/{target.user_id}/superadmin", json={"is_superadmin": True}, headers=sa.headers
    )
    assert r.status_code == 200 and r.json()["is_superadmin"] is True
    assert (await client.get(f"{API}/platform/health", headers=target.headers)).status_code == 200
    me_revoke = await client.put(
        f"{API}/platform/users/{sa.user_id}/superadmin", json={"is_superadmin": False}, headers=sa.headers
    )
    assert me_revoke.status_code == 400
    r = await client.put(
        f"{API}/platform/users/{target.user_id}/superadmin", json={"is_superadmin": False}, headers=sa.headers
    )
    assert r.json()["is_superadmin"] is False
    assert (await client.get(f"{API}/platform/health", headers=target.headers)).status_code == 403
    supers = (
        await client.get(f"{API}/platform/users", params={"superadmin": True}, headers=sa.headers)
    ).json()
    assert str(sa.user_id) in {u["id"] for u in supers["items"]}


async def test_platform_health(client):
    sa = await signup(client)
    await _make_superadmin(sa.user_id)
    h = (await client.get(f"{API}/platform/health", headers=sa.headers)).json()
    assert h["database"]["status"] == "ok" and h["database"]["latency_ms"] >= 0
    assert h["redis"]["status"] in ("ok", "unavailable")
    assert "default" in h["queue"] or h["queue"]["status"] == "unknown"
    assert h["storage"]["bytes"] >= 0 and "errors_24h" in h["ai"]
    assert h["totals"]["organisations"] >= 1 and "latency_ms" in h["metrics"]
