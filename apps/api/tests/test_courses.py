from __future__ import annotations

import uuid

from sqlalchemy import select

from app.models.content import CourseVersion
from app.models.platform import AuditLog
from tests.factories import signup
from tests.learning_utils import (
    API,
    add_lesson,
    add_module,
    create_course,
    learner_in,
    make_assessment,
    make_assignment,
    org_with_admin,
    publish,
    published_course,
)


async def test_course_crud_slug_and_plan_limit(client):
    admin = await signup(client, org_name="Free Org")  # free plan: 3 courses
    c1 = await create_course(client, admin, title="Intro to Networking")
    assert c1["slug"] == "intro-to-networking" and c1["status"] == "draft"
    c2 = await create_course(client, admin, title="Intro to Networking")
    assert c2["slug"] == "intro-to-networking-2"
    r = await client.post(
        f"{API}/courses", json={"title": "X", "slug": "intro-to-networking"}, headers=admin.headers
    )
    assert r.status_code == 409
    await create_course(client, admin, title="Third")
    r = await client.post(f"{API}/courses", json={"title": "Fourth"}, headers=admin.headers)
    assert r.status_code == 402 and r.json()["error"]["details"]["resource"] == "max_courses"

    r = await client.patch(
        f"{API}/courses/{c1['id']}",
        json={"subtitle": "Basics", "difficulty": "advanced", "tags": ["net"], "sequential": True},
        headers=admin.headers,
    )
    assert r.status_code == 200 and r.json()["difficulty"] == "advanced" and r.json()["sequential"] is True
    r = await client.patch(f"{API}/courses/{c1['id']}", json={"status": "published"}, headers=admin.headers)
    assert r.status_code == 400

    # soft delete frees the slug and the plan slot
    assert (await client.delete(f"{API}/courses/{c1['id']}", headers=admin.headers)).status_code == 204
    assert (await client.get(f"{API}/courses/{c1['id']}", headers=admin.headers)).status_code == 404
    c4 = await create_course(client, admin, title="Intro to Networking")
    assert c4["slug"] == "intro-to-networking"


async def test_permissions_learner_cannot_author(client):
    admin = await org_with_admin(client)
    learner = await learner_in(admin.org_id)
    r = await client.post(f"{API}/courses", json={"title": "Nope"}, headers=learner.headers)
    assert r.status_code == 403
    course = await create_course(client, admin)
    assert (
        await client.get(f"{API}/courses/{course['id']}/structure", headers=learner.headers)
    ).status_code == 403
    r = await client.post(
        f"{API}/courses/{course['id']}/modules", json={"title": "M"}, headers=learner.headers
    )
    assert r.status_code == 403
    # SME may edit structure but not publish
    sme = await learner_in(admin.org_id, "sme")
    m = await add_module(client, sme, course["id"])
    await add_lesson(client, sme, course["id"], m["id"])
    r = await client.post(f"{API}/courses/{course['id']}/publish", json={}, headers=sme.headers)
    assert r.status_code == 403


async def test_lesson_type_validation(client):
    admin = await org_with_admin(client)
    course = await create_course(client, admin)
    m = await add_module(client, admin, course["id"])
    url = f"{API}/courses/{course['id']}/modules/{m['id']}/lessons"

    async def post(lesson_type, content, **kw):
        return await client.post(
            url,
            json={"title": "T", "lesson_type": lesson_type, "content": content, **kw},
            headers=admin.headers,
        )

    assert (await post("video", {})).status_code == 400
    assert (await post("video", {"video_url": "javascript:alert(1)"})).status_code == 400
    r = await post(
        "video",
        {
            "video_url": "https://cdn.example.com/v.mp4",
            "captions_url": "https://x/c.vtt",
            "transcript": "hello",
        },
    )
    assert r.status_code == 201
    assert (await post("text", {"body_markdown": ""})).status_code == 400
    assert (await post("code", {"language": "python"})).status_code == 400
    assert (await post("code", {"language": "python", "code": "print(1)"})).status_code == 201
    assert (await post("flashcards", {"cards": [{"front": "a"}]})).status_code == 400
    assert (await post("flashcards", {"cards": [{"front": "a", "back": "b"}]})).status_code == 201
    assert (await post("quiz", {})).status_code == 400
    # link must belong to the same organisation
    other = await org_with_admin(client, "Other Org")
    foreign = await make_assessment(other.org_id)
    r = await post("quiz", {}, assessment_id=str(foreign.id))
    assert r.status_code == 400 and r.json()["error"]["code"] == "invalid_link"
    mine = await make_assessment(admin.org_id, "My quiz")
    r = await post("quiz", {}, assessment_id=str(mine.id))
    assert r.status_code == 201
    assert r.json()["linked"]["title"] == "My quiz"
    # assignment lesson with simulation id only is rejected
    assert (await post("assignment", {}, simulation_id=str(uuid.uuid4()))).status_code == 400
    assert (await post("hologram", {})).status_code == 422


