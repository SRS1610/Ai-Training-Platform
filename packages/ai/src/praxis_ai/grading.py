"""Explainable heuristic grading (Offline provider + fallback when an LLM is unavailable).

Scores each rubric criterion by how well the submission covers the criterion's vocabulary (name,
description, level descriptors) and the reference solution, quotes the best-matching submission sentences
as evidence, and lists strengths, weaknesses, missing requirements and improvements. Confidence is kept low
(≤ 0.5) so platforms can route heuristic grades to human review.
"""

from __future__ import annotations

import re
from typing import Any

from praxis_ai.text import overlap, sentences, tokenize

_GENERIC = set(
    tokenize(
        "demonstrate demonstrated clearly correct correctly partially missing not exemplary "
        "proficient developing "
        "thorough thoroughly insight level score criterion criteria learner "
        "student submission answer good poor "
        "excellent quality appropriate relevant includes include provides provide shows show well"
    )
)


def _terms(*texts: str) -> list[str]:
    seen: dict[str, None] = {}
    for t in texts:
        for tok in tokenize(t or ""):
            if tok not in _GENERIC and len(tok) > 2:
                seen.setdefault(tok, None)
    return list(seen)


def _best_sentences(text: str, terms: list[str], k: int = 2) -> list[str]:
    ss = sentences(text)
    scored = sorted(((overlap(terms, s), i, s) for i, s in enumerate(ss)), key=lambda x: (-x[0], x[1]))
    return [s[:240] for sc, _, s in scored[:k] if sc > 0]


def _length_factor(text: str) -> float:
    n = len(re.findall(r"\w+", text or ""))
    if n == 0:
        return 0.0
    if n < 25:
        return 0.55
    if n < 60:
        return 0.8
    return 1.0


def _criterion_max(c: dict[str, Any]) -> float:
    levels = c.get("levels") or []
    scores = [float(lv.get("score", 0)) for lv in levels if isinstance(lv, dict)]
    if scores and max(scores) > 0:
        return max(scores)
    return float(c.get("max_points") or c.get("points") or 10.0)


