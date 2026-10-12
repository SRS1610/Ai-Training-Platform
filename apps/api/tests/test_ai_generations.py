"""AI generation workflow: request → run (offline) → review → edit / regenerate → approve → apply drafts."""

from __future__ import annotations

import uuid

from sqlalchemy import func, select

from app.models.ai import AIGeneration
from app.models.assessment import Assessment, Question
from app.models.assignment import Assignment, Rubric
from app.models.content import Activity, Course, CourseModule, Lesson
from app.models.platform import AuditLog, Notification
from app.workers import drain
from tests.ai_helpers import bypass_session, make_course
from tests.factories import add_member, set_plan, signup

COURSE_INPUT = {
    "subject": "IT incident management",
    "audience": "Service desk analysts",
    "difficulty": "intermediate",
    "objectives": ["Triage incidents", "Communicate with users"],
    "weeks": 2,
    "industry": "Banking",
    "question_count": 4,
    "question_types": ["multiple_choice", "true_false", "short_answer", "long_answer"],
}


async def generate(client, headers, kind, inputs, **extra):
    r = await client.post(
        "/api/v1/ai/generations", headers=headers, json={"kind": kind, "input": inputs, **extra}
    )
    assert r.status_code == 202, r.text
    assert r.json()["status"] == "pending"
    await drain()
    r = await client.get(f"/api/v1/ai/generations/{r.json()['id']}", headers=headers)
    assert r.json()["status"] == "completed", r.json()
    return r.json()


async def test_plan_and_permission_gates(client):
    admin = await signup(client)  # free plan → no AI generation
    r = await client.post(
        "/api/v1/ai/generations", headers=admin.headers, json={"kind": "course", "input": COURSE_INPUT}
    )
    assert r.status_code == 402
    await set_plan(admin.org_id, "business")
    learner = await add_member(admin.org_id, "learner")
    r = await client.post(
        "/api/v1/ai/generations", headers=learner.headers, json={"kind": "course", "input": COURSE_INPUT}
    )
    assert r.status_code == 403
    r = await client.post(
        "/api/v1/ai/generations", headers=admin.headers, json={"kind": "course", "input": {}}
    )
    assert r.status_code == 400 and r.json()["error"]["code"] == "validation_error"
    r = await client.post(
        "/api/v1/ai/generations", headers=admin.headers, json={"kind": "poem", "input": COURSE_INPUT}
    )
    assert r.status_code == 422


