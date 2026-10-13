"""Simulations API: authoring, publishing, AI builder, learner sessions, scoring, integrity, analytics."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import select

from app.core.events import subscribe
from app.models.assignment import IntegritySignal
from app.models.simulation import Simulation, SimulationAction, SimulationSession, SimulationStateSnapshot
from tests.factories import add_member, set_plan, signup

SECRET = "stale_static_dns_after_vpn_update"  # noqa: S105 - scenario root cause, not a credential
COMPLETED: list[dict[str, Any]] = []


@subscribe("simulation.completed")
async def _capture_completed(db, payload):  # noqa: ANN001
    COMPLETED.append(payload)


NOTES = (
    "Root cause: GlobalConnect VPN update left a stale static DNS server on the adapter. Fix: reset DNS to "
    "DHCP (automatic) and ipconfig /flushdns. Verified with nslookup; user confirmed."
)

# (kind, payload): kind = chat | term | act
OPTIMAL: list[tuple[str, Any]] = [
    ("act", {"action_id": "review_ticket"}),
    ("act", {"action_id": "acknowledge_ticket"}),
    ("chat", "Hi Priya, this is Sam from the IT service desk."),
    ("chat", "Is it ok if I connect remotely to your laptop with Quick Assist?"),
    ("chat", "What error message do you see when you open a website?"),
    ("chat", "When did this start?"),
    ("chat", "Does your phone or anyone else around you have the same problem?"),
    ("chat", "Have there been any recent changes or updates on the laptop?"),
    ("chat", "Are you on Wi-Fi or plugged in with a cable?"),
    ("term", "ipconfig /all"),
    ("term", "ping 10.20.30.1"),
    ("term", "ping 8.8.8.8"),
    ("term", "nslookup intranet.corp.local"),
    ("term", "nslookup intranet.corp.local 10.20.1.10"),
    ("act", {"action_id": "read_kb_vpn"}),
    ("act", {"action_id": "open_system_info"}),
    ("act", {"action_id": "record_diagnosis", "input": {"choice": "stale_static_dns"}}),
    ("term", "Set-DnsClientServerAddress -InterfaceAlias Wi-Fi -ResetServerAddresses"),
    ("term", "ipconfig /flushdns"),
    ("term", "nslookup intranet.corp.local"),
    ("chat", "Could you try opening the intranet now?"),
    ("chat", "The problem was an old DNS server setting left behind by the VPN update; I've reset it."),
    ("act", {"action_id": "write_resolution_notes", "input": {"text": NOTES}}),
    ("chat", "Is there anything else, or are you happy for me to close the ticket?"),
    ("act", {"action_id": "close_ticket"}),
]


class Player:
    """Drives a session over HTTP, collecting every response body for leak scanning."""

    def __init__(self, client, headers: dict[str, str], session_id: str, next_seq: int = 1) -> None:
        self.client, self.headers, self.sid, self.seq = client, headers, session_id, next_seq
        self.bodies: list[str] = []

    async def do(self, kind: str, payload: Any, *, expect: int = 200) -> dict[str, Any]:
        base = f"/api/v1/simulation-sessions/{self.sid}"
        if kind == "chat":
            r = await self.client.post(
                f"{base}/chat",
                headers=self.headers,
                json={"character_id": "priya", "message": payload, "client_seq": self.seq},
            )
        elif kind == "term":
            r = await self.client.post(
                f"{base}/actions",
                headers=self.headers,
                json={"tool": "terminal", "input": {"text": payload}, "client_seq": self.seq},
            )
        else:
            r = await self.client.post(
                f"{base}/actions", headers=self.headers, json={**payload, "client_seq": self.seq}
            )
        assert r.status_code == expect, r.text
        self.bodies.append(r.text)
        body = r.json()
        if r.status_code == 200 and body["accepted"]:
            self.seq += 1
        return body

    async def run(self, steps: list[tuple[str, Any]]) -> dict[str, Any]:
        body: dict[str, Any] = {}
        for kind, payload in steps:
            body = await self.do(kind, payload)
            assert body["accepted"], body
        return body


async def org_with_learner(client, plan: str = "business"):
    admin = await signup(client, org_name=f"Sim Org {uuid.uuid4().hex[:6]}")
    await set_plan(admin.org_id, plan)
    learner = await add_member(admin.org_id, "learner")
    return admin, learner


async def published_helpdesk(client, admin, **patch: Any) -> str:
    r = await client.post(
        "/api/v1/simulations/from-template",
        headers=admin.headers,
        json={"template_key": "it-helpdesk-network"},
    )
    assert r.status_code == 201, r.text
    sim = r.json()
    assert sim["status"] == "draft" and sim["draft_version"] == 1 and sim["published_version"] is None
    if patch:
        r = await client.patch(f"/api/v1/simulations/{sim['id']}", headers=admin.headers, json=patch)
        assert r.status_code == 200, r.text
    r = await client.post(f"/api/v1/simulations/{sim['id']}/publish", headers=admin.headers)
    assert r.status_code == 200, r.text
    assert r.json()["simulation"]["status"] == "published" and r.json()["published"]["version"] == 1
    return sim["id"]


async def start(client, account, sim_id: str, expect: int = 201, **body: Any) -> dict[str, Any]:
    r = await client.post(
        f"/api/v1/simulations/{sim_id}/sessions", headers=account.headers, json=body or None
    )
    assert r.status_code == expect, r.text
    return r.json()


def assert_no_secrets(*texts: str) -> None:
    for t in texts:
        assert SECRET not in t
        assert "root_cause" not in t
        assert "stale static dns after vpn update" not in t.lower()


# ============================================================================================ authoring


async def test_templates_listing_and_permissions(client):
    admin, learner = await org_with_learner(client)
    r = await client.get("/api/v1/simulations/templates", headers=admin.headers)
    assert r.status_code == 200
    keys = {t["key"] for t in r.json()}
    assert keys == {"it-helpdesk-network", "phishing-email-investigation", "restaurant-food-safety-complaint"}
    assert SECRET not in r.text
    assert (await client.get("/api/v1/simulations/templates", headers=learner.headers)).status_code == 403
    r = await client.post("/api/v1/simulations", headers=learner.headers, json={"title": "x"})
    assert r.status_code == 403


async def test_plan_feature_gating(client):
    admin = await signup(client)  # free plan: no simulations feature
    r = await client.post(
        "/api/v1/simulations/from-template",
        headers=admin.headers,
        json={"template_key": "it-helpdesk-network"},
    )
    assert r.status_code == 402 and r.json()["error"]["details"]["feature"] == "simulations"


async def test_plan_limit_on_create(client):
    admin = await signup(client)
    await set_plan(admin.org_id, "individual")  # max_simulations = 5
    for _ in range(5):
        r = await client.post("/api/v1/simulations", headers=admin.headers, json={"title": "Sim"})
        assert r.status_code == 201, r.text
    r = await client.post("/api/v1/simulations", headers=admin.headers, json={"title": "Sim 6"})
    assert r.status_code == 402 and r.json()["error"]["details"]["resource"] == "max_simulations"


async def test_crud_draft_validation_publish_and_versions(client):
    admin, learner = await org_with_learner(client)
    r = await client.post(
        "/api/v1/simulations",
        headers=admin.headers,
        json={
            "title": "Printer jam triage",
            "industry": "it",
            "difficulty": "beginner",
            "max_attempts": 3,
            "skill_ids": [str(uuid.uuid4())],
        },
    )
    assert r.status_code == 201, r.text
    sim = r.json()
    sid = sim["id"]
    assert (
        sim["title"] == "Printer jam triage" and sim["difficulty"] == "beginner" and sim["max_attempts"] == 3
    )
    # learners can't see drafts
    assert (await client.get(f"/api/v1/simulations/{sid}", headers=learner.headers)).status_code == 404
    listing = (await client.get("/api/v1/simulations", headers=learner.headers)).json()
    assert all(x["id"] != sid for x in listing["items"])

    draft = (await client.get(f"/api/v1/simulations/{sid}/draft", headers=admin.headers)).json()
    assert draft["version"] == 1 and draft["validation"]["valid"]
    definition = draft["definition"]
    definition["scoring"]["dimensions"][0]["weight"] = 10
    r = await client.put(
        f"/api/v1/simulations/{sid}/draft", headers=admin.headers, json={"definition": definition}
    )
    assert r.status_code == 200 and not r.json()["validation"]["valid"]
    assert any(e["code"] == "weights" for e in r.json()["validation"]["errors"])
    r = await client.post(f"/api/v1/simulations/{sid}/publish", headers=admin.headers)
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_failed"
    r = await client.put(
        f"/api/v1/simulations/{sid}/draft",
        headers=admin.headers,
        json={"definition": {"meta": {"title": "broken"}}},
    )
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_definition"
    r = await client.post(
        f"/api/v1/simulations/{sid}/validate",
        headers=admin.headers,
        json={"definition": {"meta": {"title": "x"}}},
    )
    assert r.status_code == 200 and not r.json()["valid"]
    definition["scoring"]["dimensions"][0]["weight"] = 35
    r = await client.put(
        f"/api/v1/simulations/{sid}/draft", headers=admin.headers, json={"definition": definition}
    )
    assert r.json()["validation"]["valid"]
    assert (await client.post(f"/api/v1/simulations/{sid}/validate", headers=admin.headers)).json()["valid"]

    assert (await client.post(f"/api/v1/simulations/{sid}/publish", headers=admin.headers)).status_code == 200
    r = await client.post(f"/api/v1/simulations/{sid}/publish", headers=admin.headers)
    assert r.status_code == 200 and r.json()["published"]["version"] == 2
    versions = (await client.get(f"/api/v1/simulations/{sid}/versions", headers=admin.headers)).json()
    assert [(v["version"], v["status"]) for v in versions] == [
        (3, "draft"),
        (2, "published"),
        (1, "superseded"),
    ]
    v1 = (await client.get(f"/api/v1/simulations/{sid}/versions/1", headers=admin.headers)).json()
    assert v1["definition"]["meta"]["title"] == "Printer jam triage"
    assert (
        await client.get(f"/api/v1/simulations/{sid}/versions/99", headers=admin.headers)
    ).status_code == 404
    out = (await client.get(f"/api/v1/simulations/{sid}", headers=admin.headers)).json()
    assert out["published_version"] == 2 and out["draft_version"] == 3
    r = await client.patch(
        f"/api/v1/simulations/{sid}",
        headers=admin.headers,
        json={"title": "Renamed", "is_graded": False, "course_id": str(uuid.uuid4())},
    )
    assert r.status_code == 400 and r.json()["error"]["code"] == "invalid_course"
    r = await client.patch(
        f"/api/v1/simulations/{sid}", headers=admin.headers, json={"title": "Renamed", "skill_ids": []}
    )
    assert r.json()["title"] == "Renamed"
    assert (await client.get(f"/api/v1/simulations/{sid}", headers=learner.headers)).status_code == 200
    listing = (await client.get("/api/v1/simulations?search=Renamed", headers=admin.headers)).json()
    assert [x["id"] for x in listing["items"]] == [sid]
    assert (await client.delete(f"/api/v1/simulations/{sid}", headers=admin.headers)).status_code == 204
    assert (await client.get(f"/api/v1/simulations/{sid}", headers=admin.headers)).status_code == 404


async def test_create_with_definition_and_unknown_template(client):
    admin, _ = await org_with_learner(client)
    r = await client.post("/api/v1/simulations", headers=admin.headers, json={"template_key": "nope"})
    assert r.status_code == 404
    r = await client.post("/api/v1/simulations", headers=admin.headers, json={})
    assert r.status_code == 400
    r = await client.get("/api/v1/simulations/templates", headers=admin.headers)
    tpl = r.json()[1]["key"]
    r = await client.post(
        "/api/v1/simulations", headers=admin.headers, json={"template_key": tpl, "title": "Mine"}
    )
    assert r.status_code == 201 and r.json()["title"] == "Mine"
    draft = (await client.get(f"/api/v1/simulations/{r.json()['id']}/draft", headers=admin.headers)).json()
    r = await client.post(
        "/api/v1/simulations", headers=admin.headers, json={"definition": draft["definition"]}
    )
    assert r.status_code == 201 and r.json()["industry"] == "cybersecurity"
    r = await client.post("/api/v1/simulations", headers=admin.headers, json={"definition": {"meta": {}}})
    assert r.status_code == 422


async def test_builder_graph_round_trip(client):
    admin, _ = await org_with_learner(client)
    r = await client.post(
        "/api/v1/simulations/from-template",
        headers=admin.headers,
        json={"template_key": "restaurant-food-safety-complaint"},
    )
    sid = r.json()["id"]
    g = (await client.get(f"/api/v1/simulations/{sid}/graph", headers=admin.headers)).json()
    assert g["validation"]["valid"]
    graph = g["graph"]
    assert {n["type"] for n in graph["nodes"]} == {"phase", "action", "branch", "event"}
    node = next(n for n in graph["nodes"] if n["id"] == "phase:INITIAL")
    node["position"] = {"x": 1234, "y": 56}
    graph["edges"].append(
        {"id": "c-new", "source": "phase:RESOLVE", "target": "action:notify_supervisor", "type": "contains"}
    )
    r = await client.put(f"/api/v1/simulations/{sid}/graph", headers=admin.headers, json={"graph": graph})
    assert r.status_code == 200, r.text
    assert r.json()["validation"]["valid"]
    draft = (await client.get(f"/api/v1/simulations/{sid}/draft", headers=admin.headers)).json()
    notify = next(a for a in draft["definition"]["actions"] if a["id"] == "notify_supervisor")
    assert notify["phases"] == ["RESOLVE"]
    g2 = (await client.get(f"/api/v1/simulations/{sid}/graph", headers=admin.headers)).json()
    assert next(n for n in g2["graph"]["nodes"] if n["id"] == "phase:INITIAL")["position"] == {
        "x": 1234,
        "y": 56,
    }
    r = await client.put(
        f"/api/v1/simulations/{sid}/graph",
        headers=admin.headers,
        json={"graph": {"nodes": [{"id": "phase:X", "type": "phase", "data": {"name": 5}}]}},
    )
    assert r.status_code == 422


async def test_ai_builder_fallback_creates_valid_draft(client):
    admin, learner = await org_with_learner(client)
    r = await client.post(
        "/api/v1/simulations/ai-build",
        headers=admin.headers,
        json={
            "description": "Create a Level 2 IT helpdesk simulation where the learner must diagnose "
            "a DNS problem"
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["source"] == "fallback" and body["validation"]["valid"]
    sim = body["simulation"]
    assert sim["status"] == "draft" and sim["ai_generated"] and sim["title"] == "Diagnose a DNS problem"
    draft = (await client.get(f"/api/v1/simulations/{sim['id']}/draft", headers=admin.headers)).json()
    assert draft["definition"]["meta"]["learner_role"] == "Level 2 Service Desk Analyst"
    assert "ai_draft" in draft["definition"]["meta"]["tags"]
    # learners never see unpublished AI drafts
    assert (await client.get(f"/api/v1/simulations/{sim['id']}", headers=learner.headers)).status_code == 404
    # generic domain → fault-diagnosis skeleton, still valid and publishable after review
    r = await client.post(
        "/api/v1/simulations/ai-build",
        headers=admin.headers,
        json={
            "description": "A ward nurse must handle a medication dosage error reported by a patient",
            "industry": "healthcare",
            "difficulty": "advanced",
            "title": "Medication error",
        },
    )
    assert r.status_code == 201 and r.json()["validation"]["valid"]
    sid = r.json()["simulation"]["id"]
    assert r.json()["simulation"]["title"] == "Medication error"
    assert (await client.post(f"/api/v1/simulations/{sid}/publish", headers=admin.headers)).status_code == 200
    assert (
        await client.post(
            "/api/v1/simulations/ai-build",
            headers=learner.headers,
            json={"description": "something long enough"},
        )
    ).status_code == 403


async def test_ai_builder_repairs_ai_output(client, monkeypatch):
    from app.modules.ai import gateway

    async def fake_generate_json(db, **kw):  # noqa: ANN001
        return {
            "meta": {"title": "AI sim"},
            "junk": 1,
            "tools": [{"id": "t", "name": "T"}],
            "actions": [
                {
                    "id": "a",
                    "tool": "t",
                    "label": "Do it",
                    "classification": "correct",
                    "score": {"skill": 5},
                    "effects": [{"complete": "success"}],
                },
                {"id": "b", "tool": "missing"},
            ],
            "scoring": {"dimensions": [{"id": "skill", "name": "Skill", "weight": 50, "max_points": 5}]},
        }

    monkeypatch.setattr(gateway, "generate_json", fake_generate_json)
    admin, _ = await org_with_learner(client)
    r = await client.post(
        "/api/v1/simulations/ai-build",
        headers=admin.headers,
        json={"description": "Generate anything for testing purposes"},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["source"] == "ai" and body["validation"]["valid"], body
    assert any("unknown tool" in n for n in body["repairs"])

    async def broken(db, **kw):  # noqa: ANN001
        return {
            "meta": {"title": "x"},
            "scoring": {"dimensions": [{"id": "a", "weight": 100}]},
            "phases": [{"id": "A", "name": "A"}, {"id": "B", "name": "B"}],
            "initial_phase": "A",
        }

    monkeypatch.setattr(gateway, "generate_json", broken)
    r = await client.post(
        "/api/v1/simulations/ai-build",
        headers=admin.headers,
        json={"description": "Investigate a phishing email reported by staff"},
    )
    assert r.status_code == 201 and r.json()["source"] == "fallback" and r.json()["validation"]["valid"]


# ============================================================================================ playing


async def test_optimal_play_through_scores_expert_and_emits_event(client, db):
    admin, learner = await org_with_learner(client)
    sim_id = await published_helpdesk(client, admin)
    session = await start(client, learner, sim_id)
    assert session["status"] == "active" and session["attempt_number"] == 1 and session["is_graded"]
    view = session["view"]
    assert view["phase"]["id"] == "INITIAL" and view["revealed_facts"] == []
    assert {t["id"] for t in view["tools"]} >= {"terminal", "chat", "ticket"}
    assert set(view["variables"]) == {"ticket_status", "customer_patience"}
    player = Player(client, learner.headers, session["id"])
    player.bodies.append(json.dumps(session))
    COMPLETED.clear()
    final = await player.run(OPTIMAL)
    assert final["ended"] and final["status"] == "completed"
    result = final["result"]
    assert result["band"] == "Expert" and result["passed"] and result["total_score"] >= 95
    # graded run: per-action grading is hidden from the learner
    assert all("classification" not in json.loads(b).get("outcome", {}) for b in player.bodies[1:])
    assert_no_secrets(*player.bodies)
    for path in ("", "/result", "/replay"):
        r = await client.get(f"/api/v1/simulation-sessions/{session['id']}{path}", headers=learner.headers)
        assert r.status_code == 200, r.text
        assert_no_secrets(r.text)
    r = await client.get(f"/api/v1/simulation-sessions/{session['id']}/result", headers=learner.headers)
    res = r.json()
    assert res["band"] == "Expert" and res["end_reason"] == "success" and res["narrative"]
    assert len(res["dimensions"]) == 5 and res["feedback"]["strengths"]
    payload = next(p for p in COMPLETED if str(p["session_id"]) == session["id"])
    assert set(payload) == {
        "session_id",
        "simulation_id",
        "course_id",
        "total_score",
        "band",
        "passed",
        "organisation_id",
        "user_id",
    }
    assert payload["passed"] is True and payload["band"] == "Expert" and payload["user_id"] == learner.user_id
    assert payload["organisation_id"] == admin.org_id and payload["course_id"] is None
    # persisted log + snapshots
    sid = uuid.UUID(session["id"])
    actions = (
        (await db.execute(select(SimulationAction).where(SimulationAction.session_id == sid))).scalars().all()
    )
    assert len(actions) == len(OPTIMAL)
    snaps = (
        (await db.execute(select(SimulationStateSnapshot).where(SimulationStateSnapshot.session_id == sid)))
        .scalars()
        .all()
    )
    assert {s.reason for s in snaps} >= {"start", "phase_change", "end"}
    # a perfect run in seconds is flagged for human review (never penalised)
    signals = (
        (await db.execute(select(IntegritySignal).where(IntegritySignal.target_id == sid))).scalars().all()
    )
    assert [s.signal_type for s in signals] == ["timing"]
    # finished sessions reject further actions; finishing again is idempotent
    r = await client.post(
        f"/api/v1/simulation-sessions/{session['id']}/actions",
        headers=learner.headers,
        json={"action_id": "review_ticket", "client_seq": len(OPTIMAL) + 1},
    )
    assert r.status_code == 409
    r = await client.post(f"/api/v1/simulation-sessions/{session['id']}/finish", headers=learner.headers)
    assert r.status_code == 200 and r.json()["band"] == "Expert"


async def test_wrong_path_consequences_in_practice_mode(client):
    admin, learner = await org_with_learner(client)
    sim_id = await published_helpdesk(client, admin, is_graded=False)
    session = await start(client, learner, sim_id)
    assert session["show_feedback"]
    p = Player(client, learner.headers, session["id"])
    out = await p.do("act", {"action_id": "open_system_info"})
    assert any(x["id"] == "system_info" for x in out["view"]["panels"])
    out = await p.do("act", {"action_id": "reinstall_driver"})
    assert out["outcome"]["classification"] == "incorrect" and out["outcome"]["time_cost"] == 20
    assert out["outcome"]["feedback"] and out["outcome"]["score_deltas"]["decision_making"] < 0
    assert out["view"]["variables"]["customer_patience"] < 70
    out = await p.do("act", {"action_id": "reset_password"})
    assert "password" in out["outcome"]["messages"][0]["text"].lower()
    out = await p.do("term", "netsh int ip reset")
    assert out["outcome"]["classification"] == "incorrect"
    out = await p.do("term", "format c:")
    assert "not recognized" in out["outcome"]["outputs"][0]["text"]
    out = await p.do("chat", "banana spaceship")
    assert out["outcome"]["matched"] == "unknown" and "not very technical" in out["reply"]["text"]
    out = await p.do("act", {"action_id": "close_ticket"})
    assert out["ended"] and out["outcome"]["classification"] == "critical"
    result = out["result"]
    assert result["band"] == "Fail" and not result["passed"] and result["critical_failure"]
    assert result["feedback"]["critical_actions"][0]["action_id"] == "close_ticket"
    assert {i["id"] for i in result["feedback"]["improvements"]} >= {"i_driver", "i_password", "i_netsh"}
    assert_no_secrets(*p.bodies)


async def test_chat_reveals_facts_only_when_asked_and_rejections(client):
    admin, learner = await org_with_learner(client)
    sim_id = await published_helpdesk(client, admin)
    session = await start(client, learner, sim_id)
    p = Player(client, learner.headers, session["id"])
    out = await p.do("chat", "Did you ever get it working? I explained the DNS server issue")
    assert not out["accepted"] and out["outcome"]["reason"] == "precondition_failed"
    assert "not very technical" in out["reply"]["text"]
    assert out["view"]["revealed_facts"] == [] and out["next_seq"] == 1
    out = await p.do("chat", "What error message do you see?")
    assert out["accepted"] and [f["id"] for f in out["outcome"]["revealed_facts"]] == ["f_error"]
    assert out["reply"]["from"] == "priya" and "DNS_PROBE_FINISHED_NXDOMAIN" in out["reply"]["text"]
    assert not out["reply"]["ai_phrased"]
    assert [f["id"] for f in out["view"]["revealed_facts"]] == ["f_error"]
    out = await p.do("chat", "Is it a password problem, are you locked out?")
    assert out["outcome"]["matched"] == "fact"
    assert {f["id"] for f in out["view"]["revealed_facts"]} == {"f_error", "f_password"}
    r = await client.post(
        f"/api/v1/simulation-sessions/{session['id']}/actions",
        headers=learner.headers,
        json={"action_id": "record_diagnosis", "input": {"choice": "bogus"}, "client_seq": p.seq},
    )
    assert r.status_code == 400
    r = await client.post(
        f"/api/v1/simulation-sessions/{session['id']}/actions",
        headers=learner.headers,
        json={"action_id": "nope", "client_seq": p.seq},
    )
    assert r.status_code == 400
    r = await client.post(
        f"/api/v1/simulation-sessions/{session['id']}/actions",
        headers=learner.headers,
        json={"client_seq": p.seq},
    )
    assert r.status_code == 400
    r = await client.post(
        f"/api/v1/simulation-sessions/{session['id']}/chat",
        headers=learner.headers,
        json={"character_id": "nobody", "message": "hi"},
    )
    assert r.status_code == 400
    assert_no_secrets(*p.bodies)


async def test_idempotent_actions_and_sequence_conflicts(client):
    admin, learner = await org_with_learner(client)
    sim_id = await published_helpdesk(client, admin)
    session = await start(client, learner, sim_id)
    url = f"/api/v1/simulation-sessions/{session['id']}/actions"
    body = {"tool": "terminal", "input": {"text": "ipconfig /all"}, "client_seq": 1}
    first = await client.post(url, headers=learner.headers, json=body)
    again = await client.post(url, headers=learner.headers, json=body)
    assert first.status_code == again.status_code == 200
    assert again.json()["replayed"] and again.json()["outcome"] == first.json()["outcome"]
    assert again.json()["next_seq"] == 2
    # a stale tab re-using a processed seq for a *different* action must not get the old outcome
    stale = await client.post(url, headers=learner.headers, json={**body, "input": {"text": "ping 8.8.8.8"}})
    assert stale.status_code == 409 and stale.json()["error"]["code"] == "sequence_conflict"
    assert stale.json()["error"]["details"]["expected"] == 2
    stale_chat = await client.post(
        f"/api/v1/simulation-sessions/{session['id']}/chat",
        headers=learner.headers,
        json={"character_id": "priya", "message": "Hi", "client_seq": 1},
    )
    assert stale_chat.status_code == 409 and stale_chat.json()["error"]["code"] == "sequence_conflict"
    r = await client.post(url, headers=learner.headers, json={**body, "client_seq": 5})
    assert r.status_code == 409 and r.json()["error"]["details"]["expected"] == 2
    chat = await client.post(
        f"/api/v1/simulation-sessions/{session['id']}/chat",
        headers=learner.headers,
        json={"character_id": "priya", "message": "When did it start?"},
    )
    assert chat.status_code == 200 and chat.json()["seq"] == 2
    view = (await client.get(f"/api/v1/simulation-sessions/{session['id']}", headers=learner.headers)).json()
    assert view["action_count"] == 2 and view["next_seq"] == 3


async def test_attempt_limits_resume_and_abandon(client):
    admin, learner = await org_with_learner(client)
    sim_id = await published_helpdesk(client, admin, max_attempts=1)
    s1 = await start(client, learner, sim_id)
    s1b = await start(client, learner, sim_id)
    assert s1b["id"] == s1["id"] and s1b["resumed"]
    r = await client.get(f"/api/v1/simulation-sessions/{s1['id']}/result", headers=learner.headers)
    assert r.status_code == 409
    r = await client.get(f"/api/v1/simulation-sessions/{s1['id']}/replay", headers=learner.headers)
    assert r.status_code == 409  # learners replay only finished sessions
    r = await client.get(f"/api/v1/simulation-sessions/{s1['id']}/replay", headers=admin.headers)
    assert r.status_code == 200 and SECRET in r.text  # staff see the full state history
    r = await client.post(f"/api/v1/simulation-sessions/{s1['id']}/abandon", headers=learner.headers)
    assert (
        r.status_code == 200 and r.json()["status"] == "abandoned" and r.json()["result"]["passed"] is False
    )
    assert (
        await client.post(f"/api/v1/simulation-sessions/{s1['id']}/abandon", headers=learner.headers)
    ).status_code == 409
    r = await client.post(f"/api/v1/simulations/{sim_id}/sessions", headers=learner.headers)
    assert r.status_code == 409 and r.json()["error"]["code"] == "attempt_limit"
    mine = (await client.get("/api/v1/simulation-sessions", headers=learner.headers)).json()
    assert mine["total"] == 1 and mine["items"][0]["status"] == "abandoned"
    r = await client.get(f"/api/v1/simulations/{sim_id}/sessions", headers=admin.headers)
    assert r.status_code == 200 and r.json()["total"] == 1
    assert (
        await client.get(f"/api/v1/simulations/{sim_id}/sessions", headers=learner.headers)
    ).status_code == 403


async def test_unpublished_and_expired_sessions(client, db):
    admin, learner = await org_with_learner(client)
    r = await client.post(
        "/api/v1/simulations/from-template",
        headers=admin.headers,
        json={"template_key": "phishing-email-investigation"},
    )
    sim_id = r.json()["id"]
    await start(client, learner, sim_id, expect=404)
    await start(client, admin, sim_id, expect=409)
    await client.post(f"/api/v1/simulations/{sim_id}/publish", headers=admin.headers)
    staff_session = await start(client, admin, sim_id, seed=7)
    assert staff_session["view"]["meta"]["title"] == "Phishing Email Investigation"
    session = await start(client, learner, sim_id)
    sid = uuid.UUID(session["id"])
    row = await db.get(SimulationSession, sid)
    row.last_activity_at = datetime.now(UTC) - timedelta(days=2)
    await db.commit()
    r = await client.post(
        f"/api/v1/simulation-sessions/{sid}/actions",
        headers=learner.headers,
        json={"action_id": "open_report", "client_seq": 1},
    )
    assert r.status_code == 200 and not r.json()["accepted"]
    assert r.json()["outcome"]["reason"] == "session_expired" and r.json()["status"] == "expired"
    view = (await client.get(f"/api/v1/simulation-sessions/{sid}", headers=learner.headers)).json()
    assert view["status"] == "expired" and view["result"]["passed"] is False
    r = await client.post(f"/api/v1/simulation-sessions/{sid}/finish", headers=learner.headers)
    assert r.status_code == 200 and r.json()["status"] == "expired"


async def test_learner_briefing_before_start(client):
    admin, learner = await org_with_learner(client)
    sim_id = await published_helpdesk(client, admin)
    r = await client.get(f"/api/v1/simulations/{sim_id}/briefing", headers=learner.headers)
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["version"] == 1 and b["title"] == "Corporate Laptop Cannot Connect to Network"
    assert b["learner_role"] == "Level 2 Service Desk Analyst" and "INC0042317" in b["briefing"]
    assert len(b["objectives"]) == 5
    assert [d["id"] for d in b["dimensions"]][0] == "technical_accuracy"
    assert sum(d["weight"] for d in b["dimensions"]) == 100
    assert b["phases"] == ["Initial", "Investigation", "Diagnosis", "Remediation", "Validation", "Resolution"]
    assert b["pass_mark"] == 70 and b["target_minutes"] == 30 and b["bands"][0]["name"] == "Expert"
    assert {"name": "Priya Shah", "role": "Finance Analyst"} in b["characters"]
    assert any(t["name"] == "Remote PowerShell" for t in b["tools"])
    assert_no_secrets(r.text)
    for hidden in ("actions", "facts", "variables", "persona", "10.0.0.53"):
        assert hidden not in r.text
    # Drafts (never published) have no learner briefing.
    r = await client.post(
        "/api/v1/simulations/from-template",
        headers=admin.headers,
        json={"template_key": "phishing-email-investigation"},
    )
    draft_id = r.json()["id"]
    r = await client.get(f"/api/v1/simulations/{draft_id}/briefing", headers=learner.headers)
    assert r.status_code == 404
    r = await client.get(f"/api/v1/simulations/{draft_id}/briefing", headers=admin.headers)
    assert r.status_code == 404


async def test_finish_early_scores_partial_run(client):
    admin, learner = await org_with_learner(client)
    sim_id = await published_helpdesk(client, admin)
    session = await start(client, learner, sim_id)
    p = Player(client, learner.headers, session["id"])
    await p.run(OPTIMAL[:6])
    r = await client.post(f"/api/v1/simulation-sessions/{session['id']}/finish", headers=learner.headers)
    assert r.status_code == 200
    res = r.json()
    assert res["status"] == "completed" and res["end_reason"] == "incomplete" and not res["passed"]
    assert any(m["id"] == "m_fix" for m in res["feedback"]["missed_steps"])


async def test_cross_tenant_and_cross_user_isolation(client):
    admin, learner = await org_with_learner(client)
    sim_id = await published_helpdesk(client, admin)
    session = await start(client, learner, sim_id)
    other_admin, other_learner = await org_with_learner(client)
    for acct in (other_admin, other_learner):
        assert (await client.get(f"/api/v1/simulations/{sim_id}", headers=acct.headers)).status_code == 404
        assert (
            await client.get(f"/api/v1/simulation-sessions/{session['id']}", headers=acct.headers)
        ).status_code == 404
        assert (
            await client.post(f"/api/v1/simulations/{sim_id}/sessions", headers=acct.headers)
        ).status_code == 404
    assert (
        await client.get(f"/api/v1/simulations/{sim_id}/draft", headers=other_admin.headers)
    ).status_code == 404
    assert (
        await client.get(f"/api/v1/simulations/{sim_id}/analytics", headers=other_admin.headers)
    ).status_code == 404
    r = await client.post(
        f"/api/v1/simulation-sessions/{session['id']}/actions",
        headers=other_admin.headers,
        json={"action_id": "review_ticket", "client_seq": 1},
    )
    assert r.status_code == 404
    # another learner in the same org can't see or drive the session; staff can view but not act
    peer = await add_member(admin.org_id, "learner")
    assert (
        await client.get(f"/api/v1/simulation-sessions/{session['id']}", headers=peer.headers)
    ).status_code == 404
    assert (
        await client.get(f"/api/v1/simulation-sessions/{session['id']}", headers=admin.headers)
    ).status_code == 200
    r = await client.post(
        f"/api/v1/simulation-sessions/{session['id']}/actions",
        headers=admin.headers,
        json={"action_id": "review_ticket", "client_seq": 1},
    )
    assert r.status_code == 404


async def test_analytics_and_identical_sequence_signal(client, db):
    admin, learner = await org_with_learner(client)
    sim_id = await published_helpdesk(client, admin)
    learner2 = await add_member(admin.org_id, "learner")
    sessions = []
    for acct in (learner, learner2):
        session = await start(client, acct, sim_id)
        await Player(client, acct.headers, session["id"]).run(OPTIMAL)
        sessions.append(session["id"])
    bad = await start(client, await add_member(admin.org_id, "learner"), sim_id)
    signals = (
        (await db.execute(select(IntegritySignal).where(IntegritySignal.target_id == uuid.UUID(sessions[1]))))
        .scalars()
        .all()
    )
    kinds = {s.signal_type for s in signals}
    assert "identical_sequence" in kinds
    ident = next(s for s in signals if s.signal_type == "identical_sequence")
    assert ident.details["matching_session_ids"] == [sessions[0]]
    third = await add_member(admin.org_id, "learner")
    s3 = await start(client, third, sim_id)
    await Player(client, third.headers, s3["id"]).run([("act", {"action_id": "close_ticket"})])
    r = await client.get(f"/api/v1/simulations/{sim_id}/analytics", headers=admin.headers)
    assert r.status_code == 200, r.text
    a = r.json()
    assert a["attempts"] == 4 and a["completed"] == 3 and a["active"] == 1 and a["learners"] == 4
    assert a["completion_rate"] == 0.75 and a["pass_rate"] == pytest.approx(0.667, abs=0.001)
    assert a["band_distribution"] == {"Expert": 2, "Fail": 1}
    assert a["common_mistakes"][0]["action_id"] == "close_ticket"
    assert a["common_mistakes"][0]["classification"] == "critical"
    assert a["common_mistakes"][0]["label"] == "Resolve & close ticket"
    assert {d["id"] for d in a["dimensions"]} == {
        "technical_accuracy",
        "troubleshooting_process",
        "communication",
        "decision_making",
        "efficiency",
    }
    assert a["phase_reach"]["INITIAL"] == 4 and a["phase_dropoff"] == {"INVESTIGATION": 1}
    assert a["score"]["median"] is not None
    assert bad["status"] == "active"
    assert (
        await client.get(f"/api/v1/simulations/{sim_id}/analytics", headers=learner.headers)
    ).status_code == 403


async def test_character_ai_voice_is_screened(client, monkeypatch, db):
    from app.modules.ai import gateway

    calls: list[dict[str, Any]] = []

    class FakeResult:
        offline = False

        def __init__(self, text: str) -> None:
            self.text = text

    replies = iter(
        [
            "Oh, Chrome keeps saying it can't reach anything, the NXDOMAIN thing. Outlook's disconnected.",
            f"Honestly I bet it's the {SECRET}!",
        ]
    )

    async def fake_generate_text(db, **kw):  # noqa: ANN001
        calls.append(kw)
        if kw["feature"] == "simulation":
            return FakeResult("Great job overall!")
        return FakeResult(next(replies))

    monkeypatch.setattr(gateway, "generate_text", fake_generate_text)
    admin, learner = await org_with_learner(client)
    sim_id = await published_helpdesk(client, admin)
    session = await start(client, learner, sim_id)
    p = Player(client, learner.headers, session["id"])
    out = await p.do("chat", "What error message do you see?")
    assert out["reply"]["ai_phrased"] and "NXDOMAIN" in out["reply"]["text"]
    system = calls[0]["system"]
    assert "Priya" in system and SECRET not in system
    assert "VPN update" not in system  # facts not yet revealed are never sent to the model
    view = out["view"]
    assert view["transcript"][-1]["text"] == out["reply"]["text"]
    out = await p.do("chat", "When did this start?")
    assert not out["reply"]["ai_phrased"] and SECRET not in out["reply"]["text"]  # leak rejected
    assert "VPN" in out["reply"]["text"]
    rows = (
        (
            await db.execute(
                select(SimulationAction)
                .where(SimulationAction.session_id == uuid.UUID(session["id"]))
                .order_by(SimulationAction.seq)
            )
        )
        .scalars()
        .all()
    )
    assert rows[0].ai_generated_reply and rows[1].ai_generated_reply is None


async def test_install_template_seed_helper(client, db):
    from app.modules.simulations.service import install_template

    admin, learner = await org_with_learner(client)
    sim = await install_template(db, admin.org_id, "restaurant-food-safety-complaint", admin.user_id)
    await db.commit()
    assert sim.status == "published" and sim.current_scenario_id is not None
    stored = await db.get(Simulation, sim.id)
    assert stored.industry == "hospitality"
    session = await start(client, learner, str(sim.id))
    assert session["view"]["characters"][0]["name"] == "Daniel Okafor"
