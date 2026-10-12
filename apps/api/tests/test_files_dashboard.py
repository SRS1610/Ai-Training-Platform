from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

from app.models.ai import AIGeneration
from app.models.assignment import Submission
from app.models.learning import ActivityDay
from app.models.platform import Certificate, Recommendation
from app.models.simulation import SimulationScenario, SimulationSession
from app.modules.dashboard.service import streaks
from tests.learning_utils import (
    API,
    add_lesson,
    add_module,
    create_course,
    enrol,
    graded_attempt,
    insert,
    learner_in,
    make_assessment,
    make_assignment,
    make_simulation,
    org_with_admin,
    publish,
)

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64


async def test_file_upload_download_and_access(client):
    admin = await org_with_admin(client)
    learner = await learner_in(admin.org_id)
    peer = await learner_in(admin.org_id)

    # learner can't upload lesson media
    r = await client.post(
        f"{API}/files",
        files={"file": ("a.png", PNG, "image/png")},
        data={"purpose": "lesson_media"},
        headers=learner.headers,
    )
    assert r.status_code == 403
    r = await client.post(
        f"{API}/files",
        files={"file": ("evil.html", b"<script>", "text/html")},
        data={"purpose": "other"},
        headers=learner.headers,
    )
    assert r.status_code == 400
    r = await client.post(
        f"{API}/files",
        files={"file": ("fake.png", b"not a png", "image/png")},
        data={"purpose": "other"},
        headers=learner.headers,
    )
    assert r.status_code == 400

    r = await client.post(
        f"{API}/files",
        files={"file": ("notes.txt", b"hello world", "text/plain")},
        data={"purpose": "submission"},
        headers=learner.headers,
    )
    assert r.status_code == 201, r.text
    own = r.json()
    assert own["download_url"].endswith(f"/files/{own['id']}/download") and own["size_bytes"] == 11
    r = await client.get(f"{API}/files/{own['id']}/download", headers=learner.headers)
    assert r.status_code == 200 and r.content == b"hello world"
    assert r.headers["content-disposition"].startswith("attachment")
    r = await client.get(
        f"{API}/files/{own['id']}/download", headers={**learner.headers, "Range": "bytes=6-"}
    )
    assert r.status_code == 206 and r.content == b"world" and r.headers["content-range"] == "bytes 6-10/11"
    r = await client.get(
        f"{API}/files/{own['id']}/download", headers={**learner.headers, "Range": "bytes=50-"}
    )
    assert r.status_code == 416
    # peers can't read it; staff can
    assert (await client.get(f"{API}/files/{own['id']}", headers=peer.headers)).status_code == 404
    assert (await client.get(f"{API}/files/{own['id']}/download", headers=admin.headers)).status_code == 200

    # lesson media becomes readable to members once a published course references it
    media = (
        await client.post(
            f"{API}/files",
            files={"file": ("pic.png", PNG, "image/png")},
            data={"purpose": "lesson_media"},
            headers=admin.headers,
        )
    ).json()
    assert (await client.get(f"{API}/files/{media['id']}", headers=peer.headers)).status_code == 404
    course = await create_course(client, admin)
    m = await add_module(client, admin, course["id"])
    await add_lesson(
        client,
        admin,
        course["id"],
        m["id"],
        "Pic",
        lesson_type="image",
        content={"file_id": media["id"], "alt_text": "diagram"},
    )
    await publish(client, admin, course["id"])
    r = await client.get(f"{API}/files/{media['id']}/download", headers=peer.headers)
    assert r.status_code == 200 and r.content == PNG and r.headers["content-disposition"].startswith("inline")

    # cross-tenant
    other = await org_with_admin(client, "Other files")
    assert (await client.get(f"{API}/files/{media['id']}", headers=other.headers)).status_code == 404
    # delete: owner only
    assert (await client.delete(f"{API}/files/{own['id']}", headers=peer.headers)).status_code == 404
    assert (await client.delete(f"{API}/files/{own['id']}", headers=learner.headers)).status_code == 204
    assert (await client.get(f"{API}/files/{own['id']}", headers=learner.headers)).status_code == 404


def test_streak_math():
    today = date(2026, 10, 12)
    days = {today - timedelta(days=i) for i in (0, 1, 2, 5, 6, 7, 8)}
    assert streaks(days, today) == (3, 4)
    assert streaks({today - timedelta(days=1)}, today) == (1, 1)
    assert streaks({today - timedelta(days=2)}, today) == (0, 1)
    assert streaks(set(), today) == (0, 0)


