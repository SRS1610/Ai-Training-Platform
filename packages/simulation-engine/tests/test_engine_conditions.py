from __future__ import annotations

import pytest

from simulation_engine.conditions import ConditionError, EvalContext, check_condition, evaluate, truthy


@pytest.fixture
def ctx() -> EvalContext:
    return EvalContext(
        variables={"a": 1, "b": "x", "flag": True, "nested": {"k": [10, 20]}, "items": [1, 2, 3]},
        phase="DIAGNOSIS", facts={"f1"}, action_counts={"ping": 2, "ask": 1},
        visited_phases={"INITIAL", "DIAGNOSIS"}, fired_events={"e1": 1}, problems={"p1"}, minutes=12.5,
        unknown_inputs=2, input={"text": "The DNS server was STATIC", "choice": "c1", "args": ["x", "y"]},
    )


@pytest.mark.parametrize("cond, expected", [
    (None, None), (True, True), (3, 3), ("s", "s"),
    ({"and": [True, 1, "x"]}, "x"), ({"and": [True, 0]}, 0), ({"or": [0, "", "y"]}, "y"), ({"or": [0, False]}, False),
    ({"not": True}, False), ({"!": [0]}, True),
    ({"==": [{"var": "a"}, 1]}, True), ({"!=": [{"var": "a"}, 1]}, False),
    ({"<": [1, 2]}, True), ({"<=": [2, 2]}, True), ({">": [1, 2]}, False), ({">=": [3, 2]}, True),
    ({"<": ["a", 1]}, False),  # type mismatch is just false
    ({"in": ["x", ["x", "y"]]}, True), ({"in": ["DNS", "The DNS"]}, True), ({"in": [1, 5]}, False),
    ({"in": [[1], [[1]]]}, True), ({"in": [{"var": "items"}, {"var": "items"}]}, False),
    ({"+": [1, 2, True]}, 4.0), ({"-": [10, 3, 2]}, 5.0), ({"-": [4]}, -4.0), ({"-": []}, 0.0), ({"+": ["x"]}, 0.0),
    ({"var": "nested.k.1"}, 20), ({"var": "nested.k.9"}, None), ({"var": ["missing", "dflt"]}, "dflt"),
    ({"var": "b.c"}, None),
    ({"var": "$input.text"}, "The DNS server was STATIC"), ({"var": "$input.args.1"}, "y"),
    ({"var": "$input.nope"}, None), ({"var": "$input"}, {"text": "The DNS server was STATIC", "choice": "c1",
                                                         "args": ["x", "y"]}),
    ({"var": "$minutes"}, 12.5), ({"var": "$phase"}, "DIAGNOSIS"), ({"var": "$actions_count"}, 3),
    ({"var": "$problems_count"}, 1), ({"var": "$unknown_inputs"}, 2),
    ({"has_fact": "f1"}, True), ({"has_fact": "f2"}, False),
    ({"phase_is": "DIAGNOSIS"}, True), ({"phase_is": ["INITIAL", "DIAGNOSIS"]}, True),
    ({"visited_phase": "INITIAL"}, True), ({"visited_phase": "RESOLUTION"}, False),
    ({"action_taken": "ping"}, True), ({"action_taken": ["ping", 3]}, False), ({"action_taken": "x"}, False),
    ({"count": "ping"}, 2), ({"count": {"var": "items"}}, 3), ({"count": {"var": "a"}}, 0),
    ({"count": {"var": "$input.choice"}}, 0),
    ({"event_fired": "e1"}, True), ({"has_problem": "p1"}, True),
    ({"contains": [{"var": "$input.text"}, "dns server"]}, True), ({"contains": [{"var": "items"}, 2]}, True),
    ({"contains": [5, 5]}, False),
    ({"count_keywords": [{"var": "$input.text"}, ["dns", ["static", "manual"], "dhcp"]]}, 2),
    ([1, {"var": "a"}], [1, 1]),
])
def test_operators(ctx, cond, expected):
    assert evaluate(cond, ctx) == expected


def test_truthy_none_is_true(ctx):
    assert truthy(None, ctx) is True
    assert truthy({"var": "missing"}, ctx) is False


@pytest.mark.parametrize("bad", [
    {"__import__": "os"}, {"eval": "1+1"}, {"exec": "print(1)"}, {"a": 1, "b": 2}, {"var": []},
    {"var": [1, 2, 3]}, {"not": [1, 2]}, {"==": [1]}, {"action_taken": ["x"]}, {"count_keywords": ["x", "y"]},
    {"var": 5}, object(),
])
def test_unsafe_or_malformed_conditions_raise(ctx, bad):
    with pytest.raises(ConditionError):
        evaluate(bad, ctx)


def test_python_code_in_strings_is_inert(ctx):
    payload = "__import__('os').system('echo hacked')"
    assert evaluate(payload, ctx) == payload
    assert evaluate({"==": [{"var": "b"}, payload]}, ctx) is False


def test_depth_and_size_limits(ctx):
    deep: object = True
    for _ in range(40):
        deep = {"not": deep}
    with pytest.raises(ConditionError):
        evaluate(deep, ctx)
    with pytest.raises(ConditionError):
        evaluate({"and": [True] * 3000}, ctx)


def test_from_state_builds_context():
    state = {"variables": {"x": 1}, "phase": "P", "revealed_facts": ["f"], "action_counts": {"a": 1},
             "phase_history": [{"phase": "P", "seq": 0, "minutes": 0}], "fired_events": {}, "problems": [{"id": "q"}],
             "minutes": 3, "unknown_inputs": 1}
    c = EvalContext.from_state(state, {"text": "hi"})
    assert c.visited_phases == {"P"} and c.problems == {"q"} and c.input["text"] == "hi"


def test_check_condition_collects_refs_and_errors():
    errors, refs = check_condition({"and": [
        {"var": "x.y"}, {"has_fact": "f1"}, {"phase_is": ["A", "B"]}, {"action_taken": ["act", 2]},
        {"event_fired": "e"}, {"has_problem": "p"}, {"count": "c"}, {"var": "$minutes"}, {"var": "$bogus"},
        {"var": ["v2", 0]}, {"var": {"var": "dyn"}}, {"has_fact": {"var": "fv"}}, {"nope": 1}, {"a": 1, "b": 2},
        {"visited_phase": "C"},
    ]})
    assert refs["variables"] == {"x", "v2", "dyn", "fv"}
    assert refs["facts"] == {"f1"} and refs["phases"] == {"A", "B", "C"}
    assert refs["actions"] == {"act", "c"} and refs["events"] == {"e"} and refs["problems"] == {"p"}
    assert any("$bogus" in e for e in errors) and any("nope" in e for e in errors)
    assert any("exactly one" in e for e in errors)
    errs, _ = check_condition(object())
    assert errs
    deep: object = True
    for _ in range(40):
        deep = {"not": deep}
    assert check_condition(deep)[0]
