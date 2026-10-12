"""Assignments: rubrics, versioned submissions, evidence checks, grading, overrides, integrity, contract."""

from __future__ import annotations

import hashlib
import uuid

import pytest

from app.core.db import get_sessionmaker
from app.core.events import subscribe
from app.models.assignment import Grade, IntegritySignal, Submission, SubmissionVersion
from app.models.content import StoredFile
from app.models.platform import Notification
from app.modules.assignments import logic
from app.modules.assignments import service as asg_service
from app.modules.assignments.service import apply_grade
from tests.assess_helpers import API, enrol, fetch, make_course
from tests.factories import add_member, signup

EVENTS: dict[str, list[dict]] = {"submission.submitted": [], "submission.graded": []}


@subscribe("submission.submitted")
async def _cap_submitted(db, payload):  # noqa: ANN001
    EVENTS["submission.submitted"].append(payload)


@subscribe("submission.graded")
async def _cap_graded(db, payload):  # noqa: ANN001
    EVENTS["submission.graded"].append(payload)


CRITERIA = [
    {"id": "diag", "name": "Diagnosis", "weight": 60,
     "levels": [{"score": 0, "label": "Missing"}, {"score": 2, "label": "Partial"}, {"score": 4, "label": "Full"}]},
    {"id": "comm", "name": "Communication", "weight": 40, "max_score": 10},
]
ESSAY = ("The printer outage was caused by a stale DHCP reservation that pointed the print queue at an address "
         "now used by a laptop so jobs were silently dropped and users saw no error in the dialog box at all")


# ----------------------------------------------------------------------------- pure logic


def test_rubric_normalise_and_score():
    crit, errors = logic.normalise_criteria(CRITERIA)
    assert errors == [] and crit[0]["max_score"] == 4 and crit[1]["max_score"] == 10
    _, errors = logic.normalise_criteria([{**CRITERIA[0], "weight": 50}, CRITERIA[1]])
    assert errors == ["Criterion weights must sum to 100 (got 90)"]
    pct, breakdown, errors = logic.score_rubric(crit, [{"criterion_id": "diag", "score": 2},
                                                       {"criterion_id": "comm", "score": 10}])
    assert errors == [] and pct == 70.0 and breakdown[0]["max"] == 4
    _, _, errors = logic.score_rubric(crit, [{"criterion_id": "diag", "score": 5}])
    assert len(errors) == 2  # out of range + missing criterion


def test_missing_evidence_rules():
    required = [{"id": "t", "label": "Write-up", "type": "text"}, {"id": "s1", "label": "Shot 1", "type": "screenshot"},
                {"id": "s2", "label": "Shot 2", "type": "screenshot"}, {"id": "c", "label": "Code", "type": "code"},
                {"id": "opt", "label": "Optional video", "type": "video", "required": False}]
    files = [{"content_type": "image/png", "filename": "a.png"}]
    missing = logic.missing_evidence(required, [], text="", code=None, structured={}, files=files)
    assert [m["id"] for m in missing] == ["t", "c", "s2"]
    files.append({"content_type": "image/png", "filename": "b.png"})
    assert logic.missing_evidence(required, [], text="x", code="print(1)", structured={}, files=files) == []
    fields = [{"id": "root_cause", "label": "Root cause"}]
    req = [{"id": "st", "label": "Form", "type": "structured"}]
    assert logic.missing_evidence(req, fields, text=None, code=None, structured={}, files=[])
    assert not logic.missing_evidence(req, fields, text=None, code=None, structured={"root_cause": "dns"}, files=[])


def test_similarity_shingles():
    a = logic.shingles(ESSAY)
    assert logic.jaccard(a, logic.shingles(ESSAY.upper() + "!")) == 1.0
    assert logic.jaccard(a, logic.shingles("completely different words about networking and routers today")) == 0
    assert logic.shingles("too short text") == set()


# ----------------------------------------------------------------------------- helpers