LEARNER_KEYS = {
    "stats",
    "current_courses",
    "upcoming_deadlines",
    "simulation_results",
    "skills",
    "certificates",
    "recommendations",
    "recent_activity",
    "activity_heatmap",
}


async def test_learner_dashboard_contract(client):
    admin = await org_with_admin(client)
    learner = await learner_in(admin.org_id)
    empty = (await client.get(f"{API}/dashboard/learner", headers=learner.headers)).json()
    assert set(empty) == LEARNER_KEYS
    assert empty["stats"] == {
        "courses_in_progress": 0,
        "courses_completed": 0,
        "certificates": 0,
        "streak_days": 0,
        "longest_streak": 0,
        "average_score": None,
        "learning_minutes_week": 0,
    }
    assert len(empty["activity_heatmap"]) == 84 and empty["activity_heatmap"][-1]["seconds"] == 0

    quiz = await make_assessment(admin.org_id, "Final quiz")
    task = await make_assignment(admin.org_id, "Lab report", due_days_after_enrolment=7)
    sim = await make_simulation(admin.org_id, "Outage drill")
    course = await create_course(client, admin, title="Ops 101", category="IT", difficulty="beginner")
    m = await add_module(client, admin, course["id"])
    l1 = await add_lesson(client, admin, course["id"], m["id"], "Read first")
    await add_lesson(
        client, admin, course["id"], m["id"], "Quiz", lesson_type="quiz", assessment_id=str(quiz.id)
    )
    await add_lesson(
        client, admin, course["id"], m["id"], "Lab", lesson_type="assignment", assignment_id=str(task.id)
    )
    await publish(client, admin, course["id"])
    done_course = await create_course(client, admin, title="Done course")
    dm = await add_module(client, admin, done_course["id"])
    dl = await add_lesson(client, admin, done_course["id"], dm["id"], "Only")
    await publish(client, admin, done_course["id"])

    due = (date.today() + timedelta(days=3)).isoformat()
    await client.post(
        f"{API}/enrolments/assign",
        json={"course_id": course["id"], "user_ids": [str(learner.user_id)], "due_date": due},
        headers=admin.headers,
    )
    await enrol(client, learner, done_course["id"])
    await client.post(
        f"{API}/progress/lessons/{l1['id']}/heartbeat", json={"seconds": 90}, headers=learner.headers
    )
    await client.post(f"{API}/progress/lessons/{l1['id']}/complete", headers=learner.headers)
    await client.post(f"{API}/progress/lessons/{dl['id']}/complete", headers=learner.headers)
    await graded_attempt(admin.org_id, learner.user_id, quiz.id, 88)

    now = datetime.now(UTC)
    yesterday = date.today() - timedelta(days=1)
    (scen,) = await insert(
        SimulationScenario(organisation_id=admin.org_id, simulation_id=sim.id, version=1, definition={})
    )
    await insert(
        ActivityDay(
            organisation_id=admin.org_id, user_id=learner.user_id, day=yesterday, events=2, seconds=600
        ),
        SimulationSession(
            organisation_id=admin.org_id,
            simulation_id=sim.id,
            scenario_id=scen.id,
            user_id=learner.user_id,
            status="completed",
            phase="RESOLUTION",
            total_score=82.5,
            band="proficient",
            passed=True,
            started_at=now,
            completed_at=now,
        ),
        Certificate(
            organisation_id=admin.org_id,
            certificate_number=f"CERT-T-{now.timestamp():.0f}",
            user_id=learner.user_id,
            course_id=done_course["id"],
            learner_name="L",
            course_title="Done course",
            organisation_name="Org",
            issued_at=now,
            verification_hash="x" * 64,
        ),
        Recommendation(
            organisation_id=admin.org_id,
            user_id=learner.user_id,
            kind="practice",
            title="Revise DNS",
            reason="Low quiz score",
            priority=0.9,
            course_id=course["id"],
        ),
        Recommendation(
            organisation_id=admin.org_id,
            user_id=learner.user_id,
            kind="course",
            title="Dismissed",
            reason="-",
            status="dismissed",
        ),
    )

    d = (await client.get(f"{API}/dashboard/learner", headers=learner.headers)).json()
    assert set(d) == LEARNER_KEYS
    st = d["stats"]
    assert st["courses_in_progress"] == 1 and st["courses_completed"] == 1 and st["certificates"] == 1
    assert st["streak_days"] == 2 and st["longest_streak"] == 2 and st["learning_minutes_week"] == 11
    assert st["average_score"] is None  # completed course had no graded components

    (cc,) = d["current_courses"]
    assert set(cc) == {
        "enrolment_id",
        "course_id",
        "title",
        "thumbnail_url",
        "category",
        "difficulty",
        "progress_pct",
        "status",
        "due_date",
        "last_accessed_at",
        "next_lesson",
    }
    assert cc["title"] == "Ops 101" and cc["category"] == "IT" and cc["due_date"] == due
    assert cc["next_lesson"]["title"] == "Quiz" and set(cc["next_lesson"]) == {"id", "title", "lesson_type"}
    assert round(cc["progress_pct"], 1) == 33.3

    kinds = [(x["type"], x["title"]) for x in d["upcoming_deadlines"]]
    assert kinds == [("course", "Ops 101"), ("assignment", "Lab report")]
    for item in d["upcoming_deadlines"]:
        assert set(item) == {"type", "id", "title", "course_id", "course_title", "due_at", "status"}
    assert d["upcoming_deadlines"][1]["status"] == "not_started"

    (sr,) = d["simulation_results"]
    assert set(sr) == {
        "session_id",
        "simulation_id",
        "title",
        "total_score",
        "band",
        "passed",
        "completed_at",
    }
    assert sr["title"] == "Outage drill" and sr["total_score"] == 82.5
    (cert,) = d["certificates"]
    assert set(cert) == {"id", "certificate_number", "course_title", "issued_at"}
    (rec,) = d["recommendations"]
    assert set(rec) == {"id", "kind", "title", "reason", "target_type", "target_id", "course_id"}
    assert rec["title"] == "Revise DNS"
    types = {a["type"] for a in d["recent_activity"]}
    assert {
        "lesson_completed",
        "course_enrolled",
        "course_completed",
        "certificate_issued",
        "assessment_graded",
        "simulation_completed",
    } <= types
    assert all(set(a) == {"type", "title", "at", "link"} for a in d["recent_activity"])
    assert len(d["recent_activity"]) <= 10
    assert d["activity_heatmap"][-1] == {"day": date.today().isoformat(), "seconds": 90}
    assert d["activity_heatmap"][-2]["seconds"] == 600


