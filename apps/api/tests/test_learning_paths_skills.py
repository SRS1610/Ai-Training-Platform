from __future__ import annotations

import uuid

from tests.learning_utils import API, create_course, learner_in, org_with_admin, published_course


async def test_learning_path_crud_enrol_and_progress(client):
    admin = await org_with_admin(client)
    c1, _, (l1, _) = await published_course(client, admin, title="Path course 1", n_lessons=2)
    c2, _, (m1,) = await published_course(client, admin, title="Path course 2", n_lessons=1)
    draft = await create_course(client, admin, title="Unpublished")
    learner = await learner_in(admin.org_id)

    r = await client.post(
        f"{API}/learning-paths",
        json={
            "title": "Onboarding",
            "items": [
                {"course_id": c1["id"]},
                {"course_id": c2["id"]},
                {"course_id": draft["id"], "is_required": False},
            ],
        },
        headers=admin.headers,
    )
    assert r.status_code == 201, r.text
    path = r.json()
    assert [i["course_title"] for i in path["items"]] == ["Path course 1", "Path course 2", "Unpublished"]
    # learners can't create, and can't see drafts
    assert (
        await client.post(f"{API}/learning-paths", json={"title": "x"}, headers=learner.headers)
    ).status_code == 403
    assert (
        await client.get(f"{API}/learning-paths/{path['id']}", headers=learner.headers)
    ).status_code == 404
    r = await client.post(
        f"{API}/learning-paths/{path['id']}/enrol",
        json={"user_ids": [str(learner.user_id)]},
        headers=admin.headers,
    )
    assert r.status_code == 400 and r.json()["error"]["code"] == "path_not_published"

    # reorder (c2 first), publish
    r = await client.put(
        f"{API}/learning-paths/{path['id']}/items",
        json={
            "items": [
                {"course_id": c2["id"]},
                {"course_id": c1["id"], "note": "Core"},
                {"course_id": draft["id"], "is_required": False},
            ]
        },
        headers=admin.headers,
    )
    assert [i["course_id"] for i in r.json()["items"]] == [c2["id"], c1["id"], draft["id"]]
    r = await client.patch(
        f"{API}/learning-paths/{path['id']}", json={"status": "published"}, headers=admin.headers
    )
    assert r.json()["status"] == "published"
    # invalid items rejected
    r = await client.put(
        f"{API}/learning-paths/{path['id']}/items",
        json={"items": [{"course_id": str(uuid.uuid4())}]},
        headers=admin.headers,
    )
    assert r.status_code == 400

    r = await client.post(
        f"{API}/learning-paths/{path['id']}/enrol",
        json={"user_ids": [str(learner.user_id)], "due_date": "2030-01-01"},
        headers=admin.headers,
    )
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["created"] == 2 and out["courses_skipped"] == [
        {"course_id": draft["id"], "reason": "not_published"}
    ]
    mine = (await client.get(f"{API}/enrolments/me", headers=learner.headers)).json()
    assert {e["source"] for e in mine} == {"learning_path"} and all(
        e["learning_path_id"] == path["id"] for e in mine
    )

    my_paths = (await client.get(f"{API}/learning-paths/me", headers=learner.headers)).json()
    assert len(my_paths) == 1 and my_paths[0]["status"] == "not_started"
    assert my_paths[0]["required_courses"] == 2 and my_paths[0]["next_course_id"] == c2["id"]

    await client.post(f"{API}/progress/lessons/{m1['id']}/complete", headers=learner.headers)
    await client.post(f"{API}/progress/lessons/{l1['id']}/complete", headers=learner.headers)
    p = (await client.get(f"{API}/learning-paths/me", headers=learner.headers)).json()[0]
    assert p["status"] == "in_progress" and p["completed_courses"] == 1 and p["progress_pct"] == 75.0
    assert p["next_course_id"] == c1["id"]

    # learners see published paths and can join; enrolled count reported to managers
    other = await learner_in(admin.org_id)
    assert (await client.get(f"{API}/learning-paths", headers=other.headers)).json()["total"] == 1
    r = await client.post(f"{API}/learning-paths/{path['id']}/join", headers=other.headers)
    assert r.json()["created"] == 2
    detail = (await client.get(f"{API}/learning-paths/{path['id']}", headers=admin.headers)).json()
    assert detail["enrolled_users"] == 2

    # cross-tenant
    outsider = await org_with_admin(client, "Elsewhere")
    assert (
        await client.get(f"{API}/learning-paths/{path['id']}", headers=outsider.headers)
    ).status_code == 404
    assert (
        await client.delete(f"{API}/learning-paths/{path['id']}", headers=outsider.headers)
    ).status_code == 404
    assert (
        await client.delete(f"{API}/learning-paths/{path['id']}", headers=admin.headers)
    ).status_code == 204
    assert (await client.get(f"{API}/learning-paths/{path['id']}", headers=admin.headers)).status_code == 404


