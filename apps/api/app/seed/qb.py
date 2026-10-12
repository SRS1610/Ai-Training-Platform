"""Question builders (API payload format) and simulated learner answers.

Each builder returns a dict ready for ``POST /questions`` plus seeder-only keys prefixed with ``_`` (the
answers weaker learners tend to give), which are stripped before the API call.
"""

from __future__ import annotations

import random
import string
from typing import Any

_IDS = string.ascii_lowercase


def _q(
    qtype: str, prompt: str, options: dict[str, Any], key: dict[str, Any], explanation: str, **kw: Any
) -> dict[str, Any]:
    return {
        "question_type": qtype,
        "prompt": prompt,
        "options": options,
        "answer_key": key,
        "explanation": explanation,
        "points": kw.pop("points", 1.0),
        "difficulty": kw.pop("difficulty", 2),
        "tags": list(kw.pop("tags", [])),
        "_skills": list(kw.pop("skills", [])),
        **kw,
    }


def mc(prompt: str, choices: list[str], correct: int, explanation: str, **kw: Any) -> dict[str, Any]:
    """Multiple choice. ``choices[correct]`` is right; ``_distractor`` (default: first wrong) is the popular
    wrong answer so item analysis shows a realistic choice distribution."""
    opts = [{"id": _IDS[i], "text": t} for i, t in enumerate(choices)]
    distractor = kw.pop("distractor", next(i for i in range(len(choices)) if i != correct))
    return _q(
        "multiple_choice",
        prompt,
        {"choices": opts},
        {"choice_id": _IDS[correct]},
        explanation,
        _distractor=_IDS[distractor],
        **kw,
    )


def ms(prompt: str, choices: list[str], correct: set[int], explanation: str, **kw: Any) -> dict[str, Any]:
    opts = [{"id": _IDS[i], "text": t} for i, t in enumerate(choices)]
    return _q(
        "multiple_select",
        prompt,
        {"choices": opts},
        {"choice_ids": [_IDS[i] for i in sorted(correct)], "partial_credit": True},
        explanation,
        **kw,
    )


def tf(prompt: str, value: bool, explanation: str, **kw: Any) -> dict[str, Any]:
    return _q("true_false", prompt, {}, {"value": value}, explanation, **kw)


def sa(
    prompt: str,
    accepted: list[str],
    explanation: str,
    *,
    regex: str | None = None,
    wrong: str = "Not sure",
    **kw: Any,
) -> dict[str, Any]:
    key: dict[str, Any] = {"accepted": accepted, "case_sensitive": False}
    if regex:
        key["regex"] = regex
    return _q("short_answer", prompt, {}, key, explanation, _wrong=wrong, **kw)


def match(prompt: str, pairs: list[tuple[str, str]], explanation: str, **kw: Any) -> dict[str, Any]:
    left = [{"id": f"l{i + 1}", "text": a} for i, (a, _) in enumerate(pairs)]
    right = [{"id": f"r{i + 1}", "text": b} for i, (_, b) in enumerate(pairs)]
    right = right[1:] + right[:1]  # authored order is not the answer order
    return _q(
        "matching",
        prompt,
        {"left": left, "right": right},
        {"pairs": {f"l{i + 1}": f"r{i + 1}" for i in range(len(pairs))}, "partial_credit": True},
        explanation,
        **kw,
    )


def order(prompt: str, items: list[str], explanation: str, **kw: Any) -> dict[str, Any]:
    ids = [f"s{i + 1}" for i in range(len(items))]
    shown = [{"id": ids[i], "text": items[i]} for i in range(len(items))]
    shown = shown[2:] + shown[:2]
    return _q("ordering", prompt, {"items": shown}, {"order": ids, "scoring": "positions"}, explanation, **kw)


def fill(prompt: str, text: str, blanks: dict[str, list[str]], explanation: str, **kw: Any) -> dict[str, Any]:
    return _q(
        "fill_blank",
        prompt,
        {"text": text, "blanks": [{"id": b} for b in blanks]},
        {
            "blanks": {b: {"accepted": acc, "case_sensitive": False} for b, acc in blanks.items()},
            "partial_credit": True,
        },
        explanation,
        **kw,
    )


def long(
    prompt: str, model_answer: str, keywords: list[str], explanation: str, *, good: str, weak: str, **kw: Any
) -> dict[str, Any]:
    kw.setdefault("points", 3.0)
    kw.setdefault("difficulty", 3)
    return _q(
        "long_answer",
        prompt,
        {"min_words": 40, "max_words": 400},
        {"model_answer": model_answer, "keywords": keywords},
        explanation,
        _good=good,
        _weak=weak,
        **kw,
    )


def api_payload(spec: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in spec.items() if not k.startswith("_")}


# ------------------------------------------------------------------------------------- answering


def respond(spec: dict[str, Any], correct: bool, rng: random.Random) -> dict[str, Any]:
    """A learner response for ``spec``: right, or a plausible mistake."""
    t, key, opts = spec["question_type"], spec["answer_key"], spec["options"]
    if t == "multiple_choice":
        if correct:
            return {"choice_id": key["choice_id"]}
        wrong = [c["id"] for c in opts["choices"] if c["id"] != key["choice_id"]]
        return {"choice_id": spec["_distractor"] if rng.random() < 0.65 else rng.choice(wrong)}
    if t == "multiple_select":
        right = list(key["choice_ids"])
        if correct:
            return {"choice_ids": right}
        wrong = [c["id"] for c in opts["choices"] if c["id"] not in right]
        picked = right[:-1] if len(right) > 1 and rng.random() < 0.6 else right
        return {"choice_ids": picked + ([rng.choice(wrong)] if wrong and rng.random() < 0.7 else [])}
    if t == "true_false":
        return {"value": key["value"] if correct else not key["value"]}
    if t == "short_answer":
        return {"text": key["accepted"][0] if correct else spec.get("_wrong", "Not sure")}
    if t == "matching":
        pairs = dict(key["pairs"])
        if not correct:
            ks = list(pairs)
            a, b = rng.sample(ks, 2)
            pairs[a], pairs[b] = pairs[b], pairs[a]
        return {"pairs": pairs}
    if t == "ordering":
        seq = list(key["order"])
        if not correct:
            i = rng.randrange(len(seq) - 1)
            seq[i], seq[i + 1] = seq[i + 1], seq[i]
        return {"order": seq}
    if t == "fill_blank":
        blanks = {b: s["accepted"][0] for b, s in key["blanks"].items()}
        if not correct:
            b = rng.choice(list(blanks))
            blanks[b] = "unsure"
        return {"blanks": blanks}
    if t == "long_answer":
        return {"text": spec["_good"] if correct else spec["_weak"]}
    return {}