async def test_instructor_dashboard(client):
    admin = await org_with_admin(client)
    instructor = await learner_in(admin.org_id, "instructor")
    learner = await learner_in(admin.org_id)
    assert (await client.get(f"{API}/dashboard/instructor", headers=learner.headers)).status_code == 403

    task = await make_assignment(admin.org_id, "Graded task")
    course = await create_course(client, instructor, title="Instructor course")
    m = await add_module(client, instructor, course["id"])
    lesson = await add_lesson(client, instructor, course["id"], m["id"], "L")
    await publish(client, instructor, course["id"])
    await create_course(client, admin, title="Someone else's")
    await enrol(client, learner, course["id"])
    await client.post(f"{API}/progress/lessons/{lesson['id']}/complete", headers=learner.headers)
    other = await learner_in(admin.org_id)
    await enrol(client, other, course["id"])
    await insert(
        Submission(
            organisation_id=admin.org_id,
            assignment_id=task.id,
            user_id=learner.user_id,
            status="submitted",
            submitted_at=datetime.now(UTC),
        ),
        Submission(
            organisation_id=admin.org_id, assignment_id=task.id, user_id=other.user_id, status="draft"
        ),
        AIGeneration(
            organisation_id=admin.org_id, kind="course", status="completed", requested_by=instructor.user_id
        ),
    )
    d = (await client.get(f"{API}/dashboard/instructor", headers=instructor.headers)).json()
    assert [c["title"] for c in d["courses"]] == ["Instructor course"]
    c = d["courses"][0]
    assert c["enrolments"] == 2 and c["completed"] == 1 and c["completion_rate"] == 50.0
    assert c["current_version_number"] == 1
    assert d["pending_reviews"] == 1 and d["stats"]["pending_reviews"] == 1
    assert d["review_queue"][0]["assignment_title"] == "Graded task"
    assert d["stats"]["courses_total"] == 1 and d["stats"]["total_learners"] == 2
    assert d["recent_generations"][0]["kind"] == "course"
    d = (await client.get(f"{API}/dashboard/instructor?scope=all", headers=admin.headers)).json()
    assert d["stats"]["courses_total"] == 2
