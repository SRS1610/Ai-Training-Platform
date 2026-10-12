"""Tolerant JSON extraction/repair for model output."""

from __future__ import annotations

import ast
import json
import re
from typing import Any

_FENCE = re.compile(r"```(?:json|JSON)?\s*(.*?)```", re.S)
_TRAILING_COMMA = re.compile(r",\s*([}\]])")


def _balanced_object(text: str) -> str | None:
    start = None
    depth = 0
    in_str = False
    esc = False
    for i, ch in enumerate(text):
        if start is None:
            if ch in "{[":
                start = i
                depth = 1
            continue
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch in "{[":
            depth += 1
        elif ch in "}]":
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
    if start is not None:
        # Truncated output: close open brackets naively.
        frag = text[start:]
        if in_str:
            frag += '"'
        stack: list[str] = []
        in_s = False
        e = False
        for ch in frag:
            if in_s:
                if e:
                    e = False
                elif ch == "\\":
                    e = True
                elif ch == '"':
                    in_s = False
                continue
            if ch == '"':
                in_s = True
            elif ch in "{[":
                stack.append("}" if ch == "{" else "]")
            elif ch in "}]" and stack:
                stack.pop()
        closers = "".join(reversed(stack))
        return re.sub(r",\s*$", "", frag.rstrip()) + closers
    return None


def parse_json(text: str) -> Any:
    """Parse JSON from model output: strips code fences/prose, repairs trailing commas, Python literals and
    truncated brackets. Raises ``ValueError`` when nothing usable is found."""
    if text is None:
        raise ValueError("empty output")
    candidates = [text.strip()]
    candidates += [m.strip() for m in _FENCE.findall(text)]
    obj = _balanced_object(text)
    if obj:
        candidates.append(obj)
    for cand in candidates:
        if not cand:
            continue
        for variant in (cand, _TRAILING_COMMA.sub(r"\1", cand)):
            try:
                return json.loads(variant)
            except (json.JSONDecodeError, ValueError):
                pass
            try:
                value = ast.literal_eval(variant.replace("true", "True").replace("false", "False")
                                         .replace("null", "None"))
                if isinstance(value, dict | list):
                    return value
            except (ValueError, SyntaxError, MemoryError, RecursionError):
                pass
    raise ValueError("no JSON object found in model output")


def parse_json_object(text: str) -> dict[str, Any]:
    value = parse_json(text)
    if isinstance(value, list) and len(value) == 1 and isinstance(value[0], dict):
        value = value[0]
    if not isinstance(value, dict):
        raise ValueError("expected a JSON object")
    return value
