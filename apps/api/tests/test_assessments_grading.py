"""Unit tests for the pure grading / validation / drawing engine (no database)."""

from __future__ import annotations

import pytest

from app.modules.assessments import grading
from app.modules.assessments.grading import attempt_total, grade_question, kendall_ratio
from app.modules.assessments.validation import validate_question


def q(qtype: str, options: dict | None = None, answer_key: dict | None = None, **kw) -> dict:
    return {"id": kw.pop("id", "q1"), "question_type": qtype, "options": options or {},
            "answer_key": answer_key or {}, "points": kw.pop("points", 1.0),
            "negative_points": kw.pop("negative_points", 0.0), "weight": kw.pop("weight", 1.0), **kw}


CHOICES = {"choices": [{"id": "a", "text": "A"}, {"id": "b", "text": "B"}, {"id": "c", "text": "C"},
                       {"id": "d", "text": "D"}]}


# ----------------------------------------------------------------------------- multiple choice / true-false


def test_multiple_choice_correct_wrong_and_blank():
    mc = q("multiple_choice", CHOICES, {"choice_id": "b"}, points=2)
    r = grade_question(mc, {"choice_id": "b"})
    assert (r.score, r.max_score, r.is_correct) == (2.0, 2.0, True)
    r = grade_question(mc, {"choice_id": "a"})
    assert (r.score, r.is_correct) == (0.0, False)
    r = grade_question(mc, {})
    assert r.answered is False and r.score == 0.0


def test_negative_marking_only_for_answered_wrong():
    mc = q("multiple_choice", CHOICES, {"choice_id": "b"}, points=2, negative_points=0.5)
    assert grade_question(mc, {"choice_id": "a"}, negative_marking=True).score == -0.5
    assert grade_question(mc, {}, negative_marking=True).score == 0.0  # blank is never penalised
    assert grade_question(mc, {"choice_id": "a"}, negative_marking=False).score == 0.0
    assert grade_question(mc, {"choice_id": "b"}, negative_marking=True).score == 2.0


def test_negative_marking_scaled_by_weight():
    mc = q("multiple_choice", CHOICES, {"choice_id": "b"}, points=1, negative_points=1, weight=2)
    assert grade_question(mc, {"choice_id": "c"}, negative_marking=True).score == -2.0


def test_attempt_total_floor_at_zero():
    assert attempt_total([-1.0, -0.5, 0.5]) == 0.0
    assert attempt_total([2.0, -0.5, None]) == 1.5


def test_true_false_accepts_bool_and_string():
    tf = q("true_false", answer_key={"value": False})
    assert grade_question(tf, {"value": False}).is_correct is True
    assert grade_question(tf, {"value": "false"}).is_correct is True
    assert grade_question(tf, {"value": True}).is_correct is False
    assert grade_question(tf, {"value": None}).answered is False


# ----------------------------------------------------------------------------- multiple select


def test_multiple_select_all_or_nothing():
    ms = q("multiple_select", CHOICES, {"choice_ids": ["a", "c"]}, points=4)
    assert grade_question(ms, {"choice_ids": ["c", "a"]}).score == 4.0
    assert grade_question(ms, {"choice_ids": ["a"]}).score == 0.0
    assert grade_question(ms, {"choice_ids": ["a", "c", "d"]}).score == 0.0


def test_multiple_select_partial_credit():
    ms = q("multiple_select", CHOICES, {"choice_ids": ["a", "c"], "partial_credit": True}, points=4)
    r = grade_question(ms, {"choice_ids": ["a"]})
    assert r.score == 2.0 and r.is_correct is False
    assert grade_question(ms, {"choice_ids": ["a", "b"]}).score == 0.0  # hit - wrong = 0
    assert grade_question(ms, {"choice_ids": ["b", "d"]}).score == 0.0  # never below zero
    assert grade_question(ms, {"choice_ids": ["a", "c", "b"]}).score == 2.0


# ----------------------------------------------------------------------------- short answer


def test_short_answer_normalisation():
    sa = q("short_answer", answer_key={"accepted": ["Domain Name System"]})
    assert grade_question(sa, {"text": "  domain   name system. "}).is_correct is True
    assert grade_question(sa, {"text": "DNS"}).is_correct is False