async def test_structure_reorder_and_activities(client):
    admin = await org_with_admin(client)
    course = await create_course(client, admin)
    m1 = await add_module(client, admin, course["id"], "One")
    m2 = await add_module(client, admin, course["id"], "Two")
    a = await add_lesson(client, admin, course["id"], m1["id"], "A")
    b = await add_lesson(client, admin, course["id"], m1["id"], "B")
    c = await add_lesson(client, admin, course["id"], m2["id"], "C")
    mixed = await add_lesson(client, admin, course["id"], m2["id"], "Mixed", lesson_type="mixed", content={})

    act_url = f"{API}/courses/{course['id']}/lessons/{mixed['id']}/activities"
    r = await client.post(act_url, json={"activity_type": "callout", "content": {}}, headers=admin.headers)
    assert r.status_code == 400
    a1 = (
        await client.post(
            act_url, json={"activity_type": "text", "content": {"body_markdown": "hi"}}, headers=admin.headers
        )
    ).json()
    a2 = (
        await client.post(
            act_url,
            json={
                "activity_type": "check",
                "content": {
                    "question": "2+2?",
                    "options": [{"id": "a", "text": "4"}, {"id": "b", "text": "5"}],
                    "answer_ids": ["a"],
                },
            },
            headers=admin.headers,
        )
    ).json()
    r = await client.put(
        f"{act_url}/order", json={"activity_ids": [a2["id"], a1["id"]]}, headers=admin.headers
    )
    assert r.status_code == 200 and [x["id"] for x in r.json()] == [a2["id"], a1["id"]]
    r = await client.patch(
        f"{API}/courses/{course['id']}/activities/{a1['id']}", json={"title": "Intro"}, headers=admin.headers
    )
    assert r.status_code == 200 and r.json()["title"] == "Intro"

    # Move B to module Two (first), swap modules
    body = {
        "modules": [
            {
                "id": m2["id"],
                "position": 0,
                "lessons": [
                    {"id": b["id"], "position": 0, "module_id": m2["id"]},
                    {"id": c["id"], "position": 1},
                    {"id": mixed["id"], "position": 2},
                ],
            },
            {"id": m1["id"], "position": 1, "lessons": [{"id": a["id"], "position": 0}]},
        ]
    }
    r = await client.put(f"{API}/courses/{course['id']}/structure", json=body, headers=admin.headers)
    assert r.status_code == 200, r.text
    tree = r.json()
    assert [m["title"] for m in tree["modules"]] == ["Two", "One"]
    assert [lsn["title"] for lsn in tree["modules"][0]["lessons"]] == ["B", "C", "Mixed"]
    assert [x["title"] for x in tree["modules"][0]["lessons"][2]["activities"]] == [None, "Intro"]
    assert tree["course"]["lesson_count"] == 4

    # Foreign ids are rejected
    other = await org_with_admin(client, "Other")
    oc = await create_course(client, other)
    om = await add_module(client, other, oc["id"])
    bad = {"modules": [{"id": om["id"], "position": 0, "lessons": []}]}
    r = await client.put(f"{API}/courses/{course['id']}/structure", json=bad, headers=admin.headers)
    assert r.status_code == 400

    # deleting a module soft-deletes its lessons
    assert (
        await client.delete(f"{API}/courses/{course['id']}/modules/{m1['id']}", headers=admin.headers)
    ).status_code == 204
    tree = (await client.get(f"{API}/courses/{course['id']}/structure", headers=admin.headers)).json()
    assert len(tree["modules"]) == 1 and tree["course"]["lesson_count"] == 3


