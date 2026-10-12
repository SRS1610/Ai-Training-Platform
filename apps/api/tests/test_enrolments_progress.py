from __future__ import annotations

import uuid
from datetime import date, timedelta

from sqlalchemy import select

from app.core.db import get_sessionmaker
from app.core.events import emit, subscribe
from app.models.learning import ActivityDay, Enrolment
from app.models.tenancy import Department, OrganisationUser, Team, TeamMember
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
    published_course,
)

CAPTURED: list[tuple[str, dict]] = []


@subscribe("course.completed")
async def _capture_course_completed(db, payload):  # noqa: ANN001
    CAPTURED.append(("course.completed", payload))


@subscribe("lesson.completed")
async def _capture_lesson_completed(db, payload):  # noqa: ANN001
    CAPTURED.append(("lesson.completed", payload))


@subscribe("enrolment.created")
async def _capture_enrolment_created(db, payload):  # noqa: ANN001
    CAPTURED.append(("enrolment.created", payload))


def _events(name: str, **match) -> list[dict]:
    return [p for n, p in CAPTURED if n == name and all(str(p.get(k)) == str(v) for k, v in match.items())]


async def _emit(org_id, event: str, payload: dict) -> None:
    async with get_sessionmaker()() as s:
        s.info["org_id"] = org_id
        await emit(s, event, payload)
        await s.commit()


async def test_self_enrol_pins_version_and_snapshot_immutability(client):
    admin = await org_with_admin(client)
    learner = await learner_in(admin.org_id)
    course = await create_course(client, admin, title="Pinned")
    r = await client.post(f"{API}/enrolments", json={"course_id": course["id"]}, headers=learner.headers)
    assert r.status_code == 400 and r.json()["error"]["code"] == "course_not_published"
    m = await add_module(client, admin, course["id"])
    l1 = await add_lesson(client, admin, course["id"], m["id"], "Original title")
    await publish(client, admin, course["id"])
    e = await enrol(client, learner, course["id"])
    assert e["status"] == "not_started" and e["source"] == "self"
    assert _events("enrolment.created", enrolment_id=e["id"])
    r = await client.post(f"{API}/enrolments", json={"course_id": course["id"]}, headers=learner.headers)
    assert r.status_code == 409

    # instructor edits + republishes; the enrolled learner keeps v1
    await client.patch(
        f"{API}/courses/{course['id']}/lessons/{l1['id']}",
        json={"title": "Edited title", "content": {"body_markdown": "new body"}},
        headers=admin.headers,
    )
    added = await add_lesson(client, admin, course["id"], m["id"], "Added in v2")
    view = (await client.get(f"{API}/learn/{course['id']}", headers=learner.headers)).json()
    assert view["modules"][0]["lessons"][0]["title"] == "Original title"
    await publish(client, admin, course["id"], "v2")
    view = (await client.get(f"{API}/learn/{course['id']}", headers=learner.headers)).json()
    assert view["version"]["version_number"] == 1 and view["upgrade_available"] is True
    assert [x["title"] for x in view["modules"][0]["lessons"]] == ["Original title"]
    lesson = (
        await client.get(f"{API}/learn/{course['id']}/lessons/{l1['id']}", headers=learner.headers)
    ).json()
    assert lesson["lesson"]["content"]["body_markdown"].startswith("# Original title")
    r = await client.get(f"{API}/learn/{course['id']}/lessons/{added['id']}", headers=learner.headers)
    assert r.status_code == 404

    # a new learner gets v2
    other = await learner_in(admin.org_id)
    await enrol(client, other, course["id"])
    view2 = (await client.get(f"{API}/learn/{course['id']}", headers=other.headers)).json()
    assert view2["version"]["version_number"] == 2 and view2["upgrade_available"] is False
    assert [x["title"] for x in view2["modules"][0]["lessons"]] == ["Edited title", "Added in v2"]

    # first learner completes lesson 1 then upgrades: progress kept for lessons that still exist
    r = await client.post(f"{API}/progress/lessons/{l1['id']}/complete", headers=learner.headers)
    assert r.status_code == 200 and r.json()["enrolment"]["progress_pct"] == 100.0
    assert r.json()["enrolment"]["status"] == "completed"
    r = await client.post(f"{API}/learn/{course['id']}/upgrade", headers=learner.headers)
    assert r.status_code == 400  # completed enrolments keep their version


