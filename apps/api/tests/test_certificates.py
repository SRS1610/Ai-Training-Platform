"""Certificates: auto-issue on course.completed, PDF, manual issue/revoke, public verification + tampering."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.core.db import bind_tenant, get_sessionmaker
from app.core.events import emit
from app.core.storage import get_storage
from app.models.content import Course, Skill, StoredFile
from app.models.platform import AuditLog, Certificate
from app.modules.certificates import service as cert_service
from tests.assess_helpers import API, enrol, fetch, make_course, update_row
from tests.factories import add_member, signup


async def _complete(org_id, user_id, course_id, version_id, enrolment_id, score):
    async with get_sessionmaker()() as s:
        await bind_tenant(s, org_id)
        await emit(
            s,
            "course.completed",
            {
                "enrolment_id": enrolment_id,
                "course_id": course_id,
                "course_version_id": version_id,
                "final_score": score,
                "organisation_id": org_id,
                "user_id": user_id,
            },
        )
        await s.commit()


async def _certs(user_id) -> list[Certificate]:
    async with get_sessionmaker()() as s:
        s.info["rls_bypass"] = True
        return list((await s.execute(select(Certificate).where(Certificate.user_id == user_id))).scalars())


async def _setup(client, **course_fields):
    admin = await signup(client, org_name=f"Cert Org {uuid.uuid4().hex[:4]}")
    instructor = await add_member(admin.org_id, "instructor", full_name="Ivy Instructor")
    learner = await add_member(admin.org_id, "learner", full_name="Lena Learner")
    course_id, version_id = await make_course(
        admin.org_id,
        title="Incident Response",
        instructor_id=instructor.user_id,
        pass_threshold=70.0,
        **course_fields,
    )
    enrolment_id = await enrol(admin.org_id, learner.user_id, course_id, version_id)
    return admin, instructor, learner, course_id, version_id, enrolment_id


async def test_issue_on_course_completed_is_idempotent_and_verifiable(client):
    admin, instructor, learner, course_id, version_id, enrolment_id = await _setup(client)
    async with get_sessionmaker()() as s:
        s.info["rls_bypass"] = True
        skill = Skill(organisation_id=admin.org_id, name=f"Triage {uuid.uuid4().hex[:4]}")
        s.add(skill)
        await s.flush()
        course = await s.get(Course, course_id)
        course.skills.append(skill)
        await s.commit()

    await _complete(admin.org_id, learner.user_id, course_id, version_id, enrolment_id, 88.5)
    await _complete(admin.org_id, learner.user_id, course_id, version_id, enrolment_id, 88.5)
    certs = await _certs(learner.user_id)
    assert len(certs) == 1
    cert = certs[0]
    year = datetime.now(UTC).year
    assert cert.certificate_number.startswith(f"CERT-{year}-") and len(cert.certificate_number) == 16
    assert cert.learner_name == "Lena Learner" and cert.instructor_name == "Ivy Instructor"
    assert cert.organisation_name.startswith("Cert Org") and cert.score == 88.5
    assert cert.skills[0]["name"].startswith("Triage") and cert.pdf_file_id is not None

    mine = (await client.get(f"{API}/certificates/me", headers=learner.headers)).json()
    assert [c["certificate_number"] for c in mine] == [cert.certificate_number]
    assert mine[0]["status"] == "valid" and mine[0]["verification_url"].endswith(
        f"/verify/{cert.certificate_number}"
    )

    r = await client.get(f"{API}/verify/{cert.certificate_number}")  # public: no auth headers
    assert r.status_code == 200
    v = r.json()
    assert v["valid"] is True and v["status"] == "valid" and v["learner_name"] == "Lena Learner"
    assert (
        v["course_title"] == "Incident Response"
        and v["score"] == 88.5
        and v["skills"][0].startswith("Triage")
    )
    assert (await client.get(f"{API}/verify/{cert.certificate_number.lower()}")).json()["valid"] is True
    assert (await client.get(f"{API}/verify/CERT-1999-000001")).status_code == 404

    async with get_sessionmaker()() as s:
        s.info["rls_bypass"] = True
        actions = (
            await s.execute(select(AuditLog.action).where(AuditLog.entity_id == str(cert.id)))
        ).scalars()
        assert "certificate.issued" in list(actions)


async def test_tampering_invalidates_verification(client):
    admin, _, learner, course_id, version_id, enrolment_id = await _setup(client)
    await _complete(admin.org_id, learner.user_id, course_id, version_id, enrolment_id, 75.0)
    cert = (await _certs(learner.user_id))[0]
    await update_row(Certificate, cert.id, score=99.0)
    v = (await client.get(f"{API}/verify/{cert.certificate_number}")).json()
    assert v["valid"] is False and v["status"] == "invalid"
    await update_row(Certificate, cert.id, score=75.0)
    assert (await client.get(f"{API}/verify/{cert.certificate_number}")).json()["valid"] is True
    await update_row(Certificate, cert.id, learner_name="Somebody Else")
    assert (await client.get(f"{API}/verify/{cert.certificate_number}")).json()["valid"] is False


async def test_threshold_and_disabled_certificates(client):
    admin, _, learner, course_id, version_id, enrolment_id = await _setup(client)
    await _complete(admin.org_id, learner.user_id, course_id, version_id, enrolment_id, 69.9)
    assert await _certs(learner.user_id) == []
    # No score (course without assessments) still earns a certificate
    await _complete(admin.org_id, learner.user_id, course_id, version_id, enrolment_id, None)
    assert len(await _certs(learner.user_id)) == 1

    other = await add_member(admin.org_id, "learner")
    c2, v2 = await make_course(admin.org_id, certificate_enabled=False)
    e2 = await enrol(admin.org_id, other.user_id, c2, v2)
    await _complete(admin.org_id, other.user_id, c2, v2, e2, 100.0)
    assert await _certs(other.user_id) == []


async def test_pdf_download_permissions_and_regeneration(client):
    admin, instructor, learner, course_id, version_id, enrolment_id = await _setup(client)
    await _complete(admin.org_id, learner.user_id, course_id, version_id, enrolment_id, 90.0)
    cert = (await _certs(learner.user_id))[0]
    r = await client.get(f"{API}/certificates/{cert.id}/pdf", headers=learner.headers)
    assert (
        r.status_code == 200
        and r.headers["content-type"] == "application/pdf"
        and r.content.startswith(b"%PDF")
    )
    stranger = await add_member(admin.org_id, "learner")
    assert (
        await client.get(f"{API}/certificates/{cert.id}/pdf", headers=stranger.headers)
    ).status_code == 404
    assert (await client.get(f"{API}/certificates/{cert.id}", headers=stranger.headers)).status_code == 404
    assert (await client.get(f"{API}/certificates/{cert.id}/pdf", headers=admin.headers)).status_code == 200
    other_org = await signup(client, org_name="Other")
    assert (await client.get(f"{API}/certificates/{cert.id}", headers=other_org.headers)).status_code == 404

    stored = await fetch(StoredFile, cert.pdf_file_id)
    assert stored.purpose == "certificate" and stored.owner_id == learner.user_id
    await get_storage().delete(stored.storage_key)
    r = await client.get(f"{API}/certificates/{cert.id}/pdf", headers=learner.headers)
    assert r.status_code == 200 and r.content.startswith(b"%PDF")
    assert (await fetch(Certificate, cert.id)).pdf_file_id != cert.pdf_file_id


async def test_manual_issue_list_and_revoke(client):
    admin, instructor, learner, course_id, version_id, enrolment_id = await _setup(client)
    manager = await add_member(admin.org_id, "training_manager")
    body = {"user_id": str(learner.user_id), "course_id": str(course_id), "score": 81}
    assert (
        await client.post(f"{API}/certificates/issue", json=body, headers=learner.headers)
    ).status_code == 403
    assert (
        await client.post(f"{API}/certificates/issue", json=body, headers=instructor.headers)
    ).status_code == 403
    r = await client.post(f"{API}/certificates/issue", json=body, headers=manager.headers)
    assert r.status_code == 201, r.text
    cert = r.json()
    assert cert["score"] == 81 and cert["issued_by"] == str(manager.user_id) and cert["course_version_id"]
    dup = await client.post(f"{API}/certificates/issue", json=body, headers=manager.headers)
    assert dup.status_code == 409 and dup.json()["error"]["code"] == "certificate_exists"
    outsider = await signup(client, org_name="Outsiders")
    r = await client.post(
        f"{API}/certificates/issue", json={**body, "user_id": str(outsider.user_id)}, headers=manager.headers
    )
    assert r.status_code == 404

    lst = (
        await client.get(
            f"{API}/certificates", params={"course_id": str(course_id)}, headers=instructor.headers
        )
    ).json()  # instructors have analytics.view
    assert lst["total"] == 1
    assert (await client.get(f"{API}/certificates", headers=learner.headers)).status_code == 403

    r = await client.post(
        f"{API}/certificates/{cert['id']}/revoke", json={"reason": "Issued in error"}, headers=manager.headers
    )
    assert r.status_code == 200 and r.json()["status"] == "revoked"
    again = await client.post(
        f"{API}/certificates/{cert['id']}/revoke", json={"reason": "again"}, headers=manager.headers
    )
    assert again.status_code == 409
    v = (await client.get(f"{API}/verify/{cert['certificate_number']}")).json()
    assert v["valid"] is False and v["status"] == "revoked" and v["revoked_at"]
    revoked = (
        await client.get(f"{API}/certificates", params={"status": "revoked"}, headers=manager.headers)
    ).json()
    assert revoked["total"] == 1
    async with get_sessionmaker()() as s:
        s.info["rls_bypass"] = True
        actions = list(
            (await s.execute(select(AuditLog.action).where(AuditLog.entity_id == cert["id"]))).scalars()
        )
        assert {"certificate.issued", "certificate.revoked"} <= set(actions)


async def test_expired_certificate(client):
    admin, _, learner, course_id, _, _ = await _setup(client)
    manager = await add_member(admin.org_id, "training_manager")
    expires = (datetime.now(UTC) + timedelta(days=1)).isoformat()
    r = await client.post(
        f"{API}/certificates/issue",
        json={"user_id": str(learner.user_id), "course_id": str(course_id), "expires_at": expires},
        headers=manager.headers,
    )
    cert = r.json()
    assert (await client.get(f"{API}/verify/{cert['certificate_number']}")).json()["status"] == "valid"
    # Move both timestamps back consistently (re-signing as the issuer would) to simulate expiry.
    row = await fetch(Certificate, uuid.UUID(cert["id"]))
    row.expires_at = datetime.now(UTC) - timedelta(days=1)
    await update_row(
        Certificate, row.id, expires_at=row.expires_at, verification_hash=cert_service.compute_hash(row)
    )
    v = (await client.get(f"{API}/verify/{cert['certificate_number']}")).json()
    assert v["status"] == "expired" and v["valid"] is False
