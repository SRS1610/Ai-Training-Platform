"""Personalised learning: graded evidence → EWMA skill proficiency → recommendations → AI plan."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select

from app.core.events import emit
from app.models.assessment import (
    Assessment,
    AssessmentAttempt,
    AssessmentItem,
    AttemptAnswer,
    Question,
    QuestionBank,
)
from app.models.content import LearnerSkill
from app.models.simulation import Simulation, SimulationScenario, SimulationSession
from app.modules.recommendations import service
from tests.ai_helpers import bypass_session, enrol, make_course, make_skill
from tests.factories import add_member, signup


async def graded_attempt(
    org_id, user_id, questions: list[tuple[uuid.UUID, bool]], *, course_id=None
) -> uuid.UUID:
    """questions: (skill_id, correct). Each becomes a 1-point question; returns attempt id."""
    snap, rows = [], []
    for sid, ok in questions:
        qid = uuid.uuid4()
        snap.append(
            {
                "id": str(qid),
                "question_type": "multiple_choice",
                "points": 1.0,
                "skill_ids": [str(sid)],
                "prompt": f"Question about {sid}?",
            }
        )
        rows.append((qid, ok))
    async with bypass_session() as s:
        a = Assessment(organisation_id=org_id, title="Quiz", course_id=course_id, status="published")
        s.add(a)
        await s.flush()
        n = len(
            (await s.scalars(select(AssessmentAttempt.id).where(AssessmentAttempt.user_id == user_id))).all()
        )
        att = AssessmentAttempt(
            organisation_id=org_id,
            assessment_id=a.id,
            user_id=user_id,
            attempt_number=n + 1,
            status="graded",
            started_at=datetime.now(UTC),
            questions_snapshot=snap,
            percentage=100.0 * sum(ok for _, ok in rows) / len(rows),
        )
        s.add(att)
        await s.flush()
        for qid, ok in rows:
            s.add(
                AttemptAnswer(
                    organisation_id=org_id,
                    attempt_id=att.id,
                    question_id=qid,
                    is_correct=ok,
                    final_score=1.0 if ok else 0.0,
                )
            )
        await s.flush()
        await emit(
            s,
            "assessment.attempt_graded",
            {
                "attempt_id": att.id,
                "assessment_id": a.id,
                "course_id": course_id,
                "percentage": att.percentage,
                "passed": att.percentage >= 70,
                "organisation_id": org_id,
                "user_id": user_id,
            },
        )
        return att.id


async def proficiency(user_id, skill_id) -> LearnerSkill | None:
    async with bypass_session() as s:
        return await s.scalar(
            select(LearnerSkill).where(LearnerSkill.user_id == user_id, LearnerSkill.skill_id == skill_id)
        )


async def test_evidence_updates_skills_and_recommends_weak_areas(client):
    admin = await signup(client)
    learner = await add_member(admin.org_id, "learner")
    ident = await make_skill(admin.org_id, "Incident identification")
    rca = await make_skill(admin.org_id, "Root-cause analysis")
    course = await make_course(
        admin.org_id,
        admin.user_id,
        lessons=[
            {"title": "Spotting incidents", "body": "...", "skill_ids": [ident]},
            {"title": "The 5 whys technique", "body": "...", "skill_ids": [rca]},
            {"title": "Fishbone diagrams", "body": "...", "skill_ids": [rca]},
        ],
    )
    await enrol(admin.org_id, learner.user_id, course)
    # A published practice quiz with RCA questions and a published RCA simulation
    async with bypass_session() as s:
        bank = QuestionBank(organisation_id=admin.org_id, title="RCA bank")
        s.add(bank)
        await s.flush()
        q = Question(
            organisation_id=admin.org_id,
            bank_id=bank.id,
            question_type="true_false",
            prompt="RCA?",
            answer_key={"value": True},
            skill_ids=[str(rca)],
        )
        practice = Assessment(
            organisation_id=admin.org_id,
            course_id=course["course_id"],
            title="RCA practice",
            kind="practice",
            status="published",
        )
        s.add_all([q, practice])
        await s.flush()
        s.add(AssessmentItem(organisation_id=admin.org_id, assessment_id=practice.id, question_id=q.id))
        sim = Simulation(
            organisation_id=admin.org_id,
            title="Outage investigation",
            status="published",
            skill_ids=[str(rca)],
        )
        s.add(sim)
        await s.flush()
        sim_id, practice_id = sim.id, practice.id

    await graded_attempt(
        admin.org_id,
        learner.user_id,
        [(ident, True), (ident, True), (rca, False), (rca, False)],
        course_id=course["course_id"],
    )
    p_ident, p_rca = await proficiency(learner.user_id, ident), await proficiency(learner.user_id, rca)
    assert p_ident.proficiency == 100 and p_rca.proficiency == 0 and p_rca.evidence_count == 1
    # EWMA: a later 100% result moves RCA by alpha (0.35), history keeps every observation
    await graded_attempt(admin.org_id, learner.user_id, [(rca, True)])
    p_rca = await proficiency(learner.user_id, rca)
    assert p_rca.proficiency == 35.0 and [h["score"] for h in p_rca.history] == [0.0, 100.0]

    r = await client.get("/api/v1/recommendations/me", headers=learner.headers)
    assert r.status_code == 200, r.text
    body = r.json()
    recs = body["items"]
    kinds = {x["kind"] for x in recs}
    assert {"lesson", "practice", "simulation", "revision_plan"} <= kinds
    lesson_recs = [x for x in recs if x["kind"] == "lesson"]
    assert {x["title"] for x in lesson_recs} == {"Review: The 5 whys technique", "Review: Fishbone diagrams"}
    assert all(x["skill_id"] == str(rca) for x in lesson_recs)
    assert (
        "Your performance indicates that you understand Incident identification but need additional practice "
        "in Root-cause analysis"
    ) in lesson_recs[0]["reason"]
    assert any(x["target_id"] == str(practice_id) for x in recs if x["kind"] == "practice")
    assert any(x["target_id"] == str(sim_id) for x in recs if x["kind"] == "simulation")
    plan_rec = next(x for x in recs if x["kind"] == "revision_plan")
    assert plan_rec["data"]["focus_skills"] == ["Root-cause analysis"]
    assert recs == sorted(recs, key=lambda x: -x["priority"])
    assert {s_["name"] for s_ in body["skills"]} == {"Incident identification", "Root-cause analysis"}

    # dismiss → not re-suggested on refresh
    target = lesson_recs[0]
    r = await client.post(f"/api/v1/recommendations/{target['id']}/dismiss", headers=learner.headers)
    assert r.status_code == 200 and r.json()["status"] == "dismissed"
    r = await client.post("/api/v1/recommendations/me/refresh", headers=learner.headers)
    assert target["target_id"] not in {x["target_id"] for x in r.json()["items"]}
    other = await add_member(admin.org_id, "learner")
    r = await client.post(f"/api/v1/recommendations/{lesson_recs[1]['id']}/dismiss", headers=other.headers)
    assert r.status_code == 404  # recommendations are private to their learner

    r = await client.get("/api/v1/recommendations/me/plan", headers=learner.headers)
    assert r.status_code == 200, r.text
    plan = r.json()
    assert "need additional practice in Root-cause analysis" in plan["summary"]
    assert plan["generated_by"] == "ai" and plan["offline"] is True and plan["model"] == "offline-demo"
    assert plan["difficulty_adjustment"]["direction"] in ("easier", "maintain", "harder")
    assert plan["steps"] and plan["steps"][0]["focus"] == "Root-cause analysis"
    valid_targets = {
        x["target_id"]
        for x in (await client.get("/api/v1/recommendations/me", headers=learner.headers)).json()["items"]
    }
    for step in plan["steps"]:
        for act in step["activities"]:
            assert act["target_id"] is None or act["target_id"] in valid_targets


async def test_submission_and_simulation_evidence(client):
    admin = await signup(client)
    learner = await add_member(admin.org_id, "learner")
    comm = await make_skill(admin.org_id, "Communication")
    diag = await make_skill(admin.org_id, "Diagnosis")
    async with bypass_session() as s:
        sim = Simulation(
            organisation_id=admin.org_id, title="Helpdesk call", status="published", skill_ids=[str(diag)]
        )
        s.add(sim)
        await s.flush()
        sc = SimulationScenario(organisation_id=admin.org_id, simulation_id=sim.id, version=1, definition={})
        s.add(sc)
        await s.flush()
        sess = SimulationSession(
            organisation_id=admin.org_id,
            simulation_id=sim.id,
            scenario_id=sc.id,
            user_id=learner.user_id,
            status="completed",
            phase="RESOLUTION",
            started_at=datetime.now(UTC),
            total_score=80.0,
            dimension_scores={"communication": {"score": 3, "max": 10}, "unknown_dim": 50},
        )
        s.add(sess)
        await s.flush()
        await emit(
            s,
            "simulation.completed",
            {
                "session_id": sess.id,
                "simulation_id": sim.id,
                "course_id": None,
                "total_score": 80.0,
                "band": "proficient",
                "passed": True,
                "organisation_id": admin.org_id,
                "user_id": learner.user_id,
            },
        )
    assert (await proficiency(learner.user_id, diag)).proficiency == 80.0
    assert (await proficiency(learner.user_id, comm)).proficiency == 30.0
    async with bypass_session() as s:
        recs = await service.list_active(s, admin.org_id, learner.user_id)
    plan = next(r for r in recs if r.kind == "revision_plan")
    assert plan.data["focus_skills"] == ["Communication"]


async def test_plan_without_history_and_permissions(client):
    admin = await signup(client)
    r = await client.get("/api/v1/recommendations/me/plan", headers=admin.headers)
    assert r.status_code == 200 and r.json()["steps"]
    assert r.json()["difficulty_adjustment"]["direction"] == "maintain"
    r = await client.get("/api/v1/recommendations/me", headers=admin.headers)
    assert r.json() == {"items": [], "skills": []}
    # recommendations feature disabled → deterministic plan, still 200
    from app.models.ai import AIConfiguration

    async with bypass_session() as s:
        cfg = await s.scalar(select(AIConfiguration).where(AIConfiguration.organisation_id == admin.org_id))
        cfg.features = {**cfg.features, "recommendations": False}
    r = await client.get("/api/v1/recommendations/me/plan", headers=admin.headers)
    assert r.status_code == 200 and r.json()["generated_by"] == "rules"