async def _setup(client, **assignment_fields):
    admin = await signup(client, org_name=f"Asg {uuid.uuid4().hex[:6]}")
    instructor = await add_member(admin.org_id, "instructor", full_name="Ivy Instructor")
    learner = await add_member(admin.org_id, "learner", full_name="Leo Learner")
    course_id, version_id = await make_course(admin.org_id, instructor_id=instructor.user_id)
    await enrol(admin.org_id, learner.user_id, course_id, version_id)
    r = await client.post(f"{API}/rubrics", json={"title": "Support rubric", "criteria": CRITERIA},
                          headers=instructor.headers)
    assert r.status_code == 201, r.text
    rubric_id = r.json()["id"]
    body = {"title": "Diagnose the printer outage", "course_id": str(course_id), "rubric_id": rubric_id,
            "scenario": "Users cannot print.", "instructions": "Investigate and write up.",
            "expected_output": "SECRET MODEL ANSWER", "grading_mode": "manual", "max_submissions": 2,
            "required_evidence": [{"id": "writeup", "label": "Write-up", "type": "text"}], **assignment_fields}
    r = await client.post(f"{API}/assignments", json=body, headers=instructor.headers)
    assert r.status_code == 201, r.text
    aid = r.json()["id"]
    assert (await client.post(f"{API}/assignments/{aid}/publish", headers=instructor.headers)).status_code == 200
    return admin, instructor, learner, course_id, aid


async def _file(org_id, owner_id, name="shot.png", content_type="image/png") -> uuid.UUID:
    async with get_sessionmaker()() as s:
        s.info["rls_bypass"] = True
        f = StoredFile(organisation_id=org_id, owner_id=owner_id, storage_key=f"{org_id}/t/{uuid.uuid4().hex}",
                       filename=name, content_type=content_type, size_bytes=10,
                       sha256=hashlib.sha256(name.encode()).hexdigest(), purpose="submission", scan_status="clean")
        s.add(f)
        await s.commit()
        return f.id


GOOD = [{"criterion_id": "diag", "score": 4, "comment": "Spot on"}, {"criterion_id": "comm", "score": 8}]


# ----------------------------------------------------------------------------- authoring


async def test_rubric_validation_and_permissions(client):
    admin, instructor, learner, _, aid = await _setup(client)
    bad = await client.post(f"{API}/rubrics", json={"title": "Bad", "criteria": [{**CRITERIA[0], "weight": 30}]},
                            headers=instructor.headers)
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "invalid_rubric"
    assert (await client.post(f"{API}/rubrics", json={"title": "x", "criteria": CRITERIA},
                              headers=learner.headers)).status_code == 403
    # Learner view never includes the model answer; staff view does.
    lv = (await client.get(f"{API}/assignments/{aid}", headers=learner.headers)).json()
    assert "expected_output" not in lv and lv["rubric"]["criteria"][0]["id"] == "diag"
    sv = (await client.get(f"{API}/assignments/{aid}", headers=instructor.headers)).json()
    assert sv["expected_output"] == "SECRET MODEL ANSWER"
    other = await signup(client, org_name="Other")
    assert (await client.get(f"{API}/assignments/{aid}", headers=other.headers)).status_code == 404


# ----------------------------------------------------------------------------- learner flow