async def test_publish_snapshot_versions_and_diff(client, db):
    admin = await org_with_admin(client)
    course = await create_course(client, admin, title="Secure Coding")
    r = await client.post(f"{API}/courses/{course['id']}/publish", json={}, headers=admin.headers)
    assert r.status_code == 400 and r.json()["error"]["code"] == "publish_validation_failed"

    m = await add_module(client, admin, course["id"])
    assignment = await make_assignment(admin.org_id)
    await add_lesson(client, admin, course["id"], m["id"], "Read me")
    await add_lesson(
        client,
        admin,
        course["id"],
        m["id"],
        "Code",
        lesson_type="code",
        content={"language": "python", "code": "x = 1", "expected_output": "1", "solution": "x=1"},
    )
    await add_lesson(
        client,
        admin,
        course["id"],
        m["id"],
        "Task",
        lesson_type="assignment",
        assignment_id=str(assignment.id),
    )
    v1 = await publish(client, admin, course["id"], "First release")
    assert v1["version"]["version_number"] == 1 and v1["course"]["status"] == "published"
    assert v1["course"]["current_version_number"] == 1

    snap = (await client.get(f"{API}/courses/{course['id']}/versions/1", headers=admin.headers)).json()[
        "snapshot"
    ]
    lessons = snap["modules"][0]["lessons"]
    code = next(x for x in lessons if x["lesson_type"] == "code")
    assert "expected_output" not in code["content"] and "solution" not in code["content"]
    task = next(x for x in lessons if x["lesson_type"] == "assignment")
    assert task["linked"]["title"] == "Assignment 1"
    assert "SECRET MODEL ANSWER" not in str(snap)
    assert snap["stats"]["lesson_count"] == 3

    structure = (await client.get(f"{API}/courses/{course['id']}/structure", headers=admin.headers)).json()
    assert structure["has_unpublished_changes"] is False

    # edit after publish → draft diverges, snapshot unchanged
    first = structure["modules"][0]["lessons"][0]
    await client.patch(
        f"{API}/courses/{course['id']}/lessons/{first['id']}",
        json={"title": "Read me (v2)"},
        headers=admin.headers,
    )
    new = await add_lesson(client, admin, course["id"], m["id"], "Brand new")
    await client.delete(f"{API}/courses/{course['id']}/lessons/{code['id']}", headers=admin.headers)
    structure = (await client.get(f"{API}/courses/{course['id']}/structure", headers=admin.headers)).json()
    assert structure["has_unpublished_changes"] is True
    v1_again = (await client.get(f"{API}/courses/{course['id']}/versions/1", headers=admin.headers)).json()
    assert v1_again["snapshot"] == snap

    diff = (
        await client.get(f"{API}/courses/{course['id']}/versions/diff?from=1&to=draft", headers=admin.headers)
    ).json()
    assert [x["id"] for x in diff["lessons_added"]] == [new["id"]]
    assert [x["id"] for x in diff["lessons_removed"]] == [code["id"]]
    assert diff["lessons_changed"][0]["fields"] == ["title"]

    v2 = await publish(client, admin, course["id"], "Second")
    assert v2["version"]["version_number"] == 2
    versions = (await client.get(f"{API}/courses/{course['id']}/versions", headers=admin.headers)).json()
    assert [(v["version_number"], v["status"]) for v in versions] == [(2, "published"), (1, "superseded")]
    assert versions[0]["published_by_name"] == "Test Admin" and versions[0]["changelog"] == "Second"
    diff = (
        await client.get(f"{API}/courses/{course['id']}/versions/diff?from=1&to=2", headers=admin.headers)
    ).json()
    assert diff["summary"] == {"added": 1, "removed": 1, "changed": 1, "moved": 0}

    rows = (
        await db.execute(select(CourseVersion).where(CourseVersion.course_id == uuid.UUID(course["id"])))
    ).all()
    assert len(rows) == 2
    audit = (
        (await db.execute(select(AuditLog.action).where(AuditLog.entity_id == course["id"]))).scalars().all()
    )
    assert audit.count("course.published") == 2


async def test_publish_fails_when_linked_item_deleted(client, db):
    admin = await org_with_admin(client)
    course = await create_course(client, admin)
    m = await add_module(client, admin, course["id"])
    quiz = await make_assessment(admin.org_id)
    await add_lesson(
        client, admin, course["id"], m["id"], "Quiz", lesson_type="quiz", assessment_id=str(quiz.id)
    )
    from datetime import UTC, datetime

    from app.models.assessment import Assessment

    row = await db.get(Assessment, quiz.id)
    row.deleted_at = datetime.now(UTC)
    await db.commit()
    r = await client.post(f"{API}/courses/{course['id']}/publish", json={}, headers=admin.headers)
    assert r.status_code == 400
    assert r.json()["error"]["details"]["problems"][0]["code"] == "missing_link"


