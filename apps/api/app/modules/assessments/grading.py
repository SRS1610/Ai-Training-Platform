"""Pure auto-grading engine for the 14 question types (no I/O, no framework imports).

Question shape (a ``questions`` row or an attempt ``questions_snapshot`` entry)::

    {"id", "question_type", "options": {...}, "answer_key": {...}, "points": 1.0,
     "negative_points": 0.0, "weight": 1.0}

Per-type ``options`` / ``answer_key`` / learner ``response`` formats:

=================  ==========================================  ==========================================  ==========================
type               options (shown to learners)                 answer_key (server side only)               response
=================  ==========================================  ==========================================  ==========================
multiple_choice    {"choices": [{"id","text"}]}                {"choice_id": "a"}                          {"choice_id": "a"}
multiple_select    {"choices": [...]}                          {"choice_ids": [..], "partial_credit": b}   {"choice_ids": [..]}
true_false         {}                                          {"value": true}                             {"value": true}
short_answer       {}                                          {"accepted": [..], "regex": "...",          {"text": "..."}
                                                                "case_sensitive": false}
matching           {"left": [{"id","text"}], "right": [...]}   {"pairs": {"l1": "r2"},                     {"pairs": {"l1": "r2"}}
                                                                "partial_credit": true}
ordering           {"items": [{"id","text"}]}                  {"order": [ids], "scoring":                 {"order": [ids]}
                                                                positions|kendall|all_or_nothing}
fill_blank         {"text": "A {{b1}} b", "blanks": [{"id"}]}  {"blanks": {"b1": {"accepted": [..],        {"blanks": {"b1": "..."}}
                                                                "regex", "case_sensitive"}},
                                                                "partial_credit": true}
decision_tree      {"start": "n1", "nodes": {"n1": {"prompt",  {"points": {"n1": {"c1": 2}},               {"path": [{"node_id",
                    "choices": [{"id","text","next"}]}}}        "max_points": optional}                     "choice_id"}]}
code               {"language": "python"}                      {"test_cases": [{"id","pattern",            {"code": "..."}
                                                                "match": contains|regex|not_contains|
                                                                exact, "weight"}], "auto_grade": false}
simulation         {"simulation_id": "..."}                    {}                                          {"session_id": "..."}
long_answer, file_upload, scenario, practical_task             (rubric / reference answer)                 free-form
=================  ==========================================  ==========================================  ==========================

Scoring: each question yields a *ratio* in ``[0, 1]``; the score is ``ratio * points * weight``.
With negative marking enabled, an answered-but-wrong objective question (ratio 0) scores
``-negative_points * weight``. Attempt totals are floored at 0 (:func:`attempt_total`).
"""

from __future__ import annotations

import random
import re
import unicodedata
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

MANUAL_TYPES = {"long_answer", "file_upload", "scenario", "practical_task"}
AUTO_TYPES = {
    "multiple_choice", "multiple_select", "true_false", "short_answer", "matching", "ordering", "fill_blank",
    "decision_tree",
}
ALL_TYPES = AUTO_TYPES | MANUAL_TYPES | {"code", "simulation"}

MAX_TEXT_LEN = 2000  # inputs to regexes are bounded (ReDoS hardening)
MAX_PATTERN_LEN = 500
EPS = 1e-9


@dataclass
class GradeResult:
    """Outcome of grading one question.

    ``score``/``is_correct`` are ``None`` when ``needs_manual`` (human or AI grading required).
    """

    score: float | None
    max_score: float
    is_correct: bool | None
    needs_manual: bool = False
    answered: bool = True
    ratio: float | None = None
    details: dict[str, Any] = field(default_factory=dict)


# ----------------------------------------------------------------------------- helpers


def normalise_text(value: Any, *, case_sensitive: bool = False) -> str:
    """Unicode-normalise, trim, collapse whitespace and strip surrounding punctuation."""
    text = unicodedata.normalize("NFKC", str(value if value is not None else ""))
    text = " ".join(text.split())
    text = text.strip(" .,;:!?\"'`")
    return text if case_sensitive else text.casefold()


def _text_matches(value: Any, spec: Mapping[str, Any]) -> bool:
    """Match free text against ``{"accepted": [...], "regex": str, "case_sensitive": bool}``."""
    case_sensitive = bool(spec.get("case_sensitive", False))
    raw = str(value if value is not None else "")[:MAX_TEXT_LEN]
    got = normalise_text(raw, case_sensitive=case_sensitive)
    if not got:
        return False
    for accepted in spec.get("accepted") or []:
        if got == normalise_text(accepted, case_sensitive=case_sensitive):
            return True
    pattern = spec.get("regex")
    if pattern:
        flags = 0 if case_sensitive else re.IGNORECASE
        try:
            if re.fullmatch(str(pattern)[:MAX_PATTERN_LEN], raw.strip(), flags):
                return True
        except re.error:
            return False
    return False