async def test_versions_evidence_submit_and_human_grade(client, monkeypatch):
    calls = []

    async def fake_enqueue(name, **kw):  # noqa: ANN001, ANN003
        calls.append(name)

    monkeypatch.setattr(asg_service, "enqueue", fake_enqueue)
    admin, instructor, learner, course_id, aid = await _setup(
        client, required_evidence=[{"id": "writeup", "label": "Write-up", "type": "text"},
                                   {"id": "shot", "label": "Screenshot", "type": "screenshot"}])
    assert (await client.get(f"{API}/assignments/{aid}/submission", headers=learner.headers)).json() is None
    r = await client.put(f"{API}/assignments/{aid}/submission", json={"text_content": "draft one"},
                         headers=learner.headers)
    assert r.status_code == 200 and r.json()["current_version"] == 1 and r.json()["status"] == "draft"
    # Submitting without the screenshot lists the missing evidence.
    r = await client.post(f"{API}/assignments/{aid}/submission/submit", headers=learner.headers)
    assert r.status_code == 422 and r.json()["error"]["details"]["missing"][0]["id"] == "shot"
    # Files must belong to the learner.
    foreign = await _file(admin.org_id, instructor.user_id)
    r = await client.put(f"{API}/assignments/{aid}/submission", json={"text_content": "x", "file_ids": [str(foreign)]},
                         headers=learner.headers)
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_files"
    shot = await _file(admin.org_id, learner.user_id)
    r = await client.put(f"{API}/assignments/{aid}/submission", json={"text_content": ESSAY, "file_ids": [str(shot)]},
                         headers=learner.headers)
    assert r.json()["current_version"] == 2
    r = await client.post(f"{API}/assignments/{aid}/submission/submit", headers=learner.headers)
    assert r.status_code == 200, r.text
    sub = r.json()
    assert sub["status"] == "submitted" and sub["submit_count"] == 1 and sub["latest_version"]["is_final"]
    assert sub["latest_version"]["files"][0]["filename"] == "shot.png" and sub["latest_version"]["content_sha256"]
    assert calls == []  # manual grading mode: no AI job
    ev = next(e for e in EVENTS["submission.submitted"] if str(e["submission_id"]) == sub["id"])
    assert ev["version_number"] == 2 and ev["course_id"] == course_id
    # Locked while being assessed; version history kept.
    r = await client.put(f"{API}/assignments/{aid}/submission", json={"text_content": "edit"}, headers=learner.headers)
    assert r.status_code == 409
    hist = (await client.get(f"{API}/assignments/{aid}/submission/versions", headers=learner.headers)).json()
    assert [v["version_number"] for v in hist] == [2, 1] and hist[1]["is_final"] is False

    # Grading queue + detail
    q = (await client.get(f"{API}/grading/queue", headers=instructor.headers)).json()
    item = next(i for i in q["items"] if i["submission_id"] == sub["id"])
    assert item["learner_name"] == "Leo Learner" and item["ai_recommendation"] is None
    assert (await client.get(f"{API}/grading/queue", headers=learner.headers)).status_code == 403
    detail = (await client.get(f"{API}/grading/submissions/{sub['id']}", headers=instructor.headers)).json()
    assert len(detail["versions"]) == 2 and detail["assignment"]["expected_output"] == "SECRET MODEL ANSWER"

    r = await client.post(f"{API}/grading/submissions/{sub['id']}/grade", json={"rubric_scores": GOOD[:1]},
                          headers=instructor.headers)
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_rubric_scores"
    r = await client.post(f"{API}/grading/submissions/{sub['id']}/grade",
                          json={"rubric_scores": GOOD, "summary": "Great work", "strengths": ["Clear"]},
                          headers=instructor.headers)
    assert r.status_code == 201, r.text
    grade = r.json()
    assert grade["score"] == 92.0 and grade["source"] == "human" and grade["is_final"] and grade["passed"]
    assert grade["rubric_breakdown"][0]["comment"] == "Spot on"
    ev = next(e for e in EVENTS["submission.graded"] if str(e["submission_id"]) == sub["id"])
    assert ev["final_score"] == 92.0 and ev["passed"] is True and str(ev["grade_id"]) == grade["id"]

    mine = (await client.get(f"{API}/assignments/{aid}/submission", headers=learner.headers)).json()
    assert mine["status"] == "graded" and mine["final_score"] == 92.0 and mine["grade"]["summary"] == "Great work"
    async with get_sessionmaker()() as s:
        s.info["rls_bypass"] = True
        from sqlalchemy import select

        notes = (await s.execute(select(Notification).where(Notification.user_id == learner.user_id,
                                                            Notification.type == "instructor_feedback"))).scalars()
        assert len(list(notes)) >= 1
        # The final version is immutable evidence.
        final = (await s.execute(select(SubmissionVersion).where(
            SubmissionVersion.submission_id == uuid.UUID(sub["id"]), SubmissionVersion.is_final.is_(True)))).scalar_one()
        assert final.version_number == 2

    # Re-grading with a different score requires a reason (overrides the previous human grade).
    r = await client.post(f"{API}/grading/submissions/{sub['id']}/grade",
                          json={"rubric_scores": [GOOD[0], {"criterion_id": "comm", "score": 5}]},
                          headers=instructor.headers)
    assert r.status_code == 422 and r.json()["error"]["code"] == "override_reason_required"

    # Request review notifies the course instructor.
    r = await client.post(f"{API}/assignments/{aid}/submission/request-review", json={"note": "Please re-check"},
                          headers=learner.headers)
    assert r.status_code == 200 and r.json()["review_requested"] is True
    q = (await client.get(f"{API}/grading/queue", params={"review_requested": True}, headers=instructor.headers))
    assert any(i["submission_id"] == sub["id"] for i in q.json()["items"])