async def test_course_generation_review_and_apply_creates_drafts(client):
    admin = await signup(client)
    await set_plan(admin.org_id, "business")
    gen = await generate(client, admin.headers, "course", COURSE_INPUT)
    out = gen["output"]
    assert gen["offline"] is True and gen["model"] == "offline-demo" and gen["version"] == 1
    assert len(out["modules"]) == 2 and out["modules"][0]["title"] == "Triage incidents"
    assert out["final_assessment"]["questions"] and out["assignments"][0]["rubric"]["criteria"]
    assert out["flashcards"]["cards"] and out["revision_notes"]["sections"] and out["simulation_suggestion"]
    gid = gen["id"]

    # Applying requires approval
    r = await client.post(f"/api/v1/ai/generations/{gid}/apply", headers=admin.headers)
    assert r.status_code == 409
    # Edit before approval (validated against the schema)
    edited = {**out, "title": "Incident Management Essentials"}
    r = await client.patch(
        f"/api/v1/ai/generations/{gid}", headers=admin.headers, json={"edited_output": edited}
    )
    assert r.status_code == 200 and r.json()["edited_output"]["title"] == "Incident Management Essentials"
    r = await client.patch(
        f"/api/v1/ai/generations/{gid}",
        headers=admin.headers,
        json={"edited_output": {"title": "missing modules"}},
    )
    assert r.status_code == 400
    r = await client.post(
        f"/api/v1/ai/generations/{gid}/approve", headers=admin.headers, json={"notes": "LGTM"}
    )
    assert (
        r.status_code == 200
        and r.json()["status"] == "approved"
        and r.json()["reviewed_by"] == str(admin.user_id)
    )
    r = await client.post(f"/api/v1/ai/generations/{gid}/apply", headers=admin.headers)
    assert r.status_code == 200, r.text
    applied = r.json()
    assert applied["entity_type"] == "course" and applied["generation"]["status"] == "applied"
    assert applied["created"]["courses"] == 1 and applied["created"]["modules"] == 3
    assert applied["created"]["assessments"] == 3 and applied["created"]["assignments"] == 1
    cid = uuid.UUID(applied["entity_id"])
    async with bypass_session() as s:
        course = await s.get(Course, cid)
        assert course.title == "Incident Management Essentials"
        assert course.status == "draft" and course.ai_generated and course.current_version_id is None
        modules = (
            await s.scalars(
                select(CourseModule).where(CourseModule.course_id == cid).order_by(CourseModule.position)
            )
        ).all()
        assert [m.title for m in modules][:2] == [
            "Week 1: Triage incidents",
            "Week 2: Communicate with users",
        ]
        lessons = (await s.scalars(select(Lesson).where(Lesson.course_id == cid))).all()
        types = {lsn.lesson_type for lsn in lessons}
        assert {"text", "quiz", "assignment", "flashcards"} <= types and all(
            lsn.ai_generated for lsn in lessons
        )
        text_lesson = next(
            lsn for lsn in lessons if lsn.lesson_type == "text" and lsn.title == "Triage incidents"
        )
        assert "## Examples" in text_lesson.content["body_markdown"]
        assessments = (await s.scalars(select(Assessment).where(Assessment.course_id == cid))).all()
        assert {a.status for a in assessments} == {"draft"} and {a.kind for a in assessments} == {
            "quiz",
            "final",
        }
        assert all(
            lsn.assessment_id in {a.id for a in assessments} for lsn in lessons if lsn.lesson_type == "quiz"
        )
        qs = (
            await s.scalars(
                select(Question)
                .join(Assessment, Assessment.course_id == cid)
                .where(Question.ai_generated.is_(True))
            )
        ).all()
        mc = next(q for q in qs if q.question_type == "multiple_choice")
        assert mc.answer_key["choice_id"] in {c["id"] for c in mc.options["choices"]} and mc.explanation
        asg = (await s.scalars(select(Assignment).where(Assignment.course_id == cid))).one()
        assert asg.status == "draft" and asg.ai_generated and asg.rubric_id and asg.expected_output
        assert (await s.get(Rubric, asg.rubric_id)).ai_generated
        actions = set(
            (await s.scalars(select(AuditLog.action).where(AuditLog.organisation_id == admin.org_id))).all()
        )
        assert {
            "ai.generation.requested",
            "ai.generation.edited",
            "ai.generation.approved",
            "ai.generation.applied",
        } <= actions
        note = await s.scalar(
            select(Notification).where(
                Notification.user_id == admin.user_id, Notification.type == "generation_ready"
            )
        )
        assert note is not None and gid in note.link
    # Applied generations cannot be applied twice
    r = await client.post(f"/api/v1/ai/generations/{gid}/apply", headers=admin.headers)
    assert r.status_code == 409