def _is_blank(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, Mapping | list | tuple | set):
        return len(value) == 0
    return False


def _ids(values: Iterable[Any] | None) -> list[str]:
    return [str(v) for v in (values or [])]


def _max_points(question: Mapping[str, Any]) -> float:
    return float(question.get("points", 1.0) or 0.0) * float(question.get("weight", 1.0) or 0.0)


# ----------------------------------------------------------------------------- per-type ratio functions
# Each returns (ratio in [0,1], answered, details).


def _grade_multiple_choice(q: Mapping[str, Any], r: Mapping[str, Any]) -> tuple[float, bool, dict[str, Any]]:
    key = q.get("answer_key") or {}
    correct = key.get("choice_id")
    if correct is None and key.get("choice_ids"):
        correct = key["choice_ids"][0]
    chosen = r.get("choice_id")
    if chosen is None and isinstance(r.get("choice_ids"), list) and len(r["choice_ids"]) == 1:
        chosen = r["choice_ids"][0]
    if _is_blank(chosen):
        return 0.0, False, {}
    return (1.0 if str(chosen) == str(correct) else 0.0), True, {"chosen": str(chosen)}


def _grade_multiple_select(q: Mapping[str, Any], r: Mapping[str, Any]) -> tuple[float, bool, dict[str, Any]]:
    key = q.get("answer_key") or {}
    opts = q.get("options") or {}
    correct = set(_ids(key.get("choice_ids")))
    chosen = set(_ids(r.get("choice_ids")))
    if not chosen:
        return 0.0, False, {}
    partial = bool(key.get("partial_credit", opts.get("partial_credit", False)))
    hits = len(chosen & correct)
    wrong = len(chosen - correct)
    if chosen == correct:
        ratio = 1.0
    elif partial and correct:
        # Each correct pick earns 1/|correct|, each wrong pick deducts the same; never below 0.
        ratio = max(0.0, (hits - wrong) / len(correct))
    else:
        ratio = 0.0
    return ratio, True, {"hits": hits, "wrong": wrong, "partial_credit": partial}


def _grade_true_false(q: Mapping[str, Any], r: Mapping[str, Any]) -> tuple[float, bool, dict[str, Any]]:
    expected = _as_bool((q.get("answer_key") or {}).get("value"))
    got = _as_bool(r.get("value"))
    if got is None:
        return 0.0, False, {}
    return (1.0 if got == expected else 0.0), True, {}


def _as_bool(v: Any) -> bool | None:
    if isinstance(v, bool):
        return v
    if isinstance(v, str) and v.strip().lower() in {"true", "false"}:
        return v.strip().lower() == "true"
    return None


def _grade_short_answer(q: Mapping[str, Any], r: Mapping[str, Any]) -> tuple[float, bool, dict[str, Any]]:
    text = r.get("text")
    if _is_blank(text):
        return 0.0, False, {}
    return (1.0 if _text_matches(text, q.get("answer_key") or {}) else 0.0), True, {}


def _grade_matching(q: Mapping[str, Any], r: Mapping[str, Any]) -> tuple[float, bool, dict[str, Any]]:
    key = q.get("answer_key") or {}
    expected = {str(k): str(v) for k, v in (key.get("pairs") or {}).items()}
    got_raw = r.get("pairs") or {}
    if not isinstance(got_raw, Mapping) or not got_raw:
        return 0.0, False, {}
    got = {str(k): str(v) for k, v in got_raw.items() if v is not None}
    if not expected:
        return 0.0, True, {}
    correct = sum(1 for left, right in expected.items() if got.get(left) == right)
    partial = bool(key.get("partial_credit", True))
    ratio = correct / len(expected) if partial else (1.0 if correct == len(expected) else 0.0)
    return ratio, True, {"correct_pairs": correct, "total_pairs": len(expected)}


def kendall_ratio(expected: Sequence[str], got: Sequence[str]) -> float:
    """Fraction of item pairs whose relative order matches ``expected`` (1.0 = identical order).

    Pairs that include an item missing from ``got`` count as discordant.
    """
    n = len(expected)
    if n < 2:
        return 1.0 if list(expected) == list(got)[:n] else 0.0
    pos = {item: i for i, item in enumerate(got)}
    concordant = 0
    total = n * (n - 1) // 2
    for i in range(n):
        for j in range(i + 1, n):
            a, b = expected[i], expected[j]
            if a in pos and b in pos and pos[a] < pos[b]:
                concordant += 1
    return concordant / total