async def test_ai_grade_override_requires_reason_and_contract(client, monkeypatch):
    calls = []

    async def fake_enqueue(name, **kw):  # noqa: ANN001, ANN003
        calls.append((name, kw))

    monkeypatch.setattr(asg_service, "enqueue", fake_enqueue)
    admin, instructor, learner, _, aid = await _setup(client, grading_mode="ai_recommend_human_final",
                                                      high_stakes=True)
    await client.put(f"{API}/assignments/{aid}/submission", json={"text_content": ESSAY}, headers=learner.headers)
    sub = (await client.post(f"{API}/assignments/{aid}/submission/submit", headers=learner.headers)).json()
    assert calls == [("ai.grade_submission", {"submission_id": sub["id"], "organisation_id": str(admin.org_id)})]

    # What the AI worker does: write an AI Grade and apply it (requested final, but high-stakes keeps it a
    # recommendation).
    async with get_sessionmaker()() as s:
        s.info["rls_bypass"] = True
        submission = await s.get(Submission, uuid.UUID(sub["id"]))
        ai = Grade(organisation_id=admin.org_id, target_type="submission", target_id=submission.id, source="ai",
                   score=80.0, max_score=100.0, ai_model="offline", confidence=0.7, summary="Solid diagnosis",
                   rubric_breakdown=[{"criterion_id": "diag", "score": 3, "max": 4, "evidence": "stale DHCP"}])
        await apply_grade(s, submission, ai, make_final=True)
        await s.commit()
        assert submission.status == "ai_graded" and submission.ai_score == 80.0 and submission.final_score is None
        ai_id = ai.id

    learner_view = (await client.get(f"{API}/assignments/{aid}/submission", headers=learner.headers)).json()
    assert learner_view["grade"] is None and learner_view["final_score"] is None  # recommendation not released

    q = (await client.get(f"{API}/grading/queue", params={"high_stakes": True}, headers=instructor.headers)).json()
    item = next(i for i in q["items"] if i["submission_id"] == sub["id"])
    assert item["ai_recommendation"]["score"] == 80.0 and item["status"] == "ai_graded"

    r = await client.post(f"{API}/grading/submissions/{sub['id']}/grade", json={"rubric_scores": GOOD},
                          headers=instructor.headers)
    assert r.status_code == 422 and r.json()["error"]["code"] == "override_reason_required"
    r = await client.post(f"{API}/grading/submissions/{sub['id']}/grade",
                          json={"rubric_scores": GOOD, "override_reason": "Communication was excellent"},
                          headers=instructor.headers)
    assert r.status_code == 201
    g = r.json()
    assert g["overrides_grade_id"] == str(ai_id) and g["override_reason"] == "Communication was excellent"

    detail = (await client.get(f"{API}/grading/submissions/{sub['id']}", headers=instructor.headers)).json()
    assert detail["ai_recommendation"]["id"] == str(ai_id)
    assert {x["source"] for x in detail["grades"]} == {"ai", "human"}
    sub_row = await fetch(Submission, uuid.UUID(sub["id"]))
    assert (sub_row.ai_score, sub_row.human_score, sub_row.final_score) == (80.0, 92.0, 92.0)
    assert sub_row.graded_by == instructor.user_id and sub_row.graded_at is not None

    # A later AI grade can never replace the human final grade.
    async with get_sessionmaker()() as s:
        s.info["rls_bypass"] = True
        submission = await s.get(Submission, uuid.UUID(sub["id"]))
        late_ai = Grade(organisation_id=admin.org_id, target_type="submission", target_id=submission.id,
                        source="ai", score=10.0, max_score=100.0)
        await apply_grade(s, submission, late_ai, make_final=True)
        await s.commit()
        assert submission.final_score == 92.0 and submission.status == "graded"


async def test_apply_grade_ai_assisted_final(client, monkeypatch):
    async def fake_enqueue(name, **kw):  # noqa: ANN001, ANN003
        return None

    monkeypatch.setattr(asg_service, "enqueue", fake_enqueue)
    admin, _, learner, _, aid = await _setup(client, grading_mode="ai_assisted", passing_score=75)
    await client.put(f"{API}/assignments/{aid}/submission", json={"text_content": ESSAY}, headers=learner.headers)
    sub = (await client.post(f"{API}/assignments/{aid}/submission/submit", headers=learner.headers)).json()
    async with get_sessionmaker()() as s:
        s.info["rls_bypass"] = True
        submission = await s.get(Submission, uuid.UUID(sub["id"]))
        g = Grade(organisation_id=admin.org_id, target_type="submission", target_id=submission.id, source="ai",
                  score=14.0, max_score=20.0)
        await apply_grade(s, submission, g, make_final=True)
        await s.commit()
        assert submission.final_score == 70.0 and submission.passed is False and submission.status == "graded"
        assert g.is_final is True
    ev = next(e for e in EVENTS["submission.graded"] if str(e["submission_id"]) == sub["id"])
    assert ev["final_score"] == 70.0 and ev["passed"] is False


