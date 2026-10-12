"""Pure helpers for assignments: rubric validation & scoring, evidence checks, content hashing, similarity."""

from __future__ import annotations

import hashlib
import json
import re
import uuid
from collections import Counter
from collections.abc import Iterable, Mapping, Sequence
from typing import Any

WEIGHT_TOLERANCE = 0.01
SIMILARITY_THRESHOLD = 0.6
SHINGLE_SIZE = 5
FILE_EVIDENCE_TYPES = {"file", "screenshot", "video", "audio", "document"}
CODE_EXTENSIONS = {".py", ".js", ".ts", ".sql", ".json", ".md", ".txt", ".log", ".csv"}


# ----------------------------------------------------------------------------- rubrics


def criterion_max(criterion: Mapping[str, Any]) -> float:
    levels = criterion.get("levels") or []
    if levels:
        return max(float(level.get("score", 0) or 0) for level in levels)
    return float(criterion.get("max_score") or 10.0)


def normalise_criteria(criteria: Sequence[Mapping[str, Any]]) -> tuple[list[dict[str, Any]], list[str]]:
    """Assign missing ids, compute ``max_score`` and validate weights (must sum to 100)."""
    errors: list[str] = []
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    if not criteria:
        errors.append("A rubric needs at least one criterion")
    for i, c in enumerate(criteria):
        cid = str(c.get("id") or uuid.uuid4().hex[:12])
        if cid in seen:
            errors.append(f"criteria[{i}].id '{cid}' is duplicated")
        seen.add(cid)
        weight = float(c.get("weight", 0) or 0)
        if weight <= 0:
            errors.append(f"criteria[{i}].weight must be > 0")
        levels = [dict(level) for level in (c.get("levels") or [])]
        for j, level in enumerate(levels):
            if float(level.get("score", -1)) < 0:
                errors.append(f"criteria[{i}].levels[{j}].score must be >= 0")
        levels.sort(key=lambda lv: float(lv.get("score", 0)))
        entry = {**dict(c), "id": cid, "weight": weight, "levels": levels}
        entry["max_score"] = criterion_max(entry)
        if entry["max_score"] <= 0:
            errors.append(f"criteria[{i}] needs a positive maximum score")
        out.append(entry)
    total = sum(c["weight"] for c in out)
    if out and abs(total - 100.0) > WEIGHT_TOLERANCE:
        errors.append(f"Criterion weights must sum to 100 (got {total:g})")
    return out, errors


def score_rubric(
    criteria: Sequence[Mapping[str, Any]], scores: Sequence[Mapping[str, Any]]
) -> tuple[float, list[dict[str, Any]], list[str]]:
    """Weighted rubric percentage (0-100). Returns (percentage, breakdown, errors)."""
    errors: list[str] = []
    by_id = {str(s.get("criterion_id")): s for s in scores}
    unknown = set(by_id) - {str(c["id"]) for c in criteria}
    if unknown:
        errors.append(f"Unknown criteria: {', '.join(sorted(unknown))}")
    total_weight = sum(float(c.get("weight", 0)) for c in criteria) or 100.0
    pct = 0.0
    breakdown: list[dict[str, Any]] = []
    for c in criteria:
        cid = str(c["id"])
        cmax = float(c.get("max_score") or criterion_max(c))
        given = by_id.get(cid)
        if given is None:
            errors.append(f"Criterion '{c.get('name', cid)}' has no score")
            continue
        score = float(given.get("score", 0))
        if score < 0 or score > cmax + 1e-9:
            errors.append(f"Criterion '{c.get('name', cid)}' score must be between 0 and {cmax:g}")
            continue
        weight = float(c.get("weight", 0))
        pct += weight / total_weight * (score / cmax) * 100.0
        breakdown.append(
            {
                "criterion_id": cid,
                "name": c.get("name"),
                "score": score,
                "max": cmax,
                "weight": weight,
                "comment": given.get("comment"),
                "evidence": given.get("evidence"),
            }
        )
    return round(pct, 2), breakdown, errors


# ----------------------------------------------------------------------------- evidence


def file_category(content_type: str, filename: str = "") -> str:
    ct = (content_type or "").lower()
    if ct.startswith("image/"):
        return "screenshot"
    if ct.startswith("video/"):
        return "video"
    if ct.startswith("audio/"):
        return "audio"
    return "document"


def _answered(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, list | dict):
        return bool(value)
    return True


def missing_evidence(
    required: Sequence[Mapping[str, Any]],
    structured_fields: Sequence[Mapping[str, Any]],
    *,
    text: str | None,
    code: str | None,
    structured: Mapping[str, Any],
    files: Sequence[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    """List required evidence items the version does not satisfy.

    ``files``: ``[{"content_type", "filename"}]``. File-type evidence is satisfied by counting files of the
    matching category (``file`` accepts any file); N required items of a category need N files.
    """
    missing: list[dict[str, Any]] = []
    cats = Counter(file_category(f.get("content_type", ""), f.get("filename", "")) for f in files)
    has_code_file = any(
        ("." + str(f.get("filename", "")).rsplit(".", 1)[-1].lower()) in CODE_EXTENSIONS
        for f in files
        if "." in str(f.get("filename", ""))
    )
    pending_files: dict[str, list[Mapping[str, Any]]] = {}
    for ev in required:
        if not ev.get("required", True):
            continue
        etype = str(ev.get("type", "text"))
        if etype == "text":
            ok = _answered(text)
        elif etype == "code":
            ok = _answered(code) or has_code_file
        elif etype == "structured":
            fields = [f for f in structured_fields if f.get("required", True)]
            ok = (
                all(_answered(structured.get(str(f.get("id")))) for f in fields)
                if fields
                else _answered(structured)
            )
        elif etype in FILE_EVIDENCE_TYPES:
            pending_files.setdefault(etype, []).append(ev)
            continue
        else:
            ok = True
        if not ok:
            missing.append({"id": ev.get("id"), "label": ev.get("label"), "type": etype})
    for etype, items in pending_files.items():
        available = len(files) if etype == "file" else cats.get(etype, 0)
        for ev in items[available:]:
            missing.append({"id": ev.get("id"), "label": ev.get("label"), "type": etype})
    return missing


def content_sha256(
    text: str | None, code: str | None, structured: Mapping[str, Any], file_hashes: Iterable[str]
) -> str:
    payload = json.dumps(
        {
            "text": text or "",
            "code": code or "",
            "structured": structured or {},
            "files": sorted(file_hashes),
        },
        sort_keys=True,
        default=str,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode()).hexdigest()


# ----------------------------------------------------------------------------- similarity

_WORD = re.compile(r"[a-z0-9]+")


def shingles(text: str, k: int = SHINGLE_SIZE) -> set[tuple[str, ...]]:
    words = _WORD.findall((text or "").lower())
    if len(words) < k:
        return set()
    return {tuple(words[i : i + k]) for i in range(len(words) - k + 1)}


def jaccard(a: set[Any], b: set[Any]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)
