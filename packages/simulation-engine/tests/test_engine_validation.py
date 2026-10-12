from __future__ import annotations

import copy

import pytest

from simulation_engine import list_templates, load_template, repair, validate
from simulation_engine.schema import SimulationDefinition


def codes(report):
    return {e.code for e in report.errors}


def minimal() -> dict:
    return {
        "meta": {"title": "Mini"},
        "tools": [{"id": "t", "name": "Tool", "panel": "p"}],
        "environment": {"panels": [{"id": "p", "type": "dashboard", "title": "P"}]},
        "phases": [
            {
                "id": "INITIAL",
                "name": "Start",
                "transitions": ["DONE"],
                "auto_advance": [{"to": "DONE", "when": {"var": "done"}}],
            },
            {"id": "DONE", "name": "Done", "terminal": True},
        ],
        "variables": {"done": {"type": "bool", "initial": False}},
        "actions": [
            {
                "id": "go",
                "tool": "t",
                "label": "Go",
                "classification": "correct",
                "effects": [{"set": {"done": True}}],
                "score": {"skill": 10},
            }
        ],
        "scoring": {"dimensions": [{"id": "skill", "name": "Skill", "weight": 100, "max_points": 10}]},
    }


@pytest.mark.parametrize("key", [t["key"] for t in list_templates()])
def test_templates_are_valid(key):
    report = validate(load_template(key))
    assert report.valid, report.as_dict()
    assert not report.warnings, report.as_dict()["warnings"]
    assert report.stats["actions"] > 5


def test_list_templates_shape():
    items = list_templates()
    assert {t["key"] for t in items} == {
        "it-helpdesk-network",
        "phishing-email-investigation",
        "restaurant-food-safety-complaint",
    }
    assert {t["industry"] for t in items} == {"it", "cybersecurity", "hospitality"}
    with pytest.raises(KeyError):
        load_template("nope")


def test_minimal_definition_valid_and_model_input():
    assert validate(minimal()).valid
    assert validate(SimulationDefinition.model_validate(minimal())).valid


def test_schema_errors_reported():
    report = validate({"meta": {}, "scoring": {"dimensions": []}, "bogus": 1})
    assert not report.valid and codes(report) == {"schema"}


def test_weights_must_sum_to_100():
    d = minimal()
    d["scoring"]["dimensions"][0]["weight"] = 90
    assert "weights" in codes(validate(d))


def test_unknown_references():
    d = minimal()
    d["actions"].append(
        {
            "id": "bad",
            "tool": "ghost",
            "label": "Bad",
            "kind": "ask",
            "character": "nobody",
            "phases": ["NOPE"],
            "preconditions": {"has_fact": "missing_fact"},
            "score": {"nodim": 1},
            "input": {"type": "free_text", "intents": ["no_intent"]},
            "effects": [
                {
                    "set": {"undeclared": 1},
                    "reveal": ["f9"],
                    "transition": "LIMBO",
                    "trigger_event": "e9",
                    "remove_problem": "p9",
                }
            ],
            "outputs": [{"text": "{{nothere}}", "panel": "nopanel"}],
            "messages": [{"character": "ghost", "text": "hi"}],
        }
    )
    d["events"] = [
        {"id": "e1", "trigger": {"type": "after_action", "action": "missing"}},
        {"id": "e2", "trigger": {"type": "time"}},
        {"id": "e3", "trigger": {"type": "condition"}},
    ]
    d["tools"].append({"id": "t2", "name": "T2", "panel": "missing_panel"})
    d["opening_messages"] = [{"character": "ghost", "text": "x"}]
    d["variations"] = [{"id": "v", "set": {"nope": 1}}]
    d["feedback_rules"] = [{"id": "f", "type": "tip", "text": "x", "when": {"bogus_op": 1}}]
    r = validate(d)
    messages = " ".join(e.message for e in r.errors)
    for needle in (
        "unknown tool 'ghost'",
        "unknown character 'nobody'",
        "Unknown phase 'NOPE'",
        "missing_fact",
        "Unknown scoring dimension 'nodim'",
        "undeclared variable 'undeclared'",
        "unknown fact 'f9'",
        "unknown phase 'LIMBO'",
        "unknown event 'e9'",
        "unknown variable 'nothere'",
        "Unknown panel",
        "Unknown character 'ghost'",
        "Unknown intent 'no_intent'",
        "unknown action 'missing'",
        "at_minutes",
        "needs a condition",
        "missing_panel",
        "unknown operator 'bogus_op'",
        "Variation sets undeclared variable",
    ):
        assert needle in messages, needle
    assert any("p9" in w.message for w in r.warnings)


