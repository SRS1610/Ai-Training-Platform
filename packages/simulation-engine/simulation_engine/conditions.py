"""Safe JSON-logic style condition language. Pure data interpretation: no ``eval``/``exec``, bounded depth
and node count, closed operator set.

A condition is a literal (bool/number/string/null), a list (each element evaluated) or a single-key dict
``{"op": args}``. Operators:

* logic: ``and``, ``or`` (lists, short-circuit), ``not`` / ``!``
* comparison: ``==``, ``!=``, ``<``, ``<=``, ``>``, ``>=`` (type mismatches are simply false), ``in``
* arithmetic: ``+``, ``-``
* data: ``var`` (``"name"``, ``"a.b"`` paths, ``["name", default]``; specials ``$input.text``,
  ``$input.choice``, ``$input.args``, ``$minutes``, ``$phase``, ``$actions_count``, ``$problems_count``,
  ``$unknown_inputs``)
* state: ``has_fact``, ``phase_is`` (id or list), ``visited_phase``, ``action_taken`` (id, or
  ``[id, min_times]``), ``count`` (times an action was taken, or length of an evaluated list),
  ``event_fired``, ``has_problem``
* text: ``contains`` ``[haystack, needle]`` (case-insensitive for strings), ``count_keywords``
  ``[text, [kw, ...]]`` → number of distinct keywords present.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

MAX_DEPTH = 32
MAX_NODES = 2000


class ConditionError(ValueError):
    """Raised for malformed conditions (unknown operator, bad arity, too deep)."""


@dataclass
class EvalContext:
    variables: dict[str, Any] = field(default_factory=dict)
    phase: str = ""
    facts: set[str] = field(default_factory=set)
    action_counts: dict[str, int] = field(default_factory=dict)
    visited_phases: set[str] = field(default_factory=set)
    fired_events: dict[str, int] = field(default_factory=dict)
    problems: set[str] = field(default_factory=set)
    minutes: float = 0.0
    unknown_inputs: int = 0
    input: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_state(cls, state: dict[str, Any], input: dict[str, Any] | None = None) -> EvalContext:
        return cls(
            variables=state.get("variables", {}),
            phase=state.get("phase", ""),
            facts=set(state.get("revealed_facts", [])),
            action_counts=state.get("action_counts", {}),
            visited_phases={p["phase"] for p in state.get("phase_history", [])},
            fired_events=state.get("fired_events", {}),
            problems={p["id"] for p in state.get("problems", [])},
            minutes=float(state.get("minutes", 0.0)),
            unknown_inputs=int(state.get("unknown_inputs", 0)),
            input=input or {},
        )


_SPECIALS = {"$minutes", "$phase", "$actions_count", "$problems_count", "$unknown_inputs"}


def _lookup(ctx: EvalContext, name: str, default: Any = None) -> Any:
    if not isinstance(name, str):
        raise ConditionError("var name must be a string")
    if name.startswith("$input"):
        rest = name[len("$input"):].lstrip(".")
        value: Any = ctx.input
        for part in rest.split(".") if rest else []:
            value = _child(value, part)
            if value is None:
                return default
        return value if value is not None else default
    if name == "$minutes":
        return ctx.minutes
    if name == "$phase":
        return ctx.phase
    if name == "$actions_count":
        return sum(ctx.action_counts.values())
    if name == "$problems_count":
        return len(ctx.problems)
    if name == "$unknown_inputs":
        return ctx.unknown_inputs
    value = ctx.variables
    for part in name.split("."):
        value = _child(value, part)
        if value is None:
            return default
    return value


def _child(value: Any, part: str) -> Any:
    if isinstance(value, dict):
        return value.get(part)
    if isinstance(value, list) and part.isdigit():
        idx = int(part)
        return value[idx] if idx < len(value) else None
    return None


def _args(raw: Any, n: int | None = None, op: str = "") -> list[Any]:
    args = raw if isinstance(raw, list) else [raw]
    if n is not None and len(args) != n:
        raise ConditionError(f"'{op}' expects {n} arguments")
    return args


def _compare(op: str, a: Any, b: Any) -> bool:
    if op == "==":
        return bool(a == b)
    if op == "!=":
        return bool(a != b)
    try:
        if op == "<":
            return bool(a < b)
        if op == "<=":
            return bool(a <= b)
        if op == ">":
            return bool(a > b)
        return bool(a >= b)
    except TypeError:
        return False


def _norm_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).lower()


class _Evaluator:
    def __init__(self, ctx: EvalContext) -> None:
        self.ctx = ctx
        self.nodes = 0

    def ev(self, cond: Any, depth: int = 0) -> Any:
        self.nodes += 1
        if depth > MAX_DEPTH:
            raise ConditionError("condition nested too deeply")
        if self.nodes > MAX_NODES:
            raise ConditionError("condition too large")
        if cond is None or isinstance(cond, bool | int | float | str):
            return cond
        if isinstance(cond, list):
            return [self.ev(c, depth + 1) for c in cond]
        if not isinstance(cond, dict):
            raise ConditionError(f"unsupported condition value: {type(cond).__name__}")
        if len(cond) != 1:
            raise ConditionError("condition objects must have exactly one operator key")
        op, raw = next(iter(cond.items()))
        handler = _OPS.get(op)
        if handler is None:
            raise ConditionError(f"unknown operator '{op}'")
        return handler(self, raw, depth + 1)


def _op_and(e: _Evaluator, raw: Any, d: int) -> Any:
    result: Any = True
    for c in _args(raw):
        result = e.ev(c, d)
        if not result:
            return result
    return result


def _op_or(e: _Evaluator, raw: Any, d: int) -> Any:
    result: Any = False
    for c in _args(raw):
        result = e.ev(c, d)
        if result:
            return result
    return result


def _op_not(e: _Evaluator, raw: Any, d: int) -> bool:
    args = _args(raw)
    if len(args) != 1:
        raise ConditionError("'not' expects 1 argument")
    return not e.ev(args[0], d)


def _cmp(op: str):  # noqa: ANN202
    def handler(e: _Evaluator, raw: Any, d: int) -> bool:
        a, b = _args(raw, 2, op)
        return _compare(op, e.ev(a, d), e.ev(b, d))

    return handler


def _op_in(e: _Evaluator, raw: Any, d: int) -> bool:
    a, b = _args(raw, 2, "in")
    needle, hay = e.ev(a, d), e.ev(b, d)
    if isinstance(hay, str):
        return isinstance(needle, str) and needle in hay
    if isinstance(hay, list | tuple | set | dict):
        try:
            return needle in hay
        except TypeError:
            return False
    return False


def _num(v: Any) -> float:
    if isinstance(v, bool):
        return float(v)
    if isinstance(v, int | float):
        return float(v)
    return 0.0


def _op_add(e: _Evaluator, raw: Any, d: int) -> float:
    return sum(_num(e.ev(c, d)) for c in _args(raw))


def _op_sub(e: _Evaluator, raw: Any, d: int) -> float:
    args = [_num(e.ev(c, d)) for c in _args(raw)]
    if not args:
        return 0.0
    if len(args) == 1:
        return -args[0]
    return args[0] - sum(args[1:])


def _op_var(e: _Evaluator, raw: Any, d: int) -> Any:
    if isinstance(raw, list):
        if not raw or len(raw) > 2:
            raise ConditionError("'var' expects a name or [name, default]")
        name = e.ev(raw[0], d)
        default = e.ev(raw[1], d) if len(raw) == 2 else None
        return _lookup(e.ctx, name, default)
    return _lookup(e.ctx, e.ev(raw, d))


def _op_has_fact(e: _Evaluator, raw: Any, d: int) -> bool:
    return e.ev(raw, d) in e.ctx.facts


def _op_phase_is(e: _Evaluator, raw: Any, d: int) -> bool:
    v = e.ev(raw, d)
    return e.ctx.phase in v if isinstance(v, list) else e.ctx.phase == v


def _op_visited(e: _Evaluator, raw: Any, d: int) -> bool:
    return e.ev(raw, d) in e.ctx.visited_phases


def _op_action_taken(e: _Evaluator, raw: Any, d: int) -> bool:
    v = e.ev(raw, d)
    if isinstance(v, list):
        if len(v) != 2:
            raise ConditionError("'action_taken' expects an id or [id, min_times]")
        return e.ctx.action_counts.get(str(v[0]), 0) >= _num(v[1])
    return e.ctx.action_counts.get(str(v), 0) > 0


def _op_count(e: _Evaluator, raw: Any, d: int) -> int:
    if isinstance(raw, str):
        return e.ctx.action_counts.get(raw, 0)
    v = e.ev(raw, d)
    if isinstance(v, str):
        return e.ctx.action_counts.get(v, 0)
    if isinstance(v, list | dict):
        return len(v)
    return 0


def _op_event_fired(e: _Evaluator, raw: Any, d: int) -> bool:
    return e.ctx.fired_events.get(str(e.ev(raw, d)), 0) > 0


def _op_has_problem(e: _Evaluator, raw: Any, d: int) -> bool:
    return e.ev(raw, d) in e.ctx.problems


def _op_contains(e: _Evaluator, raw: Any, d: int) -> bool:
    a, b = _args(raw, 2, "contains")
    hay, needle = e.ev(a, d), e.ev(b, d)
    if isinstance(hay, str):
        return _norm_text(needle) in _norm_text(hay)
    if isinstance(hay, list):
        return needle in hay
    return False


def _op_count_keywords(e: _Evaluator, raw: Any, d: int) -> int:
    a, b = _args(raw, 2, "count_keywords")
    text, keywords = _norm_text(e.ev(a, d)), e.ev(b, d)
    if not isinstance(keywords, list):
        raise ConditionError("'count_keywords' expects a keyword list")
    found = 0
    for kw in keywords:
        alts = kw if isinstance(kw, list) else [kw]  # a list entry = synonyms counted once
        if any(re.search(r"(?<![a-z0-9])" + re.escape(_norm_text(alt)), text) for alt in alts):
            found += 1
    return found


_OPS = {
    "and": _op_and, "or": _op_or, "not": _op_not, "!": _op_not,
    "==": _cmp("=="), "!=": _cmp("!="), "<": _cmp("<"), "<=": _cmp("<="), ">": _cmp(">"), ">=": _cmp(">="),
    "in": _op_in, "+": _op_add, "-": _op_sub, "var": _op_var,
    "has_fact": _op_has_fact, "phase_is": _op_phase_is, "visited_phase": _op_visited,
    "action_taken": _op_action_taken, "count": _op_count, "event_fired": _op_event_fired,
    "has_problem": _op_has_problem, "contains": _op_contains, "count_keywords": _op_count_keywords,
}
OPERATORS = frozenset(_OPS)


def evaluate(cond: Any, ctx: EvalContext) -> Any:
    """Evaluate a condition and return its raw value."""
    return _Evaluator(ctx).ev(cond)


def truthy(cond: Any, ctx: EvalContext) -> bool:
    """Evaluate a condition as a boolean; ``None`` (absent condition) is true."""
    if cond is None:
        return True
    return bool(evaluate(cond, ctx))


# ---------------------------------------------------------------------------------------------- static analysis

_REF_OPS = {"has_fact": "facts", "phase_is": "phases", "visited_phase": "phases", "action_taken": "actions",
            "event_fired": "events", "has_problem": "problems"}


def check_condition(cond: Any) -> tuple[list[str], dict[str, set[str]]]:
    """Statically check a condition. Returns (errors, references by kind: variables/facts/phases/actions/
    events/problems) so the validator can detect unknown references."""
    errors: list[str] = []
    refs: dict[str, set[str]] = {k: set() for k in ("variables", "facts", "phases", "actions", "events",
                                                     "problems")}
    nodes = 0

    def walk(c: Any, depth: int) -> None:
        nonlocal nodes
        nodes += 1
        if depth > MAX_DEPTH or nodes > MAX_NODES:
            errors.append("condition too deep or too large")
            return
        if c is None or isinstance(c, bool | int | float | str):
            return
        if isinstance(c, list):
            for x in c:
                walk(x, depth + 1)
            return
        if not isinstance(c, dict):
            errors.append(f"unsupported value type {type(c).__name__}")
            return
        if len(c) != 1:
            errors.append("condition objects must have exactly one operator key")
            return
        op, raw = next(iter(c.items()))
        if op not in OPERATORS:
            errors.append(f"unknown operator '{op}'")
            return
        if op == "var":
            name = raw[0] if isinstance(raw, list) and raw else raw
            if isinstance(name, str):
                if not name.startswith("$"):
                    refs["variables"].add(name.split(".")[0])
                elif name.split(".")[0] not in _SPECIALS | {"$input"}:
                    errors.append(f"unknown special variable '{name}'")
            else:
                walk(name, depth + 1)
            return
        if op in _REF_OPS:
            target = raw[0] if op == "action_taken" and isinstance(raw, list) and raw else raw
            if isinstance(target, str):
                refs[_REF_OPS[op]].add(target)
            elif isinstance(target, list) and op == "phase_is":
                refs["phases"].update(t for t in target if isinstance(t, str))
            else:
                walk(target, depth + 1)
            return
        if op == "count" and isinstance(raw, str):
            refs["actions"].add(raw)
            return
        walk(raw, depth + 1)

    walk(cond, 0)
    return errors, refs