async def test_regenerate_reject_and_list(client):
    admin = await signup(client)
    await set_plan(admin.org_id, "professional")
    gen = await generate(
        client, admin.headers, "quiz", {"subject": "Phishing awareness", "question_count": 3}
    )
    r = await client.post(
        f"/api/v1/ai/generations/{gen['id']}/regenerate",
        headers=admin.headers,
        json={"feedback": "Make the questions harder"},
    )
    assert r.status_code == 202
    await drain()
    v2 = (await client.get(f"/api/v1/ai/generations/{r.json()['id']}", headers=admin.headers)).json()
    assert v2["version"] == 2 and v2["parent_id"] == gen["id"] and v2["status"] == "completed"
    assert v2["input"]["feedback"] == "Make the questions harder" and "revised" in v2["output"]["description"]
    r = await client.post(f"/api/v1/ai/generations/{gen['id']}/reject", headers=admin.headers, json={})
    assert r.status_code == 422
    r = await client.post(
        f"/api/v1/ai/generations/{gen['id']}/reject", headers=admin.headers, json={"notes": "Too easy"}
    )
    assert r.json()["status"] == "rejected" and r.json()["review_notes"] == "Too easy"
    r = await client.post(f"/api/v1/ai/generations/{gen['id']}/approve", headers=admin.headers)
    assert r.status_code == 409
    r = await client.get("/api/v1/ai/generations?kind=quiz", headers=admin.headers)
    assert r.json()["total"] == 2 and r.json()["items"][0]["title"]
    other = await signup(client, org_name="Other")
    assert (await client.get(f"/api/v1/ai/generations/{gen['id']}", headers=other.headers)).status_code == 404


async def test_lesson_level_kinds_apply_into_existing_course(client):
    admin = await signup(client)
    await set_plan(admin.org_id, "business")
    course = await make_course(
        admin.org_id,
        admin.user_id,
        publish=False,
        lessons=[
            {
                "title": "Password basics",
                "body": "Passwords must be at least fourteen characters long. "
                "Multi-factor authentication is mandatory for remote access.",
            }
        ],
    )
    cid = str(course["course_id"])
    results = {}
    for kind in ("lesson", "flashcards", "revision_notes", "case_study", "module"):
        gen = await generate(
            client,
            admin.headers,
            kind,
            {"subject": "Password security", "course_id": cid, "lesson_id": str(course["lesson_ids"][0])},
        )
        await client.post(f"/api/v1/ai/generations/{gen['id']}/approve", headers=admin.headers)
        r = await client.post(f"/api/v1/ai/generations/{gen['id']}/apply", headers=admin.headers, json={})
        assert r.status_code == 200, (kind, r.text)
        results[kind] = r.json()
    assert results["module"]["entity_type"] == "module" and results["lesson"]["entity_type"] == "lesson"
    for kind in ("quiz", "assignment", "rubric", "scenario"):
        gen = await generate(client, admin.headers, kind, {"subject": "Password security"})
        await client.post(f"/api/v1/ai/generations/{gen['id']}/approve", headers=admin.headers)
        r = await client.post(
            f"/api/v1/ai/generations/{gen['id']}/apply", headers=admin.headers, json={"course_id": cid}
        )
        assert r.status_code == 200, (kind, r.text)
        results[kind] = r.json()
    assert results["scenario"]["entity_type"] == "simulation"
    async with bypass_session() as s:
        lessons = (await s.scalars(select(Lesson).where(Lesson.course_id == course["course_id"]))).all()
        by_type = {lsn.lesson_type for lsn in lessons}
        assert {"text", "flashcards", "scenario"} <= by_type
        scenario = next(lsn for lsn in lessons if lsn.lesson_type == "scenario")
        assert scenario.content["scenario"] and "model_answer" in scenario.content  # stripped on publish
        checks = await s.scalar(
            select(func.count())
            .select_from(Activity)
            .join(Lesson)
            .where(Lesson.course_id == course["course_id"], Activity.activity_type == "check")
        )
        assert checks >= 1
        a = await s.get(Assessment, uuid.UUID(results["quiz"]["entity_id"]))
        assert a.status == "draft" and str(a.course_id) == cid
        gens = (
            await s.scalars(select(AIGeneration).where(AIGeneration.organisation_id == admin.org_id))
        ).all()
        assert all(g.status == "applied" for g in gens)
    # lesson-level kinds need a course
    gen = await generate(client, admin.headers, "flashcards", {"subject": "Password security"})
    await client.post(f"/api/v1/ai/generations/{gen['id']}/approve", headers=admin.headers)
    r = await client.post(f"/api/v1/ai/generations/{gen['id']}/apply", headers=admin.headers)
    assert r.status_code == 400 and r.json()["error"]["code"] == "course_required"