async def test_upgrade_keeps_progress(client):
    admin = await org_with_admin(client)
    learner = await learner_in(admin.org_id)
    course, m, (l1, l2) = await published_course(client, admin)
    await enrol(client, learner, course["id"])
    await client.post(f"{API}/progress/lessons/{l1['id']}/complete", headers=learner.headers)
    await client.delete(f"{API}/courses/{course['id']}/lessons/{l2['id']}", headers=admin.headers)
    l3 = await add_lesson(client, admin, course["id"], m["id"], "L3")
    await publish(client, admin, course["id"])
    r = await client.post(f"{API}/learn/{course['id']}/upgrade", headers=learner.headers)
    assert r.status_code == 200, r.text
    view = r.json()
    assert view["version"]["version_number"] == 2
    assert [x["id"] for x in view["modules"][0]["lessons"]] == [l1["id"], l3["id"]]
    assert view["modules"][0]["lessons"][0]["progress"]["status"] == "completed"
    assert view["enrolment"]["progress_pct"] == 50.0 and view["next_lesson"]["id"] == l3["id"]
    r = await client.post(f"{API}/learn/{course['id']}/upgrade", headers=learner.headers)
    assert r.status_code == 400


async def test_progress_heartbeat_streak_and_completion(client, db):
    admin = await org_with_admin(client)
    learner = await learner_in(admin.org_id)
    course, _, (l1, l2) = await published_course(client, admin)
    # not enrolled
    r = await client.post(f"{API}/progress/lessons/{l1['id']}/start", headers=learner.headers)
    assert r.status_code == 404
    e = await enrol(client, learner, course["id"])
    r = await client.post(f"{API}/progress/lessons/{l1['id']}/start", headers=learner.headers)
    assert r.status_code == 200 and r.json()["enrolment"]["status"] == "in_progress"
    r = await client.post(
        f"{API}/progress/lessons/{l1['id']}/heartbeat",
        json={"seconds": 3000, "position": {"scroll": 0.5}},
        headers=learner.headers,
    )
    body = r.json()
    assert body["credited_seconds"] == 120 and body["lesson"]["time_spent_seconds"] == 120
    assert body["lesson"]["last_position"] == {"scroll": 0.5}
    await client.post(
        f"{API}/progress/lessons/{l1['id']}/heartbeat", json={"seconds": 30}, headers=learner.headers
    )
    r = await client.post(f"{API}/progress/lessons/{l1['id']}/complete", headers=learner.headers)
    assert r.json()["enrolment"]["progress_pct"] == 50.0 and r.json()["lesson"]["status"] == "completed"
    assert r.json()["enrolment"]["time_spent_seconds"] == 150
    assert len(_events("lesson.completed", lesson_id=l1["id"])) == 1
    # idempotent
    await client.post(f"{API}/progress/lessons/{l1['id']}/complete", headers=learner.headers)
    assert len(_events("lesson.completed", lesson_id=l1["id"])) == 1

    r = await client.post(f"{API}/progress/lessons/{l2['id']}/complete", headers=learner.headers)
    assert r.json()["enrolment"]["status"] == "completed" and r.json()["enrolment"]["completed_at"]
    done = _events("course.completed", enrolment_id=e["id"])
    assert len(done) == 1 and done[0]["final_score"] is None
    assert set(done[0]) >= {
        "enrolment_id",
        "course_id",
        "course_version_id",
        "final_score",
        "organisation_id",
        "user_id",
    }
    day = (await db.execute(select(ActivityDay).where(ActivityDay.user_id == learner.user_id))).scalar_one()
    assert day.seconds == 150 and day.events >= 4

    mine = (await client.get(f"{API}/enrolments/me", headers=learner.headers)).json()
    assert mine[0]["status"] == "completed" and mine[0]["next_lesson"] is None and mine[0]["title"]


