from __future__ import annotations

import pytest
from sim_paths import PHISHING_OPTIMAL, RESTAURANT_OPTIMAL, act, chat, play

from simulation_engine import (
    band_for,
    compute_scores,
    finish,
    from_graph,
    learner_view,
    list_templates,
    load_template,
    merge_positions,
    parse_definition,
    start,
    to_graph,
    validate,
)


@pytest.mark.parametrize("key", [t["key"] for t in list_templates()])
def test_graph_round_trip(key):
    d = load_template(key)
    g = to_graph(d)
    assert {n["type"] for n in g["nodes"]} >= {"phase", "action"}
    assert all({"id", "type", "position", "data"} <= set(n) for n in g["nodes"])
    assert all({"id", "source", "target", "type"} <= set(e) for e in g["edges"])
    assert len({e["id"] for e in g["edges"]}) == len(g["edges"])
    rebuilt = from_graph(g, d)
    assert parse_definition(rebuilt).model_dump() == parse_definition(d).model_dump()
    assert validate(rebuilt).valid


def test_graph_edits_change_definition():
    d = load_template("restaurant-food-safety-complaint")
    g = to_graph(d)
    edge_types = {e["type"] for e in g["edges"]}
    assert {"transition", "branch", "effect_transition"} <= edge_types
    # drop the auto-advance ASSESS → INVESTIGATE, add a plain transition back to INITIAL
    g["edges"] = [e for e in g["edges"] if e["id"] != "t:ASSESS->INVESTIGATE:auto:0"]
    g["edges"].append(
        {
            "id": "new",
            "source": "phase:ASSESS",
            "target": "phase:INITIAL",
            "type": "transition",
            "data": {"auto": False},
        }
    )
    # make an action available only in RESOLVE and send it to FOLLOW_UP
    g["edges"].append(
        {"id": "c-new", "source": "phase:RESOLVE", "target": "action:notify_supervisor", "type": "contains"}
    )
    g["edges"].append(
        {
            "id": "x-new",
            "source": "action:notify_supervisor",
            "target": "phase:FOLLOW_UP",
            "type": "effect_transition",
        }
    )
    # a brand-new action node created in the builder
    g["nodes"].append(
        {
            "id": "action:new_one",
            "type": "action",
            "position": {"x": 0, "y": 0},
            "data": {"tool": "office", "label": "Call the owner", "kind": "escalate"},
        }
    )
    # rebuild an event's after_action trigger from an edge
    g["nodes"].append(
        {
            "id": "event:owner_called",
            "type": "event",
            "position": {"x": 0, "y": 0},
            "data": {"title": "Owner arrives", "trigger": {"type": "time", "at_minutes": 99}},
        }
    )
    g["edges"].append(
        {
            "id": "trig",
            "source": "action:new_one",
            "target": "event:owner_called",
            "type": "triggers",
            "data": {"kind": "after_action"},
        }
    )
    out = from_graph(g, d)
    assess = next(p for p in out["phases"] if p["id"] == "ASSESS")
    assert assess["transitions"] == ["INITIAL"] and assess["auto_advance"] == []
    notify = next(a for a in out["actions"] if a["id"] == "notify_supervisor")
    assert notify["phases"] == ["RESOLVE"] and {"transition": "FOLLOW_UP"} in notify["effects"]
    assert any(a["id"] == "new_one" for a in out["actions"])
    ev = next(e for e in out["events"] if e["id"] == "owner_called")
    assert ev["trigger"] == {"type": "after_action", "at_minutes": 99, "action": "new_one"}
    assert validate(out).valid or all(e.code != "schema" for e in validate(out).errors)
    # removing a transition edge strips the effect while keeping other keys
    g2 = to_graph(d)
    g2["edges"] = [e for e in g2["edges"] if not e["id"].startswith("x:branch:close_case")]
    out2 = from_graph(g2, d)
    close = next(a for a in out2["actions"] if a["id"] == "close_case")
    assert all(not e.get("transition") for b in close["branches"] for e in b["effects"])
    assert any(e.get("complete") for b in close["branches"] for e in b["effects"])


def test_merge_positions():
    d = load_template("phishing-email-investigation")
    g = to_graph(d)
    saved = {"nodes": [{"id": "phase:INITIAL", "position": {"x": 999, "y": 1}}, "junk"]}
    merged = merge_positions(to_graph(d), saved)
    assert next(n for n in merged["nodes"] if n["id"] == "phase:INITIAL")["position"] == {"x": 999, "y": 1}
    assert merge_positions(g, None) is g


def test_phishing_optimal_and_false_positive():
    d = load_template("phishing-email-investigation")
    state, outcomes = play(d, PHISHING_OPTIMAL, seed=4)
    assert all(o["accepted"] for o in outcomes)
    result = finish(d, state)
    assert result["band"] == "Expert" and result["passed"], result["dimensions"]
    assert state["fired_events"] == {}
    bad, outs = play(d, [act("open_report"), act("classify", {"choice": "legitimate"})])
    assert outs[-1]["classification"] == "critical" and bad["end_reason"] == "failure"
    assert finish(d, bad)["band"] == "Fail"


def test_phishing_slow_response_lets_attacker_persist():
    d = load_template("phishing-email-investigation")
    state, outcomes = play(d, [act("query_siem")] * 8)
    assert state["fired_events"].get("attacker_persistence") == 1
    assert any(p["id"] == "forwarding_rule" for p in state["problems"])
    assert state["fired_events"].get("lead_chases") == 1
    r = learner_view(d, state)
    assert any(p["id"] == "forwarding_rule" for p in r["problems"])
    assert "credential_harvest_jnguyen_compromised" not in str(r)