def test_unreachable_phase_and_dead_end():
    d = minimal()
    d["phases"].append({"id": "ISLAND", "name": "Island"})
    d["phases"][0]["transitions"].append("STUCK")
    d["phases"].append({"id": "STUCK", "name": "Stuck"})
    d["completion"] = {"success": {"var": "done"}}
    r = validate(d)
    assert "unreachable_phase" in codes(r)
    assert any(w.code == "dead_end" for w in r.warnings)
    d["completion"] = {}
    assert "dead_end" in codes(validate(d))


def test_no_completion_and_bad_auto_advance():
    d = minimal()
    d["phases"][1]["terminal"] = False
    d["phases"][0]["auto_advance"][0]["to"] = "INITIAL"
    d["initial_phase"] = "MISSING"
    r = validate(d)
    assert {"no_completion", "transition", "unknown_ref"} <= codes(r)


def test_secret_leak_regex_and_action_shape():
    d = minimal()
    d["variables"]["answer"] = {"initial": "42", "visibility": "secret"}
    d["environment"]["panels"][0]["data"] = {"x": ["{{answer}}"]}
    d["environment"]["panels"][0]["variants"] = [{"when": True, "data": {"y": {"z": "{{answer}}"}}}]
    d["actions"] += [
        {
            "id": "c",
            "tool": "t",
            "label": "C",
            "kind": "command",
            "input": {"type": "command", "patterns": ["(bad"]},
        },
        {"id": "c2", "tool": "t", "label": "C2", "kind": "command", "input": {"type": "command"}},
        {
            "id": "c3",
            "tool": "t",
            "label": "C3",
            "kind": "command",
            "input": {"type": "command", "patterns": ["x" * 301]},
        },
        {
            "id": "s",
            "tool": "t",
            "label": "S",
            "kind": "select",
            "input": {
                "type": "choice",
                "choices": [{"id": "a", "label": "{{answer}}"}, {"id": "a", "label": "b"}],
            },
        },
        {"id": "s2", "tool": "t", "label": "S2", "kind": "select", "input": {"type": "choice"}},
        {"id": "q", "tool": "t", "label": "Q", "kind": "ask", "input": {"type": "free_text"}},
        {"id": "go", "tool": "t", "label": "dup"},
    ]
    d["intents"] = [{"id": "empty"}]
    d["variables"]["pooled"] = {"pool": []}
    d["scoring"]["dimensions"][0]["max_points"] = 0
    r = validate(d)
    assert {"secret_leak", "regex", "action", "duplicate_id", "intent", "variable", "scoring"} <= codes(r)


def test_scoring_reference_checks_and_warnings():
    d = minimal()
    d["scoring"]["efficiency"] = {"dimension": "eff", "target_minutes": 10, "max_minutes": 5}
    d["scoring"]["process"] = {"dimension": "proc", "required_order": ["INITIAL", "GHOST"]}
    d["scoring"]["bands"] = [{"name": "Only", "min": 50}]
    d["scoring"]["dimensions"][0]["max_points"] = 50
    d["environment"]["panels"][0]["type"] = "hologram"
    d["actions"][0]["classification"] = "neutral"
    r = validate(d)
    msgs = " ".join(e.message for e in r.errors)
    assert "Efficiency dimension" in msgs and "Process dimension" in msgs and "GHOST" in msgs
    assert "max_minutes" in msgs
    wcodes = {w.code for w in r.warnings}
    assert {"unreachable_max", "panel_type", "no_correct_actions", "scoring"} <= wcodes
    d["scoring"]["bands"] = []
    assert "scoring" in codes(validate(d))


