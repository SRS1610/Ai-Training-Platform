"""Global search: visibility rules, ranking, typo tolerance, grouping/links, tenant isolation, semantic
merge."""

from __future__ import annotations

import sys
import types

from app.models.ai import KnowledgeDocument
from tests.factories import add_member, signup
from tests.ops_seed import seed_assignment, seed_course, seed_simulation, tenant_session

API = "/api/v1/search"


async def _seed(org_id):
    async with tenant_session(org_id) as s:
        pub = await seed_course(
            s,
            org_id,
            title="Firewall Fundamentals",
            modules=1,
            lessons_per_module=1,
            description="Packet filtering and firewall rules",
        )
        draft = await seed_course(
            s, org_id, title="Firewall Advanced Draft", status="draft", modules=1, lessons_per_module=1
        )
        await seed_course(s, org_id, title="Customer Service Basics", modules=0)
        await seed_assignment(s, org_id, pub.id, title="Firewall rule review")
        await seed_assignment(s, org_id, pub.id, title="Firewall draft task", status="draft")
        await seed_simulation(s, org_id, pub.id, title="Firewall outage simulation")
        s.add(
            KnowledgeDocument(
                organisation_id=org_id,
                title="Firewall policy v2",
                source_type="pdf",
                status="ready",
                approved=True,
            )
        )
    return pub, draft


async def test_learner_sees_published_only_and_no_users(client):
    admin = await signup(client, full_name="Fiona Firewall-Admin")
    learner = await add_member(admin.org_id, "learner")
    pub, draft = await _seed(admin.org_id)
    r = await client.get(API, params={"q": "firewall"}, headers=learner.headers)
    assert r.status_code == 200, r.text
    body = r.json()
    groups = {g["type"]: g for g in body["groups"]}
    assert set(groups) == {"courses", "lessons", "assignments", "simulations"}
    course_titles = [i["title"] for i in groups["courses"]["items"]]
    assert course_titles == ["Firewall Fundamentals"]
    assert groups["courses"]["items"][0]["link"] == f"/app/learn/{pub.id}"
    assert [i["title"] for i in groups["assignments"]["items"]] == ["Firewall rule review"]
    lesson = groups["lessons"]["items"][0]
    assert lesson["link"] == f"/app/learn/{pub.id}/lesson/{lesson['id']}"
    assert groups["simulations"]["items"][0]["link"].startswith("/app/simulations/")
    assert "users" not in body["types_searched"] and "documents" not in body["types_searched"]


async def test_editor_sees_drafts_users_and_documents(client):
    admin = await signup(client, full_name="Fiona Firewall-Admin")
    pub, draft = await _seed(admin.org_id)
    r = await client.get(API, params={"q": "firewall"}, headers=admin.headers)
    groups = {g["type"]: g for g in r.json()["groups"]}
    titles = {i["title"]: i for i in groups["courses"]["items"]}
    assert set(titles) == {"Firewall Fundamentals", "Firewall Advanced Draft"}
    assert titles["Firewall Advanced Draft"]["link"] == f"/app/instructor/courses/{draft.id}"
    assert {i["title"] for i in groups["assignments"]["items"]} == {
        "Firewall rule review",
        "Firewall draft task",
    }
    assert groups["documents"]["items"][0]["title"] == "Firewall policy v2"
    assert groups["users"]["items"][0]["title"] == "Fiona Firewall-Admin"
    # authors land in the simulation builder route (apps/web/app/app/instructor/simulations/[id])
    sim = groups["simulations"]["items"][0]
    assert sim["link"] == f"/app/instructor/simulations/{sim['id']}"

    # types filter + validation
    r = await client.get(API, params={"q": "firewall", "types": "users"}, headers=admin.headers)
    assert [g["type"] for g in r.json()["groups"]] == ["users"]
    assert (
        await client.get(API, params={"q": "firewall", "types": "bogus"}, headers=admin.headers)
    ).status_code == 400
    assert (await client.get(API, params={"q": "f"}, headers=admin.headers)).status_code == 400


async def test_ranking_and_typo_tolerance(client):
    admin = await signup(client)
    await _seed(admin.org_id)
    r = await client.get(
        API, params={"q": "Firewall Fundamentals", "types": "courses"}, headers=admin.headers
    )
    items = r.json()["groups"][0]["items"]
    assert items[0]["title"] == "Firewall Fundamentals" and items[0]["score"] >= items[-1]["score"]
    if r.json()["fuzzy"]:
        r = await client.get(
            API, params={"q": "firewal fundamentls", "types": "courses"}, headers=admin.headers
        )
        assert r.json()["groups"] and r.json()["groups"][0]["items"][0]["title"] == "Firewall Fundamentals"
    # LIKE wildcards are escaped
    r = await client.get(API, params={"q": "%%", "types": "courses"}, headers=admin.headers)
    assert r.json()["total"] == 0


async def test_tenant_isolation(client):
    a = await signup(client, org_name="Search A")
    b = await signup(client, org_name="Search B")
    await _seed(a.org_id)
    r = await client.get(API, params={"q": "firewall"}, headers=b.headers)
    assert r.status_code == 200 and r.json()["total"] == 0


async def test_semantic_results_merged(client, monkeypatch):
    admin = await signup(client)
    learner = await add_member(admin.org_id, "learner")
    calls = []

    async def semantic_search(db, *, organisation_id, query, k):
        calls.append((organisation_id, query, k))
        return [
            {
                "document_id": "doc-1",
                "title": "Incident policy",
                "content": "Escalate firewall incidents to SOC",
                "score": 0.83,
                "course_id": None,
            }
        ]

    fake = types.ModuleType("app.modules.ai.gateway")
    fake.semantic_search = semantic_search
    pkg = sys.modules.get("app.modules.ai") or types.ModuleType("app.modules.ai")
    monkeypatch.setitem(sys.modules, "app.modules.ai", pkg)
    monkeypatch.setitem(sys.modules, "app.modules.ai.gateway", fake)
    monkeypatch.setattr(pkg, "gateway", fake, raising=False)

    r = await client.get(
        API, params={"q": "firewall incidents", "types": "knowledge"}, headers=learner.headers
    )
    assert r.status_code == 200, r.text
    groups = r.json()["groups"]
    assert groups[0]["type"] == "knowledge" and groups[0]["items"][0]["title"] == "Incident policy"
    assert calls == [(admin.org_id, "firewall incidents", 5)]

    async def broken(db, **kw):
        raise RuntimeError("provider down")

    fake.semantic_search = broken
    r = await client.get(API, params={"q": "firewall incidents"}, headers=learner.headers)
    assert r.status_code == 200