def test_short_answer_case_sensitive_and_regex():
    sa = q("short_answer", answer_key={"accepted": ["NaCl"], "case_sensitive": True})
    assert grade_question(sa, {"text": "NaCl"}).is_correct is True
    assert grade_question(sa, {"text": "nacl"}).is_correct is False
    rx = q("short_answer", answer_key={"regex": r"port\s*(443|https)"})
    assert grade_question(rx, {"text": "Port 443"}).is_correct is True
    assert grade_question(rx, {"text": "port 80"}).is_correct is False


def test_short_answer_invalid_regex_is_safe():
    rx = q("short_answer", answer_key={"regex": "([a-"})
    assert grade_question(rx, {"text": "abc"}).is_correct is False


# ----------------------------------------------------------------------------- matching / ordering


def test_matching_partial_and_strict():
    opts = {"left": [{"id": "l1", "text": "x"}, {"id": "l2", "text": "y"}],
            "right": [{"id": "r1", "text": "1"}, {"id": "r2", "text": "2"}]}
    m = q("matching", opts, {"pairs": {"l1": "r1", "l2": "r2"}}, points=2)
    assert grade_question(m, {"pairs": {"l1": "r1", "l2": "r1"}}).score == 1.0
    strict = q("matching", opts, {"pairs": {"l1": "r1", "l2": "r2"}, "partial_credit": False}, points=2)
    assert grade_question(strict, {"pairs": {"l1": "r1", "l2": "r1"}}).score == 0.0
    assert grade_question(strict, {"pairs": {"l1": "r1", "l2": "r2"}}).is_correct is True


def test_ordering_positions():
    o = q("ordering", answer_key={"order": ["a", "b", "c", "d"]}, points=4)
    assert grade_question(o, {"order": ["a", "b", "c", "d"]}).score == 4.0
    assert grade_question(o, {"order": ["a", "b", "d", "c"]}).score == 2.0
    assert grade_question(o, {"order": ["d", "c", "b", "a"]}).score == 0.0


def test_ordering_kendall():
    o = q("ordering", answer_key={"order": ["a", "b", "c", "d"], "scoring": "kendall"}, points=6)
    # One adjacent swap: 5 of 6 pairs concordant.
    assert grade_question(o, {"order": ["b", "a", "c", "d"]}).score == pytest.approx(5.0)
    assert grade_question(o, {"order": ["d", "c", "b", "a"]}).score == 0.0
    assert kendall_ratio(["a", "b", "c"], ["a", "b"]) == pytest.approx(1 / 3)


def test_ordering_all_or_nothing_and_duplicates():
    o = q("ordering", answer_key={"order": ["a", "b", "c"], "scoring": "all_or_nothing"})
    assert grade_question(o, {"order": ["a", "b", "c"]}).is_correct is True
    assert grade_question(o, {"order": ["a", "a", "b", "c"]}).is_correct is True  # duplicates ignored
    assert grade_question(o, {"order": ["a", "c", "b"]}).score == 0.0


# ----------------------------------------------------------------------------- fill blank


def test_fill_blank_multiple_blanks():
    fb = q("fill_blank", {"text": "{{b1}} uses port {{b2}}", "blanks": [{"id": "b1"}, {"id": "b2"}]},
           {"blanks": {"b1": {"accepted": ["HTTPS", "TLS"]}, "b2": {"regex": r"0*443"}}}, points=2)
    assert grade_question(fb, {"blanks": {"b1": "https", "b2": "443"}}).score == 2.0
    r = grade_question(fb, {"blanks": {"b1": "http", "b2": "443"}})
    assert r.score == 1.0 and r.details["blanks"] == {"b1": False, "b2": True}
    strict = q("fill_blank", fb["options"], {**fb["answer_key"], "partial_credit": False}, points=2)
    assert grade_question(strict, {"blanks": {"b1": "http", "b2": "443"}}).score == 0.0
    assert grade_question(fb, {"blanks": {"b1": " ", "b2": ""}}).answered is False


# ----------------------------------------------------------------------------- decision tree


TREE = {
    "start": "n1",
    "nodes": {
        "n1": {"prompt": "User cannot log in", "choices": [
            {"id": "check", "text": "Check account lockout", "next": "n2"},
            {"id": "reset", "text": "Reset password immediately", "next": "n3"}]},
        "n2": {"prompt": "Account locked", "choices": [
            {"id": "verify", "text": "Verify identity then unlock"}, {"id": "unlock", "text": "Unlock"}]},
        "n3": {"prompt": "Password reset", "choices": [{"id": "close", "text": "Close ticket"}]},
    },
}
TREE_KEY = {"points": {"n1": {"check": 2, "reset": 0}, "n2": {"verify": 3, "unlock": 1}, "n3": {"close": 1}}}