async def test_skills_competencies_and_profile(client):
    admin = await org_with_admin(client)
    learner = await learner_in(admin.org_id)
    net = (
        await client.post(
            f"{API}/skills", json={"name": "Networking", "category": "IT"}, headers=admin.headers
        )
    ).json()
    sec = (await client.post(f"{API}/skills", json={"name": "Security"}, headers=admin.headers)).json()
    r = await client.post(f"{API}/skills", json={"name": "Networking"}, headers=admin.headers)
    assert r.status_code == 409
    assert (
        await client.post(f"{API}/skills", json={"name": "X"}, headers=learner.headers)
    ).status_code == 403
    assert len((await client.get(f"{API}/skills", headers=learner.headers)).json()) == 2
    r = await client.patch(f"{API}/skills/{sec['id']}", json={"category": "Cyber"}, headers=admin.headers)
    assert r.json()["category"] == "Cyber"

    r = await client.post(
        f"{API}/competencies",
        json={
            "name": "Network Engineer",
            "requirements": [
                {"skill_id": net["id"], "min_level": 60},
                {"skill_id": sec["id"], "min_level": 50},
            ],
        },
        headers=admin.headers,
    )
    assert r.status_code == 201, r.text
    comp = r.json()
    assert [q["skill_name"] for q in comp["requirements"]] == ["Networking", "Security"]
    r = await client.post(
        f"{API}/competencies",
        json={"name": "Bad", "requirements": [{"skill_id": str(uuid.uuid4())}]},
        headers=admin.headers,
    )
    assert r.status_code == 400

    # complete a course linked to Networking → evidence recorded via course.completed
    course, _, (lesson,) = await published_course(client, admin, n_lessons=1, skill_ids=[net["id"]])
    await client.post(f"{API}/enrolments", json={"course_id": course["id"]}, headers=learner.headers)
    await client.post(f"{API}/progress/lessons/{lesson['id']}/complete", headers=learner.headers)
    me = (await client.get(f"{API}/skills/me", headers=learner.headers)).json()
    assert me["skills"] == [
        {**me["skills"][0], "name": "Networking", "proficiency": 100.0, "evidence_count": 1}
    ]
    c = me["competencies"][0]
    assert c["attained"] is False and c["progress_pct"] == 50.0
    assert [q["met"] for q in c["requirements"]] == [True, False]

    r = await client.patch(
        f"{API}/competencies/{comp['id']}",
        json={"requirements": [{"skill_id": net["id"], "min_level": 60}]},
        headers=admin.headers,
    )
    assert len(r.json()["requirements"]) == 1
    assert (await client.get(f"{API}/skills/me", headers=learner.headers)).json()["competencies"][0][
        "attained"
    ]
    other = await org_with_admin(client, "Other")
    assert (await client.get(f"{API}/skills/{net['id']}", headers=other.headers)).status_code == 404
    assert (await client.delete(f"{API}/competencies/{comp['id']}", headers=other.headers)).status_code == 404
    assert (await client.delete(f"{API}/competencies/{comp['id']}", headers=admin.headers)).status_code == 204
    assert (await client.delete(f"{API}/skills/{sec['id']}", headers=admin.headers)).status_code == 204