async def test_sequential_locking_and_preview(client):
    admin = await org_with_admin(client)
    learner = await learner_in(admin.org_id)
    course = await create_course(client, admin, sequential=True)
    m = await add_module(client, admin, course["id"])
    l1 = await add_lesson(client, admin, course["id"], m["id"], "First")
    l2 = await add_lesson(client, admin, course["id"], m["id"], "Second", is_preview=True)
    await publish(client, admin, course["id"])
    # preview lesson visible without enrolment, others not
    r = await client.get(f"{API}/learn/{course['id']}/lessons/{l2['id']}", headers=learner.headers)
    assert r.status_code == 200 and r.json()["preview"] is True
    r = await client.get(f"{API}/learn/{course['id']}/lessons/{l1['id']}", headers=learner.headers)
    assert r.status_code == 404
    await enrol(client, learner, course["id"])
    view = (await client.get(f"{API}/learn/{course['id']}", headers=learner.headers)).json()
    assert [x["locked"] for x in view["modules"][0]["lessons"]] == [False, True]
    assert view["next_lesson"]["id"] == l1["id"]
    r = await client.post(f"{API}/progress/lessons/{l2['id']}/complete", headers=learner.headers)
    assert r.status_code == 403 and r.json()["error"]["code"] == "lesson_locked"
    r = await client.get(f"{API}/learn/{course['id']}/lessons/{l2['id']}", headers=learner.headers)
    assert r.status_code == 403
    await client.post(f"{API}/progress/lessons/{l1['id']}/complete", headers=learner.headers)
    lesson = (
        await client.get(f"{API}/learn/{course['id']}/lessons/{l2['id']}", headers=learner.headers)
    ).json()
    assert lesson["previous_lesson_id"] == l1["id"] and lesson["next_lesson_id"] is None


async def test_event_driven_completion_and_final_score(client):
    admin = await org_with_admin(client)
    learner = await learner_in(admin.org_id)
    quiz = await make_assessment(admin.org_id, "Checkpoint")
    task = await make_assignment(admin.org_id, "Practical")
    sim = await make_simulation(admin.org_id)
    course = await create_course(client, admin)
    m = await add_module(client, admin, course["id"])
    read = await add_lesson(client, admin, course["id"], m["id"], "Read")
    ql = await add_lesson(
        client, admin, course["id"], m["id"], "Quiz", lesson_type="quiz", assessment_id=str(quiz.id)
    )
    al = await add_lesson(
        client, admin, course["id"], m["id"], "Task", lesson_type="assignment", assignment_id=str(task.id)
    )
    sl = await add_lesson(
        client, admin, course["id"], m["id"], "Sim", lesson_type="simulation", simulation_id=str(sim.id)
    )
    await publish(client, admin, course["id"])
    e = await enrol(client, learner, course["id"])

    r = await client.post(f"{API}/progress/lessons/{ql['id']}/complete", headers=learner.headers)
    assert r.status_code == 400 and r.json()["error"]["code"] == "completion_by_grading"
    await client.post(f"{API}/progress/lessons/{read['id']}/complete", headers=learner.headers)

    base = {"organisation_id": admin.org_id, "user_id": learner.user_id, "course_id": uuid.UUID(course["id"])}
    # failed attempt does not complete
    att = await graded_attempt(admin.org_id, learner.user_id, quiz.id, 40)
    await _emit(
        admin.org_id,
        "assessment.attempt_graded",
        {**base, "attempt_id": att.id, "assessment_id": quiz.id, "percentage": 40, "passed": False},
    )
    view = (await client.get(f"{API}/learn/{course['id']}", headers=learner.headers)).json()
    assert view["modules"][0]["lessons"][1]["progress"]["status"] is None
    att2 = await graded_attempt(admin.org_id, learner.user_id, quiz.id, 90, n=2)
    await _emit(
        admin.org_id,
        "assessment.attempt_graded",
        {**base, "attempt_id": att2.id, "assessment_id": quiz.id, "percentage": 90, "passed": True},
    )
    view = (await client.get(f"{API}/learn/{course['id']}", headers=learner.headers)).json()
    assert view["modules"][0]["lessons"][1]["progress"]["status"] == "completed"
    assert view["enrolment"]["progress_pct"] == 50.0
    assert view["modules"][0]["lessons"][1]["completes_via"] == "assessment"

    from app.models.assignment import Submission
    from app.models.simulation import SimulationScenario, SimulationSession

    (sub,) = await insert(
        Submission(
            organisation_id=admin.org_id,
            assignment_id=task.id,
            user_id=learner.user_id,
            status="graded",
            final_score=80.0,
            passed=True,
        )
    )
    await _emit(
        admin.org_id,
        "submission.graded",
        {**base, "submission_id": sub.id, "assignment_id": task.id, "final_score": 80.0, "passed": True},
    )
    from datetime import UTC, datetime

    (scen,) = await insert(
        SimulationScenario(organisation_id=admin.org_id, simulation_id=sim.id, version=1, definition={})
    )
    (sess,) = await insert(
        SimulationSession(
            organisation_id=admin.org_id,
            simulation_id=sim.id,
            scenario_id=scen.id,
            user_id=learner.user_id,
            status="completed",
            phase="RESOLUTION",
            total_score=70.0,
            band="proficient",
            passed=True,
            started_at=datetime.now(UTC),
            completed_at=datetime.now(UTC),
        )
    )
    assert not _events("course.completed", enrolment_id=e["id"])
    await _emit(
        admin.org_id,
        "simulation.completed",
        {
            **base,
            "session_id": sess.id,
            "simulation_id": sim.id,
            "total_score": 70.0,
            "band": "proficient",
            "passed": True,
        },
    )
    done = _events("course.completed", enrolment_id=e["id"])
    assert len(done) == 1
    assert done[0]["final_score"] == 80.0  # mean of best quiz (90), submission (80), simulation (70)
    assert str(done[0]["user_id"]) == str(learner.user_id)
    view = (await client.get(f"{API}/learn/{course['id']}", headers=learner.headers)).json()
    assert view["enrolment"]["status"] == "completed" and view["enrolment"]["final_score"] == 80.0
    assert sl["id"] and al["id"]