def test_empty_phase_warning_and_title():
    d = minimal()
    d["meta"]["title"] = "  "
    d["actions"][0]["phases"] = ["DONE"]
    d["phases"][1]["terminal"] = False
    d["completion"] = {"success": {"var": "done"}}
    r = validate(d)
    assert "meta" in codes(r)
    assert any(w.code == "empty_phase" for w in r.warnings)


def test_repair_fixes_machine_output():
    raw = {
        "meta": {},
        "junk": True,
        "phases": [],
        "tools": [{"id": "t", "panel": "ghost"}],
        "characters": [{"id": "c", "facts": [{"id": "f", "text": "x", "intents": ["nope"]}]}],
        "intents": [{"id": "i", "patterns": ["hello"]}],
        "actions": [
            {
                "id": "keep",
                "tool": "t",
                "kind": "ask",
                "character": "zzz",
                "effects": [
                    {"set": {"ghost": 1, "ok": True}, "reveal": ["f", "nofact"], "transition": "NOWHERE"},
                    3,
                ],
                "score": {"technical_accuracy": 5, "ghost_dim": 2, "bad": "x"},
            },
            {"id": "drop", "tool": "nope"},
            {
                "id": "chat",
                "tool": "t",
                "kind": "ask",
                "character": "c",
                "input": {"type": "free_text", "intents": ["zzz"]},
            },
            "garbage",
        ],
        "variables": {"ok": {"initial": False}},
        "events": [
            {"id": "e", "trigger": {"type": "after_action", "action": "drop"}},
            {"id": "e2", "trigger": {"type": "time", "at_minutes": 5}, "effects": [{"inc": {"ghost": 1}}]},
        ],
        "scoring": {
            "dimensions": [{"id": "a", "weight": 30}, {"id": "b", "weight": 30}],
            "efficiency": {"dimension": "efficiency", "target_minutes": 5, "max_minutes": 10},
            "process": {"dimension": "a", "required_order": ["INITIAL", "BOGUS"]},
        },
    }
    fixed, notes = repair(raw)
    assert notes
    assert "junk" not in fixed and fixed["meta"]["title"]
    assert [a["id"] for a in fixed["actions"]] == ["keep"]
    keep = fixed["actions"][0]
    assert keep["kind"] == "inspect" and keep["character"] is None
    assert keep["effects"][0]["set"] == {"ok": True} and keep["effects"][0]["reveal"] == ["f"]
    assert "transition" not in keep["effects"][0]
    assert sum(x["weight"] for x in fixed["scoring"]["dimensions"]) == pytest.approx(100)
    assert "efficiency" not in fixed["scoring"] and fixed["scoring"]["process"]["required_order"] == [
        "INITIAL"
    ]
    assert [e["id"] for e in fixed["events"]] == ["e2"]
    report = validate(fixed)
    assert not any(e.code == "schema" for e in report.errors), report.as_dict()


def test_repair_defaults_and_zero_weights():
    fixed, notes = repair(
        {
            "scoring": {"dimensions": [{"id": "x", "weight": 0}, {"id": "y"}]},
            "initial_phase": "ZZZ",
            "phases": [
                {"id": "A", "transitions": ["B", "ghost"], "auto_advance": [{"to": "ghost", "when": True}]},
                {"id": "B"},
            ],
        }
    )
    assert fixed["initial_phase"] == "A"
    assert fixed["phases"][0]["transitions"] == ["B"] and fixed["phases"][0]["auto_advance"] == []
    assert [x["weight"] for x in fixed["scoring"]["dimensions"]] == [50, 50]
    fixed2, notes2 = repair("not a dict")  # type: ignore[arg-type]
    assert fixed2["phases"] and fixed2["scoring"]["dimensions"] and "Added default phases" in notes2


def test_repair_keeps_valid_template_valid():
    d = load_template("it-helpdesk-network")
    fixed, _ = repair(copy.deepcopy(d))
    assert validate(fixed).valid