def test_decision_tree_best_path_full_marks():
    dt = q("decision_tree", TREE, TREE_KEY, points=10)
    r = grade_question(dt, {"path": [{"node_id": "n1", "choice_id": "check"},
                                     {"node_id": "n2", "choice_id": "verify"}]})
    assert r.score == 10.0 and r.is_correct is True
    assert grading.decision_tree_max(TREE, TREE_KEY["points"]) == 5


def test_decision_tree_partial_and_invalid_paths():
    dt = q("decision_tree", TREE, TREE_KEY, points=10)
    r = grade_question(dt, {"path": [{"node_id": "n1", "choice_id": "reset"},
                                     {"node_id": "n3", "choice_id": "close"}]})
    assert r.score == pytest.approx(2.0)
    # Jumping to a node not reachable from the previous choice stops scoring.
    r = grade_question(dt, {"path": [{"node_id": "n1", "choice_id": "reset"},
                                     {"node_id": "n2", "choice_id": "verify"}]})
    assert r.score == 0.0
    r = grade_question(dt, {"path": [{"node_id": "n2", "choice_id": "verify"}]})
    assert r.score == 0.0 and r.details["valid_steps"] == 0


# ----------------------------------------------------------------------------- manual / code / simulation


@pytest.mark.parametrize("qtype", ["long_answer", "file_upload", "scenario", "practical_task"])
def test_manual_types_need_review(qtype):
    r = grade_question(q(qtype), {"text": "my answer", "file_ids": ["x"]})
    assert r.needs_manual is True and r.score is None and r.is_correct is None
    blank = grade_question(q(qtype), {"text": "  "})
    assert blank.needs_manual is False and blank.score == 0.0 and blank.answered is False


def test_code_checks_static_only():
    key = {"test_cases": [{"id": "def", "pattern": "def add("}, {"id": "ret", "pattern": r"return\s+a\s*\+\s*b",
                                                                  "match": "regex"},
                          {"id": "noeval", "pattern": "eval(", "match": "not_contains"}]}
    code = "def add(a, b):\n    return a + b\n"
    manual = grade_question(q("code", answer_key=key), {"code": code})
    assert manual.needs_manual is True
    assert all(c["passed"] for c in manual.details["checks"])
    auto = grade_question(q("code", answer_key={**key, "auto_grade": True}, points=3),
                          {"code": "def add(a, b):\n    return eval('a+b')"})
    assert auto.needs_manual is False and auto.score == pytest.approx(1.0)


def test_simulation_scored_from_session_result():
    sim = q("simulation", {"simulation_id": "s1"}, points=5)
    r = grade_question(sim, {"session_id": "x"}, simulation_result={"status": "completed", "total_score": 80,
                                                                    "passed": True})
    assert r.score == 4.0 and r.is_correct is True
    pending = grade_question(sim, {"session_id": "x"}, simulation_result={"status": "active", "total_score": None})
    assert pending.needs_manual is True
    assert grade_question(sim, {}).answered is False


def test_weights_scale_max_score():
    mc = q("multiple_choice", CHOICES, {"choice_id": "a"}, points=2, weight=1.5)
    r = grade_question(mc, {"choice_id": "a"})
    assert r.max_score == 3.0 and r.score == 3.0


# ----------------------------------------------------------------------------- learner-safe views


def test_learner_options_strip_secret_keys():
    opts = {"choices": [{"id": "a", "text": "A", "correct": True, "feedback": "yes"}]}
    assert grading.learner_options({"options": opts}) == {"choices": [{"id": "a", "text": "A"}]}


def test_correct_answer_rendering():
    assert grading.correct_answer(q("multiple_choice", CHOICES, {"choice_id": "b"})) == {"choice_id": "b"}
    assert grading.correct_answer(q("long_answer")) is None


# ----------------------------------------------------------------------------- deterministic drawing


def _pool(n: int) -> list[dict]:
    return [q("multiple_choice", CHOICES, {"choice_id": "a"}, id=f"p{i:02d}") for i in range(n)]