async def test_publish_blocks_unpublished_or_empty_links(client):
    from app.core.db import get_sessionmaker
    from app.models.assessment import Assessment, AssessmentItem, QuestionBank
    from app.models.assignment import Assignment
    from app.models.simulation import Simulation
    from tests.learning_utils import insert

    admin = await org_with_admin(client)
    course = await create_course(client, admin)
    m = await add_module(client, admin, course["id"])
    (draft_quiz, empty_quiz, draft_task, draft_sim) = await insert(
        Assessment(organisation_id=admin.org_id, title="Draft quiz", status="draft"),
        Assessment(organisation_id=admin.org_id, title="Empty quiz", status="published"),
        Assignment(organisation_id=admin.org_id, title="Draft task", status="draft"),
        Simulation(organisation_id=admin.org_id, title="Draft sim", status="draft"),
    )
    l1 = await add_lesson(
        client, admin, course["id"], m["id"], "Q1", lesson_type="quiz", assessment_id=str(draft_quiz.id)
    )
    l2 = await add_lesson(
        client, admin, course["id"], m["id"], "Q2", lesson_type="quiz", assessment_id=str(empty_quiz.id)
    )
    l3 = await add_lesson(
        client, admin, course["id"], m["id"], "T", lesson_type="assignment", assignment_id=str(draft_task.id)
    )
    l4 = await add_lesson(
        client, admin, course["id"], m["id"], "S", lesson_type="simulation", simulation_id=str(draft_sim.id)
    )
    r = await client.post(f"{API}/courses/{course['id']}/publish", json={}, headers=admin.headers)
    assert r.status_code == 400 and r.json()["error"]["code"] == "publish_validation_failed"
    problems = {p["lesson_id"]: p for p in r.json()["error"]["details"]["problems"]}
    assert all(p["code"] == "link_not_published" for p in problems.values())
    assert problems[l1["id"]]["linked_status"] == "draft" and problems[l1["id"]]["lesson_title"] == "Q1"
    assert problems[l1["id"]]["linked_type"] == "assessment"
    assert problems[l1["id"]]["linked_id"] == str(draft_quiz.id)
    assert problems[l2["id"]]["linked_status"] == "empty" and "no questions" in problems[l2["id"]]["message"]
    assert problems[l3["id"]]["linked_type"] == "assignment"
    assert problems[l4["id"]]["linked_type"] == "simulation"

    # Fix everything: publish the drafts and give the empty quiz a random pool.
    (bank,) = await insert(QuestionBank(organisation_id=admin.org_id, title="Bank"))
    await insert(AssessmentItem(organisation_id=admin.org_id, assessment_id=empty_quiz.id, bank_id=bank.id))
    async with get_sessionmaker()() as sess:
        sess.info["rls_bypass"] = True
        for model, row_id in (
            (Assessment, draft_quiz.id),
            (Assignment, draft_task.id),
            (Simulation, draft_sim.id),
        ):
            (await sess.get(model, row_id)).status = "published"
        await sess.commit()
    # The draft quiz is now published but still has no questions.
    r = await client.post(f"{API}/courses/{course['id']}/publish", json={}, headers=admin.headers)
    assert [p["lesson_id"] for p in r.json()["error"]["details"]["problems"]] == [l1["id"]]
    await insert(AssessmentItem(organisation_id=admin.org_id, assessment_id=draft_quiz.id, bank_id=bank.id))
    v = await publish(client, admin, course["id"])
    assert v["course"]["status"] == "published"


async def test_learner_visibility_and_catalog(client):
    admin = await org_with_admin(client)
    learner = await learner_in(admin.org_id)
    draft = await create_course(client, admin, title="Hidden draft")
    pub, _, _ = await published_course(
        client, admin, title="Visible Course", category="Security", difficulty="intermediate"
    )
    # learner can't see drafts anywhere
    assert (await client.get(f"{API}/courses/{draft['id']}", headers=learner.headers)).status_code == 404
    listing = (await client.get(f"{API}/courses", headers=learner.headers)).json()
    assert [c["id"] for c in listing["items"]] == [pub["id"]]
    # draft title edits are not leaked to learners
    await client.patch(
        f"{API}/courses/{pub['id']}", json={"title": "Renamed in draft"}, headers=admin.headers
    )
    assert (await client.get(f"{API}/courses/{pub['id']}", headers=learner.headers)).json()[
        "title"
    ] == "Visible Course"
    assert (await client.get(f"{API}/courses/{pub['id']}", headers=admin.headers)).json()[
        "title"
    ] == "Renamed in draft"

    cat = (await client.get(f"{API}/catalog?search=visible", headers=learner.headers)).json()
    assert cat["total"] == 1 and cat["items"][0]["enrolment"] is None
    assert cat["items"][0]["lesson_count"] == 2
    assert (await client.get(f"{API}/catalog?search=hidden", headers=learner.headers)).json()["total"] == 0
    assert (await client.get(f"{API}/catalog?category=Security", headers=learner.headers)).json()[
        "total"
    ] == 1
    assert (await client.get(f"{API}/catalog?difficulty=expert", headers=learner.headers)).json()[
        "total"
    ] == 0
    await client.post(f"{API}/enrolments", json={"course_id": pub["id"]}, headers=learner.headers)
    cat = (await client.get(f"{API}/catalog", headers=learner.headers)).json()
    assert cat["items"][0]["enrolment"]["status"] == "not_started"
    assert (await client.get(f"{API}/catalog?enrolled=false", headers=learner.headers)).json()["total"] == 0
    detail = (await client.get(f"{API}/catalog/{pub['id']}", headers=learner.headers)).json()
    assert len(detail["outline"][0]["lessons"]) == 2 and "content" not in detail["outline"][0]["lessons"][0]
    # the course creator is the default instructor and is shown on the catalog page
    assert detail["instructor"]["id"] == str(admin.user_id) and detail["instructor"]["full_name"]
    cats = (await client.get(f"{API}/catalog/categories", headers=learner.headers)).json()
    assert cats == [{"category": "Security", "count": 1}]
    assert (await client.get(f"{API}/catalog/{draft['id']}", headers=learner.headers)).status_code == 404