async def test_max_submissions_and_return_for_resubmission(client):
    admin, instructor, learner, _, aid = await _setup(client, max_submissions=2)
    await client.put(f"{API}/assignments/{aid}/submission", json={"text_content": "v1"}, headers=learner.headers)
    sub = (await client.post(f"{API}/assignments/{aid}/submission/submit", headers=learner.headers)).json()
    r = await client.post(f"{API}/grading/submissions/{sub['id']}/return-for-resubmission",
                          json={"feedback": "Add the root cause"}, headers=instructor.headers)
    assert r.status_code == 200 and r.json()["status"] == "returned"
    mine = (await client.get(f"{API}/assignments/{aid}/submission", headers=learner.headers)).json()
    assert mine["returned_feedback"] == "Add the root cause" and mine["submissions_remaining"] == 1
    # Must save new work before resubmitting
    r = await client.post(f"{API}/assignments/{aid}/submission/submit", headers=learner.headers)
    assert r.status_code == 409
    await client.put(f"{API}/assignments/{aid}/submission", json={"text_content": "v2"}, headers=learner.headers)
    sub = (await client.post(f"{API}/assignments/{aid}/submission/submit", headers=learner.headers)).json()
    assert sub["submit_count"] == 2 and sub["current_version"] == 2
    await client.post(f"{API}/grading/submissions/{sub['id']}/grade",
                      json={"rubric_scores": [{"criterion_id": "diag", "score": 0}, {"criterion_id": "comm",
                                                                                     "score": 1}]},
                      headers=instructor.headers)
    # Failed, but no submissions remain.
    r = await client.put(f"{API}/assignments/{aid}/submission", json={"text_content": "v3"}, headers=learner.headers)
    assert r.status_code == 409


async def test_similarity_signal_is_supplementary(client):
    admin, instructor, learner, _, aid = await _setup(client)
    copycat = await add_member(admin.org_id, "learner")
    course_id = (await client.get(f"{API}/assignments/{aid}", headers=instructor.headers)).json()["course_id"]
    from app.models.content import Course

    course = await fetch(Course, uuid.UUID(course_id))
    await enrol(admin.org_id, copycat.user_id, course.id, course.current_version_id)
    await client.put(f"{API}/assignments/{aid}/submission", json={"text_content": ESSAY}, headers=learner.headers)
    first = (await client.post(f"{API}/assignments/{aid}/submission/submit", headers=learner.headers)).json()
    assert first["integrity_flagged"] is False
    await client.put(f"{API}/assignments/{aid}/submission", json={"text_content": ESSAY + " Thanks."},
                     headers=copycat.headers)
    second = (await client.post(f"{API}/assignments/{aid}/submission/submit", headers=copycat.headers)).json()
    assert second["integrity_flagged"] is True and second["status"] == "submitted"  # never auto-penalised
    detail = (await client.get(f"{API}/grading/submissions/{second['id']}", headers=instructor.headers)).json()
    sig = detail["integrity_signals"][0]
    assert sig["signal_type"] == "similarity" and sig["score"] >= 0.6
    assert sig["details"]["matched_submission_id"] == first["id"] and "Supplementary" in sig["details"]["note"]
    q = (await client.get(f"{API}/grading/queue", headers=instructor.headers)).json()
    assert next(i for i in q["items"] if i["submission_id"] == second["id"])["integrity_flags"] == 1
    r = await client.post(f"{API}/grading/integrity-signals/{sig['id']}/review", json={"outcome": "dismissed"},
                          headers=instructor.headers)
    assert r.status_code == 200 and r.json()["review_outcome"] == "dismissed"
    row = await fetch(IntegritySignal, uuid.UUID(sig["id"]))
    assert row.reviewed_by == instructor.user_id


async def test_not_enrolled_cannot_submit(client):
    admin, _, _, _, aid = await _setup(client)
    outsider = await add_member(admin.org_id, "learner")
    r = await client.put(f"{API}/assignments/{aid}/submission", json={"text_content": "hi"}, headers=outsider.headers)
    assert r.status_code == 403


@pytest.mark.parametrize("weights", [[50, 50], [70, 30]])
def test_rubric_weights_ok(weights):
    crit = [{**CRITERIA[0], "weight": weights[0]}, {**CRITERIA[1], "weight": weights[1]}]
    assert logic.normalise_criteria(crit)[1] == []