def _grade_ordering(q: Mapping[str, Any], r: Mapping[str, Any]) -> tuple[float, bool, dict[str, Any]]:
    key = q.get("answer_key") or {}
    expected = _ids(key.get("order"))
    got = _ids(r.get("order"))
    if not got:
        return 0.0, False, {}
    # Ignore duplicates / unknown ids: keep first occurrence of known items.
    seen: set[str] = set()
    clean = [x for x in got if x in set(expected) and not (x in seen or seen.add(x))]
    scoring = str(key.get("scoring", "positions"))
    if not expected:
        return 0.0, True, {}
    if scoring == "all_or_nothing":
        ratio = 1.0 if clean == expected else 0.0
    elif scoring == "kendall":
        ratio = kendall_ratio(expected, clean)
    else:
        in_place = sum(1 for i, item in enumerate(expected) if i < len(clean) and clean[i] == item)
        ratio = in_place / len(expected)
    return ratio, True, {"scoring": scoring}


def _grade_fill_blank(q: Mapping[str, Any], r: Mapping[str, Any]) -> tuple[float, bool, dict[str, Any]]:
    key = q.get("answer_key") or {}
    specs: Mapping[str, Any] = key.get("blanks") or {}
    got = r.get("blanks") or {}
    if not isinstance(got, Mapping) or all(_is_blank(v) for v in got.values()):
        return 0.0, False, {}
    if not specs:
        return 0.0, True, {}
    results = {str(bid): _text_matches(got.get(bid) if bid in got else got.get(str(bid)), spec or {})
               for bid, spec in specs.items()}
    correct = sum(results.values())
    partial = bool(key.get("partial_credit", True))
    ratio = correct / len(specs) if partial else (1.0 if correct == len(specs) else 0.0)
    return ratio, True, {"blanks": results}


def decision_tree_max(options: Mapping[str, Any], points: Mapping[str, Mapping[str, Any]]) -> float:
    """Best achievable path score (DFS from ``start``; cycles are cut)."""
    nodes: Mapping[str, Any] = options.get("nodes") or {}

    def best(node_id: str, visiting: frozenset[str]) -> float:
        node = nodes.get(node_id)
        if not node or node_id in visiting:
            return 0.0
        top = 0.0
        for choice in node.get("choices") or []:
            cid = str(choice.get("id"))
            gain = float((points.get(node_id) or {}).get(cid, 0) or 0)
            nxt = choice.get("next")
            rest = best(str(nxt), visiting | {node_id}) if nxt else 0.0
            top = max(top, gain + rest)
        return top

    start = options.get("start")
    return best(str(start), frozenset()) if start else 0.0


def _grade_decision_tree(q: Mapping[str, Any], r: Mapping[str, Any]) -> tuple[float, bool, dict[str, Any]]:
    opts = q.get("options") or {}
    key = q.get("answer_key") or {}
    points: Mapping[str, Mapping[str, Any]] = key.get("points") or {}
    nodes: Mapping[str, Any] = opts.get("nodes") or {}
    path = r.get("path") or []
    if not isinstance(path, list) or not path:
        return 0.0, False, {}
    expected_node = str(opts.get("start")) if opts.get("start") else None
    earned = 0.0
    steps = 0
    visited: set[str] = set()
    for step in path:
        if not isinstance(step, Mapping):
            break
        node_id = str(step.get("node_id"))
        if node_id != expected_node or node_id in visited or node_id not in nodes:
            break  # path left the tree: stop scoring
        visited.add(node_id)
        choice = next((c for c in nodes[node_id].get("choices") or [] if str(c.get("id")) == str(step.get("choice_id"))),
                      None)
        if choice is None:
            break
        earned += float((points.get(node_id) or {}).get(str(choice.get("id")), 0) or 0)
        steps += 1
        expected_node = str(choice["next"]) if choice.get("next") else None
        if expected_node is None:
            break
    best = float(key.get("max_points") or 0) or decision_tree_max(opts, points)
    ratio = max(0.0, min(1.0, earned / best)) if best > 0 else 0.0
    return ratio, True, {"earned_points": earned, "max_points": best, "valid_steps": steps}