async def test_assign_departments_teams_and_withdraw(client, db):
    admin = await org_with_admin(client)
    course, _, _ = await published_course(client, admin)
    u1, u2, u3, u4 = [await learner_in(admin.org_id) for _ in range(4)]
    parent, child = Department(organisation_id=admin.org_id, name="Eng"), None
    await insert(parent)
    child = Department(organisation_id=admin.org_id, name="Platform", parent_id=parent.id)
    team = Team(organisation_id=admin.org_id, name="Blue")
    await insert(child, team)
    await insert(TeamMember(organisation_id=admin.org_id, team_id=team.id, user_id=u3.user_id))
    for u, d in ((u1, parent.id), (u2, child.id)):
        m = (
            await db.execute(select(OrganisationUser).where(OrganisationUser.user_id == u.user_id))
        ).scalar_one()
        m.department_id = d
    await db.commit()

    due = (date.today() + timedelta(days=14)).isoformat()
    body = {
        "course_id": course["id"],
        "department_ids": [str(parent.id)],
        "team_ids": [str(team.id)],
        "due_date": due,
    }
    r = await client.post(f"{API}/enrolments/assign", json=body, headers=admin.headers)
    assert r.status_code == 200, r.text
    assert r.json()["created"] == 3 and r.json()["skipped"] == 0
    r = await client.post(
        f"{API}/enrolments/assign", json={**body, "user_ids": [str(u4.user_id)]}, headers=admin.headers
    )
    assert r.json() == {**r.json(), "created": 1, "skipped": 3}
    created = _events("enrolment.created", course_id=course["id"])
    assert len(created) == 4 and str(created[0]["assigned_by"]) == str(admin.user_id)

    # non-member user is rejected
    r = await client.post(
        f"{API}/enrolments/assign",
        json={"course_id": course["id"], "user_ids": [str(uuid.uuid4())]},
        headers=admin.headers,
    )
    assert r.status_code == 400
    # learners cannot assign
    r = await client.post(f"{API}/enrolments/assign", json=body, headers=u1.headers)
    assert r.status_code == 403

    page = (await client.get(f"{API}/enrolments?course_id={course['id']}", headers=admin.headers)).json()
    assert page["total"] == 4 and page["items"][0]["user"]["email"] and page["items"][0]["course"]["title"]
    page = (await client.get(f"{API}/enrolments?department_id={child.id}", headers=admin.headers)).json()
    assert page["total"] == 1 and page["items"][0]["user_id"] == str(u2.user_id)
    page = (await client.get(f"{API}/enrolments?overdue=true", headers=admin.headers)).json()
    assert page["total"] == 0

    eid = next(
        i["id"]
        for i in (await client.get(f"{API}/enrolments?team_id={team.id}", headers=admin.headers)).json()[
            "items"
        ]
    )
    # assigned training cannot be dropped by the learner
    r = await client.post(f"{API}/enrolments/{eid}/withdraw", headers=u3.headers)
    assert r.status_code == 403
    r = await client.patch(f"{API}/enrolments/{eid}", json={"due_date": None}, headers=admin.headers)
    assert r.json()["due_date"] is None
    r = await client.post(f"{API}/enrolments/{eid}/withdraw", headers=admin.headers)
    assert r.json()["status"] == "withdrawn"
    assert (await client.get(f"{API}/learn/{course['id']}", headers=u3.headers)).status_code == 404
    assert (await client.get(f"{API}/enrolments/me", headers=u3.headers)).json() == []
    # re-assign reactivates
    r = await client.post(
        f"{API}/enrolments/assign",
        json={"course_id": course["id"], "user_ids": [str(u3.user_id)]},
        headers=admin.headers,
    )
    assert r.json()["reactivated"] == 1
    row = await db.get(Enrolment, uuid.UUID(eid))
    await db.refresh(row)
    assert row.status == "not_started"


