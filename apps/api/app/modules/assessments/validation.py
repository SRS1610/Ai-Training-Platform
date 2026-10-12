"""Pure per-type validation of question ``options`` / ``answer_key`` (see ``grading`` for the formats)."""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any

from app.modules.assessments.grading import ALL_TYPES, MAX_PATTERN_LEN, decision_tree_max


def _id_list(items: Any, label: str, errors: list[str], *, min_len: int = 1) -> list[str]:
    if not isinstance(items, list) or len(items) < min_len:
        errors.append(f"options.{label} must be a list with at least {min_len} entries")
        return []
    ids: list[str] = []
    for i, item in enumerate(items):
        if not isinstance(item, Mapping) or item.get("id") in (None, "") or not str(item.get("text", "")).strip():
            errors.append(f"options.{label}[{i}] needs a non-empty 'id' and 'text'")
            continue
        ids.append(str(item["id"]))
    if len(set(ids)) != len(ids):
        errors.append(f"options.{label} ids must be unique")
    return ids


def _text_spec(spec: Any, where: str, errors: list[str]) -> None:
    if not isinstance(spec, Mapping):
        errors.append(f"{where} must be an object")
        return
    accepted = spec.get("accepted") or []
    if not isinstance(accepted, list) or not all(isinstance(a, str | int | float) for a in accepted):
        errors.append(f"{where}.accepted must be a list of strings")
        accepted = []
    regex = spec.get("regex")
    if regex:
        if not isinstance(regex, str) or len(regex) > MAX_PATTERN_LEN:
            errors.append(f"{where}.regex must be a string of at most {MAX_PATTERN_LEN} characters")
        else:
            try:
                re.compile(regex)
            except re.error as exc:
                errors.append(f"{where}.regex is invalid: {exc}")
    if not accepted and not regex:
        errors.append(f"{where} needs at least one accepted answer or a regex")


def validate_question(qtype: str, options: Mapping[str, Any] | None, answer_key: Mapping[str, Any] | None,
                      *, points: float = 1.0, negative_points: float = 0.0) -> list[str]:
    """Return a list of human-readable problems (empty when valid)."""
    errors: list[str] = []
    opts = options or {}
    key = answer_key or {}
    if qtype not in ALL_TYPES:
        return [f"Unknown question type '{qtype}'"]
    if points < 0:
        errors.append("points must be >= 0")
    if negative_points < 0:
        errors.append("negative_points must be >= 0 (it is subtracted)")

    if qtype in {"multiple_choice", "multiple_select"}:
        ids = set(_id_list(opts.get("choices"), "choices", errors, min_len=2))
        if qtype == "multiple_choice":
            cid = key.get("choice_id")
            if cid is None and isinstance(key.get("choice_ids"), list) and len(key["choice_ids"]) == 1:
                cid = key["choice_ids"][0]
            if cid is None or str(cid) not in ids:
                errors.append("answer_key.choice_id must reference one of the choices")
        else:
            cids = key.get("choice_ids")
            if not isinstance(cids, list) or not cids:
                errors.append("answer_key.choice_ids must be a non-empty list")
            elif not {str(c) for c in cids} <= ids:
                errors.append("answer_key.choice_ids must reference existing choices")
    elif qtype == "true_false":
        if not isinstance(key.get("value"), bool):
            errors.append("answer_key.value must be true or false")
    elif qtype == "short_answer":
        _text_spec(key, "answer_key", errors)
    elif qtype == "matching":
        left = set(_id_list(opts.get("left"), "left", errors))
        right = set(_id_list(opts.get("right"), "right", errors))
        pairs = key.get("pairs")
        if not isinstance(pairs, Mapping) or not pairs:
            errors.append("answer_key.pairs must map every left id to a right id")
        else:
            if set(map(str, pairs)) != left:
                errors.append("answer_key.pairs must cover exactly the left items")
            if not {str(v) for v in pairs.values()} <= right:
                errors.append("answer_key.pairs values must reference right items")
    elif qtype == "ordering":
        ids = _id_list(opts.get("items"), "items", errors, min_len=2)
        order = key.get("order")
        if not isinstance(order, list) or sorted(map(str, order)) != sorted(ids):
            errors.append("answer_key.order must be a permutation of the item ids")
        if key.get("scoring", "positions") not in {"positions", "kendall", "all_or_nothing"}:
            errors.append("answer_key.scoring must be positions, kendall or all_or_nothing")
    elif qtype == "fill_blank":
        blanks = opts.get("blanks")
        ids = [str(b.get("id")) for b in blanks if isinstance(b, Mapping)] if isinstance(blanks, list) else []
        if not ids:
            errors.append("options.blanks must list at least one blank {id}")
        specs = key.get("blanks")
        if not isinstance(specs, Mapping) or set(map(str, specs)) != set(ids):
            errors.append("answer_key.blanks must define accepted answers for every blank")
        else:
            for bid, spec in specs.items():
                _text_spec(spec, f"answer_key.blanks.{bid}", errors)
    elif qtype == "decision_tree":
        nodes = opts.get("nodes")
        start = opts.get("start")
        if not isinstance(nodes, Mapping) or not nodes:
            errors.append("options.nodes must be a non-empty object")
        elif str(start) not in nodes:
            errors.append("options.start must reference a node")
        else:
            for nid, node in nodes.items():
                choices = node.get("choices") if isinstance(node, Mapping) else None
                if not isinstance(choices, list) or not choices:
                    errors.append(f"options.nodes.{nid} needs choices")
                    continue
                for c in choices:
                    if not isinstance(c, Mapping) or c.get("id") in (None, ""):
                        errors.append(f"options.nodes.{nid} choices need ids")
                    elif c.get("next") and str(c["next"]) not in nodes:
                        errors.append(f"options.nodes.{nid}.{c['id']} points to unknown node {c['next']}")
            pts = key.get("points")
            if not isinstance(pts, Mapping):
                errors.append("answer_key.points must map node -> choice -> points")
            elif not errors and decision_tree_max(opts, pts) <= 0 and not key.get("max_points"):
                errors.append("decision tree has no scoring path (all points are zero)")
    elif qtype == "code":
        cases = key.get("test_cases", [])
        if not isinstance(cases, list):
            errors.append("answer_key.test_cases must be a list")
        else:
            for i, tc in enumerate(cases):
                if not isinstance(tc, Mapping) or not isinstance(tc.get("pattern"), str):
                    errors.append(f"answer_key.test_cases[{i}].pattern must be a string")
                    continue
                if tc.get("match", "contains") not in {"contains", "regex", "not_contains", "exact"}:
                    errors.append(f"answer_key.test_cases[{i}].match is invalid")
                if tc.get("match") == "regex":
                    try:
                        re.compile(tc["pattern"][:MAX_PATTERN_LEN])
                    except re.error as exc:
                        errors.append(f"answer_key.test_cases[{i}].pattern is not a valid regex: {exc}")
            if key.get("auto_grade") and not cases:
                errors.append("answer_key.auto_grade requires test_cases")
    elif qtype == "simulation":
        if not opts.get("simulation_id"):
            errors.append("options.simulation_id is required")
    return errors