def run_code_checks(code: str, test_cases: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Static string checks over submitted source — the code is never executed."""
    source = (code or "")[: MAX_TEXT_LEN * 25]
    results = []
    for i, tc in enumerate(test_cases):
        pattern = str(tc.get("pattern", ""))
        mode = str(tc.get("match", "contains"))
        flags = 0 if tc.get("case_sensitive", True) else re.IGNORECASE
        hay = source if flags == 0 else source.casefold()
        needle = pattern if flags == 0 else pattern.casefold()
        try:
            if mode == "regex":
                passed = re.search(pattern[:MAX_PATTERN_LEN], source, flags | re.MULTILINE) is not None
            elif mode == "not_contains":
                passed = needle not in hay
            elif mode == "exact":
                passed = source.strip() == pattern.strip()
            else:
                passed = needle in hay
        except re.error:
            passed = False
        results.append({"id": str(tc.get("id", i)), "description": tc.get("description"), "passed": passed,
                        "weight": float(tc.get("weight", 1) or 0)})
    return results


# ----------------------------------------------------------------------------- dispatcher

_RATIO_FUNCS = {
    "multiple_choice": _grade_multiple_choice,
    "multiple_select": _grade_multiple_select,
    "true_false": _grade_true_false,
    "short_answer": _grade_short_answer,
    "matching": _grade_matching,
    "ordering": _grade_ordering,
    "fill_blank": _grade_fill_blank,
    "decision_tree": _grade_decision_tree,
}


def grade_question(
    question: Mapping[str, Any],
    response: Mapping[str, Any] | None,
    *,
    negative_marking: bool = False,
    simulation_result: Mapping[str, Any] | None = None,
) -> GradeResult:
    """Grade one response. ``simulation_result`` (``{"status","total_score"}`` 0-100) is supplied by the
    caller for ``simulation`` questions after verifying the referenced session belongs to the learner."""
    qtype = str(question.get("question_type"))
    r: Mapping[str, Any] = response if isinstance(response, Mapping) else {}
    max_score = _max_points(question)
    weight = float(question.get("weight", 1.0) or 0.0)

    if qtype in _RATIO_FUNCS:
        ratio, answered, details = _RATIO_FUNCS[qtype](question, r)
        ratio = max(0.0, min(1.0, ratio))
        if not answered:
            return GradeResult(0.0, max_score, False, answered=False, ratio=0.0, details={"unanswered": True})
        score = ratio * max_score
        if ratio <= EPS and negative_marking:
            score = -abs(float(question.get("negative_points", 0) or 0)) * weight
        return GradeResult(round(score, 4), max_score, ratio >= 1 - EPS, ratio=ratio, details=details)

    if qtype == "code":
        code = r.get("code")
        if _is_blank(code):
            return GradeResult(0.0, max_score, False, answered=False, ratio=0.0, details={"unanswered": True})
        key = question.get("answer_key") or {}
        cases = key.get("test_cases") or []
        checks = run_code_checks(str(code), cases) if cases else []
        details = {"checks": checks, "note": "Static pattern checks only; code was not executed."}
        if cases and key.get("auto_grade"):
            total_w = sum(c["weight"] for c in checks) or 1.0
            ratio = sum(c["weight"] for c in checks if c["passed"]) / total_w
            return GradeResult(round(ratio * max_score, 4), max_score, ratio >= 1 - EPS, ratio=ratio,
                               details=details)
        return GradeResult(None, max_score, None, needs_manual=True, details=details)

    if qtype == "simulation":
        if simulation_result and simulation_result.get("status") == "completed" and \
                simulation_result.get("total_score") is not None:
            ratio = max(0.0, min(1.0, float(simulation_result["total_score"]) / 100.0))
            return GradeResult(round(ratio * max_score, 4), max_score, bool(simulation_result.get("passed")),
                               ratio=ratio, details={"simulation": dict(simulation_result)})
        if _is_blank(r.get("session_id")):
            return GradeResult(0.0, max_score, False, answered=False, ratio=0.0, details={"unanswered": True})
        return GradeResult(None, max_score, None, needs_manual=True,
                           details={"note": "Simulation result unavailable; manual grading required."})

    # long_answer, file_upload, scenario, practical_task (and unknown types): human / AI grading.
    if _is_blank(dict(r)) or all(_is_blank(v) for v in r.values()):
        return GradeResult(0.0, max_score, False, answered=False, ratio=0.0, details={"unanswered": True})
    return GradeResult(None, max_score, None, needs_manual=True)


def attempt_total(scores: Iterable[float | None]) -> float:
    """Sum question scores, ignoring ungraded ones, floored at zero (negative marking never goes below 0)."""
    return max(0.0, round(sum(s for s in scores if s is not None), 4))


def percentage(score: float, max_score: float) -> float:
    return round(score / max_score * 100.0, 2) if max_score > 0 else 0.0


# ----------------------------------------------------------------------------- correct-answer rendering


def correct_answer(question: Mapping[str, Any]) -> dict[str, Any] | None:
    """Learner-facing representation of the correct answer (used only when feedback is allowed)."""
    qtype = str(question.get("question_type"))
    key = question.get("answer_key") or {}
    if qtype == "multiple_choice":
        return {"choice_id": key.get("choice_id") or (key.get("choice_ids") or [None])[0]}
    if qtype == "multiple_select":
        return {"choice_ids": key.get("choice_ids") or []}
    if qtype == "true_false":
        return {"value": key.get("value")}
    if qtype == "short_answer":
        return {"accepted": key.get("accepted") or []}
    if qtype == "matching":
        return {"pairs": key.get("pairs") or {}}
    if qtype == "ordering":
        return {"order": key.get("order") or []}
    if qtype == "fill_blank":
        return {"blanks": {k: (v or {}).get("accepted") or [] for k, v in (key.get("blanks") or {}).items()}}
    if qtype == "decision_tree":
        return {"points": key.get("points") or {}}
    if "model_answer" in key:
        return {"model_answer": key["model_answer"]}
    return None


SECRET_OPTION_KEYS = {"correct", "is_correct", "points", "score", "feedback", "answer", "answers", "weight_hint"}


def learner_options(question: Mapping[str, Any]) -> dict[str, Any]:
    """Options with any answer-revealing keys stripped (defence in depth against authoring mistakes)."""

    def scrub(value: Any) -> Any:
        if isinstance(value, Mapping):
            return {k: scrub(v) for k, v in value.items() if k not in SECRET_OPTION_KEYS}
        if isinstance(value, list):
            return [scrub(v) for v in value]
        return value

    return scrub(dict(question.get("options") or {}))


# ----------------------------------------------------------------------------- deterministic drawing


def shuffle_question_options(question: dict[str, Any], rng: random.Random, *, shuffle_options: bool) -> None:
    """Shuffle presentation order in place. Ordering items are always shuffled (their authored order is the
    answer); choices and matching targets only when ``shuffle_options``."""
    opts = question.get("options")
    if not isinstance(opts, dict):
        return
    opts = dict(opts)
    qtype = question.get("question_type")
    if qtype == "ordering" and isinstance(opts.get("items"), list) and len(opts["items"]) > 1:
        items = list(opts["items"])
        original = list(items)
        for _ in range(5):  # avoid presenting the solved order when possible
            rng.shuffle(items)
            if items != original:
                break
        opts["items"] = items
    if shuffle_options:
        if qtype in {"multiple_choice", "multiple_select"} and isinstance(opts.get("choices"), list):
            choices = list(opts["choices"])
            rng.shuffle(choices)
            opts["choices"] = choices
        if qtype == "matching" and isinstance(opts.get("right"), list):
            right = list(opts["right"])
            rng.shuffle(right)
            opts["right"] = right
    question["options"] = opts


def draw_questions(
    items: Sequence[Mapping[str, Any]],
    pools: Mapping[str, Sequence[Mapping[str, Any]]],
    fixed: Mapping[str, Mapping[str, Any]],
    *,
    seed: int,
    shuffle_questions: bool,
    shuffle_options: bool,
) -> list[dict[str, Any]]:
    """Deterministically build an attempt's question list.

    ``items``: ``[{"id","question_id"|None,"bank_id"|None,"draw_count","weight"}]`` in position order.
    ``pools``: item id → eligible questions (already filtered); ``fixed``: question id → question.
    The same ``seed`` always yields the same questions and order.
    """
    rng = random.Random(seed)
    chosen: list[dict[str, Any]] = []
    used: set[str] = set()
    for item in items:
        weight = float(item.get("weight", 1.0) or 1.0)
        if item.get("question_id"):
            q = fixed.get(str(item["question_id"]))
            if q is not None and str(q["id"]) not in used:
                used.add(str(q["id"]))
                chosen.append({**q, "weight": weight})
            continue
        candidates = sorted((q for q in pools.get(str(item.get("id")), []) if str(q["id"]) not in used),
                            key=lambda q: str(q["id"]))
        count = min(int(item.get("draw_count", 1) or 1), len(candidates))
        for q in rng.sample(candidates, count):
            used.add(str(q["id"]))
            chosen.append({**q, "weight": weight})
    if shuffle_questions:
        rng.shuffle(chosen)
    out = []
    for position, q in enumerate(chosen):
        q = dict(q)
        q["position"] = position
        shuffle_question_options(q, rng, shuffle_options=shuffle_options)
        out.append(q)
    return out