def heuristic_grade_submission(assignment: dict[str, Any], submission_text: str) -> dict[str, Any]:
    criteria = (assignment.get("rubric") or {}).get("criteria") or assignment.get("criteria") or []
    if not criteria:
        criteria = [
            {
                "id": "overall",
                "name": "Overall quality",
                "description": " ".join(
                    str(assignment.get(k) or "") for k in ("objective", "instructions", "evaluation_criteria")
                ),
                "weight": 1.0,
            }
        ]
    reference = str(assignment.get("expected_output") or "")
    ref_terms = _terms(reference)
    lf = _length_factor(submission_text)
    breakdown: list[dict[str, Any]] = []
    weighted = 0.0
    total_w = 0.0
    strengths: list[str] = []
    weaknesses: list[str] = []
    improvements: list[str] = []
    for c in criteria:
        name = str(c.get("name") or c.get("id") or "Criterion")
        desc = str(c.get("description") or "")
        level_text = " ".join(
            str(lv.get("description", "")) for lv in (c.get("levels") or []) if isinstance(lv, dict)
        )
        terms = _terms(name, desc, level_text)
        cov = overlap(terms, submission_text) if terms else 0.0
        ref_cov = 0.0
        if ref_terms:
            related = [
                t for t in ref_terms if t in set(_terms(desc, name)) or overlap([t], desc) > 0
            ] or ref_terms
            ref_cov = overlap(related, submission_text)
        frac = min(1.0, 0.1 + 1.6 * max(cov, 0.6 * cov + 0.4 * ref_cov)) * lf
        if not submission_text.strip():
            frac = 0.0
        cmax = _criterion_max(c)
        score = round(frac * cmax, 2)
        evidence = _best_sentences(submission_text, terms + ref_terms[:10])
        if frac >= 0.7:
            comment = f"Strong: the submission addresses {name.lower()} with relevant detail."
            strengths.append(f"{name}: well demonstrated.")
        elif frac >= 0.4:
            comment = f"Partially addressed: {name.lower()} is covered but lacks depth or specifics."
            improvements.append(
                f"Add more specific detail on {name.lower()}" + (f" — {desc}" if desc else ".")
            )
        else:
            comment = f"Weak or missing: little evidence of {name.lower()}."
            weaknesses.append(f"{name}: little or no evidence.")
            improvements.append(f"Address {name.lower()} directly" + (f": {desc}" if desc else "."))
        weight = float(c.get("weight") or 1.0)
        weighted += weight * frac
        total_w += weight
        breakdown.append(
            {
                "criterion_id": str(c.get("id") or name),
                "name": name,
                "score": score,
                "max": cmax,
                "weight": weight,
                "evidence": evidence,
                "comment": comment,
            }
        )

    missing: list[str] = []
    provided = set(assignment.get("provided_evidence") or [])
    for ev in assignment.get("required_evidence") or []:
        if not isinstance(ev, dict) or not ev.get("required"):
            continue
        if ev.get("type") in (None, "text", "structured"):
            if not submission_text.strip():
                missing.append(f"Missing required evidence: {ev.get('label') or ev.get('id')}")
        elif provided is not None and str(ev.get("id")) not in provided:
            missing.append(f"Missing required evidence: {ev.get('label') or ev.get('id')}")
    steps = [
        s.strip()
        for s in re.split(r"\n\s*(?:\d+[.)]|-)\s*", "\n" + str(assignment.get("instructions") or ""))
        if s.strip()
    ]
    for step in steps[:8]:
        st = _terms(step)
        if len(st) >= 2 and overlap(st, submission_text) < 0.2:
            missing.append(f"Instruction not clearly addressed: {step[:120]}")

    pct = round(100.0 * weighted / total_w, 1) if total_w else 0.0
    if missing:
        pct = round(pct * max(0.6, 1 - 0.1 * len(missing)), 1)
    band = "strong" if pct >= 80 else "solid" if pct >= 65 else "developing" if pct >= 40 else "insufficient"
    summary = (
        f"Overall a {band} submission ({pct:.0f}/100). "
        + (f"Strengths: {', '.join(s.split(':')[0] for s in strengths[:3])}. " if strengths else "")
        + (
            f"Focus next on: {', '.join(w.split(':')[0] for w in weaknesses[:3])}."
            if weaknesses
            else "Keep building depth and specific evidence."
        )
    )
    return {
        "criteria": breakdown,
        "strengths": strengths,
        "weaknesses": weaknesses,
        "missing_requirements": missing,
        "improvements": improvements[:6],
        "summary": summary,
        "confidence": 0.45 if submission_text.strip() else 0.9,
        "score": pct,
    }


def heuristic_grade_answer(question: dict[str, Any], answer_text: str) -> dict[str, Any]:
    reference = " ".join(str(question.get(k) or "") for k in ("reference", "model_answer", "explanation"))
    accepted = question.get("accepted") or []
    rubric_text = " ".join(
        f"{c.get('name', '')} {c.get('description', '')}"
        for c in question.get("criteria") or []
        if isinstance(c, dict)
    )
    ans = answer_text or ""
    if not ans.strip():
        return {
            "score_fraction": 0.0,
            "feedback": "No answer was provided.",
            "strengths": [],
            "improvements": ["Provide an answer that addresses the question."],
            "evidence": [],
            "confidence": 0.9,
        }
    if accepted and any(str(a).lower() in ans.lower() for a in accepted):
        frac = 1.0
    else:
        terms = _terms(reference, rubric_text) or _terms(str(question.get("prompt") or ""))
        cov = overlap(terms, ans)
        frac = min(1.0, 0.1 + 1.5 * cov) * _length_factor(ans)
    frac = round(frac, 3)
    terms = _terms(reference, rubric_text, str(question.get("prompt") or ""))
    covered = [t for t in terms if t in set(tokenize(ans))]
    missing = [t for t in terms if t not in set(covered)][:5]
    feedback = (
        "Strong answer covering the key points."
        if frac >= 0.75
        else "Partially correct: some key points are covered."
        if frac >= 0.4
        else "The answer misses most of the key points."
    )
    return {
        "score_fraction": frac,
        "feedback": feedback,
        "strengths": [f"Mentions {', '.join(covered[:4])}"] if covered else [],
        "improvements": [f"Also address: {', '.join(missing)}"] if missing and frac < 0.9 else [],
        "evidence": _best_sentences(ans, terms, 2),
        "confidence": 0.4,
    }