def test_draw_is_deterministic_for_seed():
    items = [{"id": "i1", "question_id": "fixed", "draw_count": 1, "weight": 1},
             {"id": "i2", "bank_id": "b", "draw_count": 5, "weight": 2}]
    fixed = {"fixed": q("true_false", answer_key={"value": True}, id="fixed")}
    pools = {"i2": _pool(20)}
    a = grading.draw_questions(items, pools, fixed, seed=42, shuffle_questions=True, shuffle_options=True)
    b = grading.draw_questions(items, pools, fixed, seed=42, shuffle_questions=True, shuffle_options=True)
    c = grading.draw_questions(items, pools, fixed, seed=7, shuffle_questions=True, shuffle_options=True)
    assert [x["id"] for x in a] == [x["id"] for x in b]
    assert [x["options"] for x in a] == [x["options"] for x in b]
    assert [x["id"] for x in a] != [x["id"] for x in c]
    assert len(a) == 6 and len({x["id"] for x in a}) == 6
    assert {x["weight"] for x in a if x["id"] != "fixed"} == {2.0}
    # Input pool order does not affect the draw.
    d = grading.draw_questions(items, {"i2": list(reversed(_pool(20)))}, fixed, seed=42, shuffle_questions=True,
                               shuffle_options=True)
    assert [x["id"] for x in a] == [x["id"] for x in d]


def test_draw_without_shuffle_keeps_item_order_and_ordering_items_shuffled():
    items = [{"id": "i1", "question_id": "o"}, {"id": "i2", "question_id": "t"}]
    order_items = [{"id": str(i), "text": str(i)} for i in range(6)]
    fixed = {"o": q("ordering", {"items": order_items}, {"order": [str(i) for i in range(6)]}, id="o"),
             "t": q("true_false", answer_key={"value": True}, id="t")}
    out = grading.draw_questions(items, {}, fixed, seed=1, shuffle_questions=False, shuffle_options=False)
    assert [x["id"] for x in out] == ["o", "t"]
    assert out[0]["options"]["items"] != order_items  # authored (correct) order is never presented
    assert fixed["o"]["options"]["items"] == order_items  # inputs are not mutated


def test_draw_pool_smaller_than_count():
    out = grading.draw_questions([{"id": "i", "bank_id": "b", "draw_count": 10}], {"i": _pool(3)}, {}, seed=3,
                                 shuffle_questions=False, shuffle_options=False)
    assert len(out) == 3


# ----------------------------------------------------------------------------- validation


def test_validation_per_type():
    assert validate_question("multiple_choice", CHOICES, {"choice_id": "b"}) == []
    assert validate_question("multiple_choice", CHOICES, {"choice_id": "z"})
    assert validate_question("multiple_choice", {"choices": [{"id": "a", "text": "A"}]}, {"choice_id": "a"})
    assert validate_question("multiple_select", CHOICES, {"choice_ids": []})
    assert validate_question("true_false", {}, {"value": "yes"})
    assert validate_question("short_answer", {}, {}) == ["answer_key needs at least one accepted answer or a regex"]
    assert validate_question("short_answer", {}, {"regex": "(["})
    assert validate_question("ordering", {"items": [{"id": "a", "text": "A"}, {"id": "b", "text": "B"}]},
                             {"order": ["a"]})
    assert validate_question("matching", {"left": [{"id": "l", "text": "L"}], "right": [{"id": "r", "text": "R"}]},
                             {"pairs": {"l": "r"}}) == []
    assert validate_question("fill_blank", {"blanks": [{"id": "b1"}]}, {"blanks": {"b1": {"accepted": ["x"]}}}) == []
    assert validate_question("fill_blank", {"blanks": [{"id": "b1"}]}, {"blanks": {}})
    assert validate_question("decision_tree", TREE, TREE_KEY) == []
    bad_tree = {"start": "n1", "nodes": {"n1": {"choices": [{"id": "x", "next": "nope"}]}}}
    assert validate_question("decision_tree", bad_tree, {"points": {}})
    assert validate_question("code", {}, {"auto_grade": True})
    assert validate_question("simulation", {}, {})
    assert validate_question("long_answer", {}, {}) == []
    assert validate_question("nonsense", {}, {}) == ["Unknown question type 'nonsense'"]
    assert validate_question("true_false", {}, {"value": True}, points=-1)