async def test_learner_can_withdraw_self_enrolment_and_cross_tenant(client):
    admin = await org_with_admin(client)
    learner = await learner_in(admin.org_id)
    course, _, (l1, _) = await published_course(client, admin)
    e = await enrol(client, learner, course["id"])
    other_org = await org_with_admin(client, "Other")
    outsider = await learner_in(other_org.org_id)
    assert (
        await client.post(f"{API}/enrolments/{e['id']}/withdraw", headers=outsider.headers)
    ).status_code == 404
    assert (await client.get(f"{API}/learn/{course['id']}", headers=outsider.headers)).status_code == 404
    r = await client.post(f"{API}/progress/lessons/{l1['id']}/start", headers=outsider.headers)
    assert r.status_code == 404
    peer = await learner_in(admin.org_id)
    assert (
        await client.post(f"{API}/enrolments/{e['id']}/withdraw", headers=peer.headers)
    ).status_code == 404
    r = await client.post(f"{API}/enrolments/{e['id']}/withdraw", headers=learner.headers)
    assert r.status_code == 200 and r.json()["status"] == "withdrawn"
    # can self-enrol again
    r = await client.post(f"{API}/enrolments", json={"course_id": course["id"]}, headers=learner.headers)
    assert r.status_code == 201 and r.json()["id"] == e["id"]


async def test_knowledge_check_activity(client):
    admin = await org_with_admin(client)
    learner = await learner_in(admin.org_id)
    course = await create_course(client, admin)
    m = await add_module(client, admin, course["id"])
    mixed = await add_lesson(client, admin, course["id"], m["id"], "Mixed", lesson_type="mixed", content={})
    act = (
        await client.post(
            f"{API}/courses/{course['id']}/lessons/{mixed['id']}/activities",
            json={
                "activity_type": "check",
                "content": {
                    "question": "Port for HTTPS?",
                    "options": [{"id": "a", "text": "443"}, {"id": "b", "text": "80"}],
                    "answer_ids": ["a"],
                    "explanation": "TLS default",
                },
            },
            headers=admin.headers,
        )
    ).json()
    await publish(client, admin, course["id"])
    await enrol(client, learner, course["id"])
    lesson = (
        await client.get(f"{API}/learn/{course['id']}/lessons/{mixed['id']}", headers=learner.headers)
    ).json()
    assert "answer_ids" not in lesson["lesson"]["activities"][0]["content"]
    url = f"{API}/learn/{course['id']}/activities/{act['id']}/check"
    r = await client.post(url, json={"answer_ids": ["b"]}, headers=learner.headers)
    assert r.json() == {"correct": False, "correct_ids": ["a"], "explanation": "TLS default"}
    r = await client.post(url, json={"answer_ids": ["a"]}, headers=learner.headers)
    assert r.json()["correct"] is True