async def test_cross_tenant_isolation(client):
    a = await org_with_admin(client, "Tenant A")
    b = await org_with_admin(client, "Tenant B")
    course, module, lessons = await published_course(client, a)
    for path in (
        f"/courses/{course['id']}",
        f"/courses/{course['id']}/structure",
        f"/catalog/{course['id']}",
        f"/courses/{course['id']}/versions",
        f"/courses/{course['id']}/lessons/{lessons[0]['id']}",
    ):
        assert (await client.get(API + path, headers=b.headers)).status_code == 404, path
    r = await client.patch(f"{API}/courses/{course['id']}", json={"title": "pwn"}, headers=b.headers)
    assert r.status_code == 404
    r = await client.post(
        f"{API}/courses/{course['id']}/modules/{module['id']}/lessons",
        json={"title": "x", "content": {"body_markdown": "x"}},
        headers=b.headers,
    )
    assert r.status_code == 404
    assert (await client.get(f"{API}/catalog", headers=b.headers)).json()["total"] == 0
    r = await client.post(f"{API}/enrolments", json={"course_id": course["id"]}, headers=b.headers)
    assert r.status_code == 404


async def test_duplicate_archive_restore_and_skills(client):
    admin = await org_with_admin(client)
    r = await client.post(
        f"{API}/skills", json={"name": "Networking", "category": "IT"}, headers=admin.headers
    )
    assert r.status_code == 201, r.text
    skill = r.json()
    course, _, _ = await published_course(client, admin, title="Original", skill_ids=[skill["id"]])
    assert [s["name"] for s in course["skills"]] == ["Networking"]

    dup = (
        await client.post(f"{API}/courses/{course['id']}/duplicate", json={}, headers=admin.headers)
    ).json()
    assert (
        dup["title"] == "Copy of Original" and dup["status"] == "draft" and dup["current_version_id"] is None
    )
    tree = (await client.get(f"{API}/courses/{dup['id']}/structure", headers=admin.headers)).json()
    assert tree["course"]["lesson_count"] == 2 and tree["course"]["skills"][0]["id"] == skill["id"]

    r = await client.post(f"{API}/courses/{course['id']}/archive", headers=admin.headers)
    assert r.status_code == 200 and r.json()["status"] == "archived"
    learner = await learner_in(admin.org_id)
    assert (await client.get(f"{API}/catalog", headers=learner.headers)).json()["total"] == 0
    r = await client.post(f"{API}/enrolments", json={"course_id": course["id"]}, headers=learner.headers)
    assert r.status_code == 400
    r = await client.post(f"{API}/courses/{course['id']}/restore", headers=admin.headers)
    assert r.json()["status"] == "published"
    r = await client.post(f"{API}/courses/{dup['id']}/archive", headers=admin.headers)
    r = await client.post(f"{API}/courses/{dup['id']}/restore", headers=admin.headers)
    assert r.json()["status"] == "draft"

    r = await client.put(
        f"{API}/courses/{course['id']}/skills", json={"skill_ids": []}, headers=admin.headers
    )
    assert r.json()["skills"] == []
    r = await client.put(
        f"{API}/courses/{course['id']}/skills", json={"skill_ids": [str(uuid.uuid4())]}, headers=admin.headers
    )
    assert r.status_code == 400
    by_skill = (await client.get(f"{API}/catalog?skill_id={skill['id']}", headers=learner.headers)).json()
    assert by_skill["total"] == 1  # published snapshot still carries the skill until republished
