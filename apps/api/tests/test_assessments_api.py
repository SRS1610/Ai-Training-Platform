"""Integration tests: question banks, assessments, attempts, grading, results and statistics."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta

from app.core.db import get_sessionmaker
from app.core.events import subscribe
from app.models.assessment import AssessmentAttempt, AttemptAnswer
from app.modules.assessments import grading
from app.modules.assessments import service as assess_service
from app.modules.assessments.service import finalize_attempt
from tests.assess_helpers import API, enrol, fetch, make_course, update_row
from tests.factories import add_member, signup

GRADED_EVENTS: list[dict] = []


@subscribe("assessment.attempt_graded")
async def _capture(db, payload):  # noqa: ANN001
    GRADED_EVENTS.append(payload)


MC = {
    "question_type": "multiple_choice",
    "prompt": "Which port does HTTPS use?",
    "options": {
        "choices": [{"id": "a", "text": "80"}, {"id": "b", "text": "443"}, {"id": "c", "text": "22"}]
    },
    "answer_key": {"choice_id": "b"},
    "explanation": "HTTPS defaults to 443.",
    "points": 2,
}
TF = {
    "question_type": "true_false",
    "prompt": "DNS resolves names to IP addresses.",
    "answer_key": {"value": True},
    "explanation": "That is DNS's job.",
}
LONG = {
    "question_type": "long_answer",
    "prompt": "Explain the OSI model.",
    "points": 5,
    "answer_key": {"model_answer": "Seven layers..."},
}


async def _setup(client, **assessment_fields):
    admin = await signup(client, org_name=f"Assess {uuid.uuid4().hex[:6]}")
    learner = await add_member(admin.org_id, "learner", full_name="Lena Learner")
    course_id, version_id = await make_course(admin.org_id)
    await enrol(admin.org_id, learner.user_id, course_id, version_id)
    return admin, learner, course_id


async def _question(client, admin, data, bank_id=None):
    r = await client.post(
        f"{API}/questions", json={**data, "bank_id": str(bank_id) if bank_id else None}, headers=admin.headers
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _assessment(client, admin, course_id, items, **fields):
    body = {
        "title": "Networking quiz",
        "course_id": str(course_id),
        "items": items,
        "shuffle_questions": False,
        "shuffle_options": False,
        **fields,
    }
    r = await client.post(f"{API}/assessments", json=body, headers=admin.headers)
    assert r.status_code == 201, r.text
    aid = r.json()["id"]
    r = await client.post(f"{API}/assessments/{aid}/publish", headers=admin.headers)
    assert r.status_code == 200, r.text
    return aid


# ----------------------------------------------------------------------------- authoring


async def test_bank_and_question_crud_with_validation(client):
    admin, learner, course_id = await _setup(client)
    r = await client.post(
        f"{API}/question-banks",
        json={"title": "Networking", "course_id": str(course_id)},
        headers=admin.headers,
    )
    assert r.status_code == 201
    bank_id = r.json()["id"]
    qid = await _question(client, admin, MC, bank_id)
    bad = await client.post(
        f"{API}/questions", json={**MC, "answer_key": {"choice_id": "zz"}}, headers=admin.headers
    )
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "invalid_question"
    r = await client.patch(f"{API}/questions/{qid}", json={"prompt": "HTTPS port?"}, headers=admin.headers)
    assert r.status_code == 200 and r.json()["version"] == 2
    r = await client.patch(
        f"{API}/questions/{qid}", json={"answer_key": {"choice_id": "nope"}}, headers=admin.headers
    )
    assert r.status_code == 422
    r = await client.get(f"{API}/question-banks/{bank_id}", headers=admin.headers)
    assert r.json()["question_count"] == 1
    lst = await client.get(f"{API}/questions", params={"bank_id": bank_id}, headers=admin.headers)
    assert lst.json()["total"] == 1
    # Learners cannot author or read the answer-bearing question endpoints
    assert (await client.post(f"{API}/questions", json=MC, headers=learner.headers)).status_code == 403
    assert (await client.get(f"{API}/questions/{qid}", headers=learner.headers)).status_code == 403
    # Tenant isolation
    other = await signup(client, org_name="Other org")
    assert (await client.get(f"{API}/questions/{qid}", headers=other.headers)).status_code == 404
    assert (await client.delete(f"{API}/questions/{qid}", headers=admin.headers)).status_code == 204
    assert (await client.get(f"{API}/questions/{qid}", headers=admin.headers)).status_code == 404


async def test_import_export_roundtrip(client):
    admin, _, _ = await _setup(client)
    b1 = (await client.post(f"{API}/question-banks", json={"title": "Src"}, headers=admin.headers)).json()[
        "id"
    ]
    await _question(client, admin, MC, b1)
    await _question(client, admin, TF, b1)
    export = (await client.get(f"{API}/question-banks/{b1}/export", headers=admin.headers)).json()
    assert export["format"] == "praxis.question_bank.v1" and len(export["questions"]) == 2
    b2 = (await client.post(f"{API}/question-banks", json={"title": "Dst"}, headers=admin.headers)).json()[
        "id"
    ]
    r = await client.post(
        f"{API}/question-banks/{b2}/import", json={"questions": export["questions"]}, headers=admin.headers
    )
    assert r.status_code == 201 and r.json()["imported"] == 2
    bad = [*export["questions"], {"question_type": "true_false", "prompt": "x", "answer_key": {}}]
    r = await client.post(f"{API}/question-banks/{b2}/import", json={"questions": bad}, headers=admin.headers)
    assert r.status_code == 422 and r.json()["error"]["details"]["questions"][0]["index"] == 2


async def test_publish_blocked_when_pool_too_small(client):
    admin, _, course_id = await _setup(client)
    bank = (await client.post(f"{API}/question-banks", json={"title": "Pool"}, headers=admin.headers)).json()[
        "id"
    ]
    await _question(client, admin, MC, bank)
    r = await client.post(
        f"{API}/assessments",
        json={"title": "Q", "items": [{"bank_id": bank, "draw_count": 3}]},
        headers=admin.headers,
    )
    aid = r.json()["id"]
    r = await client.post(f"{API}/assessments/{aid}/publish", headers=admin.headers)
    assert r.status_code == 422 and r.json()["error"]["code"] == "publish_blocked"


# ----------------------------------------------------------------------------- learner flow


async def test_full_attempt_flow_hides_answer_keys(client):
    admin, learner, course_id = await _setup(client)
    bank = (await client.post(f"{API}/question-banks", json={"title": "Pool"}, headers=admin.headers)).json()[
        "id"
    ]
    for i in range(6):
        await _question(
            client,
            admin,
            {**TF, "prompt": f"Pool q{i}", "difficulty": 3 if i % 2 else 1, "tags": ["net"]},
            bank,
        )
    mc = await _question(client, admin, MC)
    aid = await _assessment(
        client,
        admin,
        course_id,
        [
            {"question_id": mc},
            {"bank_id": bank, "draw_count": 2, "filters": {"difficulty": [3], "tags": ["net"]}, "weight": 2},
        ],
        shuffle_questions=True,
        shuffle_options=True,
        time_limit_minutes=30,
    )

    ov = (await client.get(f"{API}/assessments/{aid}/overview", headers=learner.headers)).json()
    assert ov["can_start"] is True and ov["attempts_used"] == 0 and ov["assessment"]["question_count"] == 3

    r = await client.post(f"{API}/assessments/{aid}/attempts", headers=learner.headers)
    assert r.status_code == 201, r.text
    attempt = r.json()
    raw = json.dumps(attempt)
    assert "answer_key" not in raw and "explanation" not in raw and "443." not in raw
    assert len(attempt["questions"]) == 3 and 1700 <= attempt["remaining_seconds"] <= 1800
    # Resuming returns the same in-progress attempt
    again = await client.post(f"{API}/assessments/{aid}/attempts", headers=learner.headers)
    assert again.status_code == 200 and again.json()["id"] == attempt["id"]

    # The server-side snapshot keeps answer keys, the drawn pool questions respect filters, and the seed
    # reproduces the draw.
    stored = await fetch(AssessmentAttempt, uuid.UUID(attempt["id"]))
    assert all("answer_key" in q for q in stored.questions_snapshot)
    pool_qs = [q for q in stored.questions_snapshot if q["id"] != mc]
    assert len(pool_qs) == 2 and all(q["difficulty"] == 3 and q["weight"] == 2 for q in pool_qs)
    assert isinstance(stored.settings_snapshot["seed"], int)

    for q in attempt["questions"]:
        resp = {"choice_id": "b"} if q["question_type"] == "multiple_choice" else {"value": True}
        r = await client.put(
            f"{API}/attempts/{attempt['id']}/answers/{q['id']}",
            json={"response": resp},
            headers=learner.headers,
        )
        assert r.status_code == 200, r.text
    got = (await client.get(f"{API}/attempts/{attempt['id']}", headers=learner.headers)).json()
    assert len(got["responses"]) == 3
    # Unknown question id rejected
    r = await client.put(
        f"{API}/attempts/{attempt['id']}/answers/{uuid.uuid4()}",
        json={"response": {}},
        headers=learner.headers,
    )
    assert r.status_code == 404

    r = await client.post(f"{API}/attempts/{attempt['id']}/submit", headers=learner.headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "graded" and body["score"] == 6.0 and body["max_score"] == 6.0 and body["passed"]
    assert any(
        e["attempt_id"] == uuid.UUID(attempt["id"]) and e["course_id"] == course_id for e in GRADED_EVENTS
    )

    res = (await client.get(f"{API}/attempts/{attempt['id']}/result", headers=learner.headers)).json()
    assert res["feedback_available"] is True and res["percentage"] == 100.0
    mcq = next(q for q in res["questions"] if q["id"] == mc)
    assert mcq["correct_answer"] == {"choice_id": "b"} and mcq["explanation"] == "HTTPS defaults to 443."

    # Closed attempts reject further answers and re-submission
    r = await client.put(
        f"{API}/attempts/{attempt['id']}/answers/{mc}",
        json={"response": {"choice_id": "a"}},
        headers=learner.headers,
    )
    assert r.status_code == 409
    assert (
        await client.post(f"{API}/attempts/{attempt['id']}/submit", headers=learner.headers)
    ).status_code == 409
    # Other learners cannot see this attempt
    other = await add_member(admin.org_id, "learner")
    assert (await client.get(f"{API}/attempts/{attempt['id']}", headers=other.headers)).status_code == 404
    assert (
        await client.get(f"{API}/attempts/{attempt['id']}/result", headers=other.headers)
    ).status_code == 404

    stats = (await client.get(f"{API}/assessments/{aid}/stats", headers=admin.headers)).json()
    assert stats["graded_attempts"] == 1 and stats["pass_rate"] == 1.0
    mc_stat = next(s for s in stats["questions"] if s["question_id"] == mc)
    assert mc_stat["correct_rate"] == 1.0 and mc_stat["choice_distribution"] == {"b": 1}
    assert (await client.get(f"{API}/assessments/{aid}/stats", headers=learner.headers)).status_code == 403


async def test_not_enrolled_and_unpublished(client):
    admin, _, course_id = await _setup(client)
    outsider = await add_member(admin.org_id, "learner")
    mc = await _question(client, admin, MC)
    aid = await _assessment(client, admin, course_id, [{"question_id": mc}])
    r = await client.post(f"{API}/assessments/{aid}/attempts", headers=outsider.headers)
    assert r.status_code == 403 and r.json()["error"]["code"] == "not_enrolled"
    draft = (
        await client.post(
            f"{API}/assessments",
            json={"title": "Draft", "items": [{"question_id": mc}]},
            headers=admin.headers,
        )
    ).json()["id"]
    assert (
        await client.get(f"{API}/assessments/{draft}/overview", headers=outsider.headers)
    ).status_code == 404


async def test_max_attempts_enforced(client):
    admin, learner, course_id = await _setup(client)
    mc = await _question(client, admin, MC)
    aid = await _assessment(client, admin, course_id, [{"question_id": mc}], max_attempts=2)
    for _ in range(2):
        att = (await client.post(f"{API}/assessments/{aid}/attempts", headers=learner.headers)).json()
        await client.put(
            f"{API}/attempts/{att['id']}/answers/{mc}",
            json={"response": {"choice_id": "a"}},
            headers=learner.headers,
        )
        assert (
            await client.post(f"{API}/attempts/{att['id']}/submit", headers=learner.headers)
        ).status_code == 200
    r = await client.post(f"{API}/assessments/{aid}/attempts", headers=learner.headers)
    assert r.status_code == 409 and r.json()["error"]["code"] == "max_attempts_reached"
    ov = (await client.get(f"{API}/assessments/{aid}/overview", headers=learner.headers)).json()
    assert ov["can_start"] is False and ov["reason"] == "max_attempts_reached" and ov["attempts_used"] == 2
    assert ov["best_percentage"] == 0.0 and ov["passed"] is False


async def test_expiry_rejects_autosave_and_flags_late_submission(client):
    admin, learner, course_id = await _setup(client)
    mc = await _question(client, admin, MC)
    tf = await _question(client, admin, TF)
    aid = await _assessment(
        client, admin, course_id, [{"question_id": mc}, {"question_id": tf}], time_limit_minutes=5
    )
    att = (await client.post(f"{API}/assessments/{aid}/attempts", headers=learner.headers)).json()
    await client.put(
        f"{API}/attempts/{att['id']}/answers/{mc}",
        json={"response": {"choice_id": "b"}},
        headers=learner.headers,
    )
    # Simulate the clock running out: expiry 2 minutes ago (beyond the submit grace period).
    now = datetime.now(UTC)
    await update_row(
        AssessmentAttempt,
        uuid.UUID(att["id"]),
        started_at=now - timedelta(minutes=7),
        expires_at=now - timedelta(minutes=2),
    )
    r = await client.put(
        f"{API}/attempts/{att['id']}/answers/{tf}",
        json={"response": {"value": True}},
        headers=learner.headers,
    )
    assert r.status_code == 409 and r.json()["error"]["code"] == "attempt_expired"
    r = await client.post(f"{API}/attempts/{att['id']}/submit", headers=learner.headers)
    assert r.status_code == 200
    assert r.json()["score"] == 2.0 and r.json()["max_score"] == 3.0  # only the saved answer counts
    res = (await client.get(f"{API}/attempts/{att['id']}/result", headers=learner.headers)).json()
    assert res["late"] is True


async def test_expired_attempt_auto_submitted_on_access(client):
    admin, learner, course_id = await _setup(client)
    mc = await _question(client, admin, MC)
    aid = await _assessment(client, admin, course_id, [{"question_id": mc}], time_limit_minutes=1)
    att = (await client.post(f"{API}/assessments/{aid}/attempts", headers=learner.headers)).json()
    await update_row(
        AssessmentAttempt, uuid.UUID(att["id"]), expires_at=datetime.now(UTC) - timedelta(hours=1)
    )
    got = (await client.get(f"{API}/attempts/{att['id']}", headers=learner.headers)).json()
    assert got["status"] == "graded" and got["remaining_seconds"] is None
    stored = await fetch(AssessmentAttempt, uuid.UUID(att["id"]))
    assert "auto_submitted" in stored.integrity


async def test_negative_marking_never_below_zero(client):
    admin, learner, course_id = await _setup(client)
    q1 = await _question(client, admin, {**MC, "negative_points": 1})
    q2 = await _question(client, admin, {**TF, "negative_points": 1})
    aid = await _assessment(
        client, admin, course_id, [{"question_id": q1}, {"question_id": q2}], negative_marking=True
    )
    att = (await client.post(f"{API}/assessments/{aid}/attempts", headers=learner.headers)).json()
    await client.put(
        f"{API}/attempts/{att['id']}/answers/{q1}",
        json={"response": {"choice_id": "a"}},
        headers=learner.headers,
    )
    await client.put(
        f"{API}/attempts/{att['id']}/answers/{q2}",
        json={"response": {"value": False}},
        headers=learner.headers,
    )
    body = (await client.post(f"{API}/attempts/{att['id']}/submit", headers=learner.headers)).json()
    assert body["score"] == 0.0 and body["percentage"] == 0.0 and body["passed"] is False
    res = (await client.get(f"{API}/attempts/{att['id']}/result", headers=learner.headers)).json()
    assert sorted(q["score"] for q in res["questions"]) == [-1.0, -1.0]


async def test_show_feedback_never_hides_answers(client):
    admin, learner, course_id = await _setup(client)
    mc = await _question(client, admin, MC)
    aid = await _assessment(client, admin, course_id, [{"question_id": mc}], show_feedback="never")
    att = (await client.post(f"{API}/assessments/{aid}/attempts", headers=learner.headers)).json()
    await client.post(f"{API}/attempts/{att['id']}/submit", headers=learner.headers)
    res = (await client.get(f"{API}/attempts/{att['id']}/result", headers=learner.headers)).json()
    assert res["feedback_available"] is False
    assert res["questions"][0]["correct_answer"] is None and res["questions"][0]["explanation"] is None
    assert res["percentage"] == 0.0
    staff = (await client.get(f"{API}/attempts/{att['id']}/result", headers=admin.headers)).json()
    assert staff["questions"][0]["correct_answer"] == {"choice_id": "b"}


async def test_manual_review_flow_and_integrity(client):
    admin, learner, course_id = await _setup(client)
    assessor = await add_member(admin.org_id, "assessor")
    mc = await _question(client, admin, MC)
    long_q = await _question(client, admin, LONG)
    aid = await _assessment(
        client, admin, course_id, [{"question_id": mc}, {"question_id": long_q}], grading_mode="manual"
    )
    att = (await client.post(f"{API}/assessments/{aid}/attempts", headers=learner.headers)).json()
    r = await client.post(
        f"{API}/attempts/{att['id']}/integrity", json={"event": "focus_lost"}, headers=learner.headers
    )
    assert r.status_code == 200 and r.json()["counts"] == {"focus_lost": 1}
    await client.put(
        f"{API}/attempts/{att['id']}/answers/{mc}",
        json={"response": {"choice_id": "b"}},
        headers=learner.headers,
    )
    await client.put(
        f"{API}/attempts/{att['id']}/answers/{long_q}",
        json={"response": {"text": "Seven layers"}},
        headers=learner.headers,
    )
    body = (await client.post(f"{API}/attempts/{att['id']}/submit", headers=learner.headers)).json()
    assert body["status"] == "needs_review" and body["passed"] is None

    queue = (await client.get(f"{API}/assessments/review-queue", headers=assessor.headers)).json()
    item = next(i for i in queue["items"] if i["attempt_id"] == att["id"])
    assert item["pending_questions"] == 1 and item["learner_name"] == "Lena Learner"
    assert (await client.get(f"{API}/assessments/review-queue", headers=learner.headers)).status_code == 403

    r = await client.post(f"{API}/attempts/{att['id']}/finalize", headers=assessor.headers)
    assert r.status_code == 409 and r.json()["error"]["code"] == "answers_pending"
    r = await client.put(
        f"{API}/attempts/{att['id']}/answers/{long_q}/grade", json={"score": 99}, headers=assessor.headers
    )
    assert r.status_code == 422
    r = await client.put(
        f"{API}/attempts/{att['id']}/answers/{long_q}/grade",
        json={"score": 4, "feedback": "Good structure"},
        headers=assessor.headers,
    )
    assert r.status_code == 200 and r.json()["pending"] == 0
    r = await client.post(f"{API}/attempts/{att['id']}/finalize", headers=assessor.headers)
    assert r.status_code == 200 and r.json()["status"] == "graded"
    assert r.json()["score"] == 6.0 and r.json()["percentage"] == round(6 / 7 * 100, 2)
    res = (await client.get(f"{API}/attempts/{att['id']}/result", headers=learner.headers)).json()
    lq = next(q for q in res["questions"] if q["id"] == long_q)
    assert lq["feedback"] == "Good structure" and lq["score"] == 4.0
    staff = (await client.get(f"{API}/attempts/{att['id']}/result", headers=assessor.headers)).json()
    assert staff["integrity"]["counts"]["focus_lost"] == 1


async def test_ai_grading_mode_enqueues_and_finalize_contract(client, monkeypatch):
    calls = []

    async def fake_enqueue(name, **kwargs):  # noqa: ANN001, ANN003
        kwargs.pop("db", None)
        calls.append((name, kwargs))

    monkeypatch.setattr(assess_service, "enqueue", fake_enqueue)
    admin, learner, course_id = await _setup(client)
    long_q = await _question(client, admin, LONG)
    aid = await _assessment(client, admin, course_id, [{"question_id": long_q}], grading_mode="ai_assisted")
    att = (await client.post(f"{API}/assessments/{aid}/attempts", headers=learner.headers)).json()
    await client.put(
        f"{API}/attempts/{att['id']}/answers/{long_q}",
        json={"response": {"text": "Layers"}},
        headers=learner.headers,
    )
    body = (await client.post(f"{API}/attempts/{att['id']}/submit", headers=learner.headers)).json()
    assert body["status"] == "needs_review"
    assert calls == [
        ("ai.grade_attempt_answers", {"attempt_id": att["id"], "organisation_id": str(admin.org_id)})
    ]

    # What the AI worker does: set ai_score on answers, then call finalize_attempt.
    async with get_sessionmaker()() as s:
        s.info["rls_bypass"] = True
        attempt = await s.get(AssessmentAttempt, uuid.UUID(att["id"]))
        answer = (
            await s.execute(AttemptAnswer.__table__.select().where(AttemptAnswer.attempt_id == attempt.id))
        ).first()
        row = await s.get(AttemptAnswer, answer.id)
        row.ai_score = 4.0
        row.ai_feedback = {"summary": "Mostly right"}
        await finalize_attempt(s, attempt)
        await s.commit()
        assert attempt.status == "graded" and attempt.percentage == 80.0 and attempt.passed is True
    assert any(e["attempt_id"] == uuid.UUID(att["id"]) and e["percentage"] == 80.0 for e in GRADED_EVENTS)

    # A human changing the AI score must give a reason (and it is recorded as an override).
    assessor = await add_member(admin.org_id, "assessor")
    r = await client.put(
        f"{API}/attempts/{att['id']}/answers/{long_q}/grade", json={"score": 3}, headers=assessor.headers
    )
    assert r.status_code == 422 and r.json()["error"]["code"] == "override_reason_required"
    r = await client.put(
        f"{API}/attempts/{att['id']}/answers/{long_q}/grade",
        json={"score": 3, "override_reason": "Missed layer 5"},
        headers=assessor.headers,
    )
    assert r.status_code == 200
    r = await client.post(f"{API}/attempts/{att['id']}/finalize", headers=assessor.headers)
    assert r.json()["percentage"] == 60.0 and r.json()["passed"] is False


async def test_assessment_settings_update_and_cross_tenant(client):
    admin, _, course_id = await _setup(client)
    mc = await _question(client, admin, MC)
    aid = await _assessment(client, admin, course_id, [{"question_id": mc}])
    r = await client.patch(
        f"{API}/assessments/{aid}",
        json={"time_limit_minutes": 20, "pass_percentage": 50, "high_stakes": True, "max_attempts": None},
        headers=admin.headers,
    )
    body = r.json()
    assert body["time_limit_minutes"] == 20 and body["pass_percentage"] == 50 and body["max_attempts"] is None
    assert body["status"] == "published" and body["question_count"] == 1
    other = await signup(client, org_name="Elsewhere")
    assert (await client.get(f"{API}/assessments/{aid}", headers=other.headers)).status_code == 404
    r = await client.put(
        f"{API}/assessments/{aid}/items",
        json={"items": [{"question_id": str(uuid.uuid4())}]},
        headers=admin.headers,
    )
    assert r.status_code == 404


def test_seed_reproduces_snapshot_order():
    pool = [
        {
            "id": f"q{i}",
            "question_type": "true_false",
            "options": {},
            "answer_key": {"value": True},
            "points": 1,
        }
        for i in range(10)
    ]
    items = [{"id": "i", "bank_id": "b", "draw_count": 4}]
    first = grading.draw_questions(
        items, {"i": pool}, {}, seed=99, shuffle_questions=True, shuffle_options=True
    )
    second = grading.draw_questions(
        items, {"i": pool}, {}, seed=99, shuffle_questions=True, shuffle_options=True
    )
    assert first == second