def test_restaurant_optimal_and_poor_paths():
    d = load_template("restaurant-food-safety-complaint")
    state, outcomes = play(d, RESTAURANT_OPTIMAL, seed=2)
    assert all(o["accepted"] for o in outcomes), [(o["action_id"], o["reason"]) for o in outcomes]
    result = finish(d, state)
    assert result["band"] == "Expert" and result["passed"]
    poor, outs = play(
        d,
        [
            chat("Are you sure you told the server? Did you tell her?", "daniel"),
            act("voucher_only"),
            act("check_kitchen_log"),
            act("close_case"),
        ],
    )
    assert outs[0]["action_id"] == "blame_guest" and outs[1]["branch"] == "before_safety"
    assert poor["fired_events"].get("reaction_worsens") == 1
    res = finish(d, poor)
    assert res["band"] == "Fail" and res["critical_failure"]
    assert any(i["id"] == "i_blame" for i in res["feedback"]["improvements"])


def test_scoring_helpers():
    d = load_template("it-helpdesk-network")
    assert band_for(d, 100) == "Expert" and band_for(d, 94.9) == "Advanced" and band_for(d, 70) == "Competent"
    assert band_for(d, 50) == "Needs Improvement" and band_for(d, 0) == "Fail" and band_for(d, -5) == "Fail"
    s = start(d, 0)
    s.update(end_reason="success", minutes=55.0)
    s["phase_history"] = [
        {"phase": "INITIAL", "seq": 0, "minutes": 0},
        {"phase": "REMEDIATION", "seq": 1, "minutes": 1},
    ]
    scores = compute_scores(d, s)
    assert scores["efficiency_factor"] == 0.5
    assert scores["process"]["skipped"] == ["INVESTIGATION", "DIAGNOSIS"]
    s["minutes"] = 200
    assert compute_scores(d, s)["efficiency_factor"] == 0
    s.update(end_reason="incomplete", minutes=1)
    assert compute_scores(d, s)["efficiency_factor"] == 0
    res = finish(d, s)
    assert any(i["id"].startswith("process_skipped") for i in res["feedback"]["improvements"])
    assert any(t["id"].startswith("focus_") for t in res["feedback"]["tips"])


def test_minimal_definition_terminal_phase_completes():
    d = {
        "meta": {"title": "Mini"},
        "tools": [{"id": "t", "name": "T"}],
        "phases": [
            {
                "id": "A",
                "name": "A",
                "transitions": ["B"],
                "auto_advance": [{"to": "B", "when": {"var": "go"}}],
            },
            {"id": "B", "name": "B", "terminal": True},
        ],
        "initial_phase": "A",
        "variables": {"go": {"initial": False}, "n": {"initial": 5, "min": 0, "max": 10}},
        "characters": [
            {
                "id": "c",
                "name": "C",
                "facts": [{"id": "auto", "text": "Auto {{n}}", "auto_reveal": True, "when": {"var": "go"}}],
            }
        ],
        "actions": [
            {
                "id": "go",
                "tool": "t",
                "label": "Go",
                "classification": "correct",
                "effects": [
                    {
                        "set": {"go": True},
                        "inc": {"n": 50},
                        "add_problem": {"id": "p", "text": "Problem {{n}}"},
                    },
                    {"remove_problem": "p", "trigger_event": "ev"},
                ],
                "score": {"s": 5},
            },
            {
                "id": "spin",
                "tool": "t",
                "label": "Spin",
                "repeat": {"mode": "penalize", "penalty": {"s": -1}, "message": "Again?"},
            },
            {
                "id": "all",
                "tool": "t",
                "label": "All",
                "repeat": {"mode": "allow"},
                "score": {"s": 1},
                "time_cost": 0,
            },
        ],
        "events": [
            {
                "id": "ev",
                "trigger": {"type": "condition", "condition": False},
                "once": False,
                "max_fires": 2,
                "notify": "Event!",
                "classification": "critical",
                "time_cost": 1,
            }
        ],
        "variations": [{"id": "zero", "weight": 0, "set": {"n": 1}}],
        "opening_messages": [{"text": "Welcome"}, {"text": "hidden", "when": False}],
        "scoring": {
            "dimensions": [{"id": "s", "name": "S", "weight": 100, "max_points": 5}],
            "critical_cap": None,
        },
    }
    s = start(d, 0)
    assert [m["text"] for m in s["transcript"]] == ["Welcome"]
    assert s["variables"]["n"] == 1
    s, outs = play(d, [act("spin"), act("spin"), act("all"), act("all")], state=s)
    assert outs[1]["notices"] == ["Again?"] and outs[1]["score_deltas"] == {"s": -1.0}
    assert outs[3]["score_deltas"] == {"s": 1.0}
    s, outs = play(d, [act("go")], state=s)
    o = outs[0]
    assert o["problems_added"][0]["text"] == "Problem 10" and o["problems_removed"] == ["p"]
    assert s["variables"]["n"] == 10  # clamped to max
    assert o["events"][0]["id"] == "ev" and s["criticals"] == ["event:ev"]
    assert s["ended"] and s["end_reason"] == "success" and s["phase"] == "B"
    assert o["revealed_facts"][0]["text"] == "Auto 10"
    res = finish(d, s)
    assert res["critical_failure"] and res["feedback"]["critical_actions"][0]["action_id"] == "event:ev"
    assert res["total_score"] == 100 and not res["passed"]  # no cap configured, but criticals never pass
