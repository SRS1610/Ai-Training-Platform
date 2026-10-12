"""Safety screens: prompt-injection heuristics, output leak screening and basic moderation.

All functions are deterministic and dependency-free; ``moderate_openai`` optionally calls the OpenAI
moderation endpoint for a second opinion.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

import httpx

from praxis_ai.text import normalise, tokenize

# --------------------------------------------------------------------------- prompt injection

_INJECTION_PATTERNS: list[tuple[str, str, float]] = [
    ("ignore_instructions", r"\b(ignore|disregard|forget|override|bypass)\b[^.\n]{0,40}\b(previous|prior|above|earlier|"
                            r"all|any|the|your|system)\b[^.\n]{0,30}\b(instructions?|prompts?|rules?|guidelines?|"
                            r"directions?|context)\b", 0.6),
    ("reveal_prompt", r"\b(reveal|show|print|repeat|output|display|leak|tell me)\b[^.\n]{0,40}\b(system|hidden|"
                      r"initial|secret|developer)\s+(prompt|instructions?|message|rules)\b", 0.6),
    ("role_override", r"\b(you are now|from now on,? you are|act as|pretend (to be|you are)|roleplay as|"
                      r"new persona|switch to)\b[^.\n]{0,60}\b(unrestricted|jailbroken|dan|developer mode|"
                      r"without (any )?(rules|restrictions|limits|filters)|evil|admin|root)\b", 0.6),
    ("jailbreak_terms", r"\b(jailbreak|dan mode|developer mode enabled|do anything now|no restrictions mode)\b", 0.5),
    ("answer_extraction", r"\b(give|tell|show|print|reveal|what (is|are))\b[^.\n]{0,30}\b(the )?(answer key|"
                          r"correct answers?|marking (key|scheme|guide)|model answer|solution key|"
                          r"expected output|root cause)\b", 0.35),
    ("fake_delimiters", r"(<<<\s*(end\s+)?(untrusted|data|system)|</?\s*(system|assistant|instructions?)\s*>|"
                        r"^\s*#{2,}\s*(system|assistant)\s*:?|\[/?(inst|system)\])", 0.5),
    ("grading_manipulation", r"\b(give (me|this( submission)?) (full|max(imum)?|100%?|perfect) (marks|score|points)|"
                             r"(grade|score|mark) (this|me) (as )?(100|full|perfect)|assessor,? (note|ignore))\b", 0.6),
    ("exfiltration", r"\b(api[_ ]?key|password|secret key|access token)\b[^.\n]{0,30}\b(print|show|send|reveal|"
                     r"output)\b|\b(print|show|send|reveal|output)\b[^.\n]{0,30}\b(api[_ ]?key|secret key|"
                     r"access token)\b", 0.5),
]
_COMPILED = [(name, re.compile(rx, re.I | re.M), w) for name, rx, w in _INJECTION_PATTERNS]


@dataclass
class InjectionResult:
    flagged: bool
    score: float
    matches: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {"flagged": self.flagged, "score": round(self.score, 2), "matches": self.matches}


def detect_injection(text: str, threshold: float = 0.5) -> InjectionResult:
    """Heuristic prompt-injection detector. Score is the capped sum of matched pattern weights."""
    if not text:
        return InjectionResult(False, 0.0)
    matches = [name for name, rx, _ in _COMPILED if rx.search(text)]
    score = min(1.0, sum(w for name, _, w in _COMPILED if name in matches))
    # Long runs of instruction-like imperatives aimed at the model are suspicious too.
    if re.search(r"\b(assistant|ai|model|chatgpt|claude|llm)\b[^.\n]{0,20}\b(must|should|will) now\b", text, re.I):
        matches.append("model_directive")
        score = min(1.0, score + 0.3)
    return InjectionResult(score >= threshold, score, matches)


# --------------------------------------------------------------------------- leak screening


@dataclass
class LeakResult:
    leaked: bool
    matches: list[str] = field(default_factory=list)
    redacted: str = ""


def _protected_ok(value: str) -> bool:
    n = normalise(value)
    return len(n) >= 4 and (len(n.split()) >= 2 or len(n) >= 6)


def screen_output(text: str, protected: list[str], *, overlap_threshold: float = 0.8,
                  redaction: str = "[withheld]") -> LeakResult:
    """Detect protected strings (answer keys, model answers, root causes) in model output.

    * exact match after normalisation (case, punctuation, whitespace) for strings ≥ 4 chars;
    * fuzzy match for longer protected statements (≥ 4 content words): ≥ ``overlap_threshold`` of their
      content terms appear inside a sliding window of the output.
    Returns the redacted output too (exact matches replaced)."""
    if not text or not protected:
        return LeakResult(False, [], text or "")
    norm_out = normalise(text)
    out_tokens = tokenize(text)
    redacted = text
    matches: list[str] = []
    for value in {p for p in protected if isinstance(p, str) and _protected_ok(p)}:
        n = normalise(value)
        hit = False
        if re.search(r"(?<!\w)" + re.escape(n) + r"(?!\w)", norm_out):
            hit = True
            # Redact (case-insensitive, tolerant of punctuation/whitespace differences).
            pattern = r"[\W_]*".join(re.escape(w) for w in n.split())
            redacted = re.sub(pattern, redaction, redacted, flags=re.I)
        else:
            terms = list(dict.fromkeys(tokenize(value)))
            if len(terms) >= 4 and out_tokens:
                window = max(len(terms) * 3, 12)
                tset = set(terms)
                for i in range(0, max(1, len(out_tokens) - window + 1)):
                    seg = set(out_tokens[i : i + window])
                    if len(tset & seg) / len(tset) >= overlap_threshold:
                        hit = True
                        break
        if hit:
            matches.append(value[:80])
    return LeakResult(bool(matches), matches, redacted)


# --------------------------------------------------------------------------- moderation

MODERATION_CATEGORIES: dict[str, list[str]] = {
    "self_harm": [r"\bkill myself\b", r"\bsuicid(e|al)\b", r"\bself[- ]harm\b", r"\bend my life\b",
                  r"\bwant to die\b", r"\bcut myself\b"],
    "violence": [r"\b(kill|murder|shoot|stab|bomb)\s+(him|her|them|you|people|everyone|my (boss|manager|teacher))\b",
                 r"\bhow to (make|build) (a )?(bomb|explosive|weapon)\b", r"\bmass shooting\b"],
    "hate": [r"\b(all|those) (\w+ )?(people|immigrants) (are|should be) (animals|vermin|exterminated)\b",
             r"\bethnic cleansing\b", r"\bgenocide (is|was) (good|justified)\b"],
    "sexual": [r"\b(explicit|graphic) sex(ual)?\b", r"\bporn(ography|ographic)?\b", r"\bnude (photos|images)\b"],
    "harassment": [r"\byou(\'re| are) (an? )?(idiot|moron|stupid|worthless)\b", r"\bi will (find|hurt) you\b"],
    "illegal": [r"\bhow to (hack|break) into\b", r"\bsteal (credit card|passwords?|identit(y|ies))\b",
                r"\b(buy|make|synthesi[sz]e) (meth|cocaine|heroin|fentanyl)\b", r"\bcredit card dump\b",
                r"\bwrite (a )?(ransomware|keylogger|malware)\b"],
}
_MOD = {cat: [re.compile(p, re.I) for p in pats] for cat, pats in MODERATION_CATEGORIES.items()}


@dataclass
class ModerationResult:
    flagged: bool
    categories: list[str] = field(default_factory=list)
    source: str = "keywords"

    def as_dict(self) -> dict[str, Any]:
        return {"flagged": self.flagged, "categories": self.categories, "source": self.source}


def moderate(text: str) -> ModerationResult:
    cats = [cat for cat, pats in _MOD.items() if any(p.search(text or "") for p in pats)]
    return ModerationResult(bool(cats), cats)


async def moderate_openai(text: str, *, api_key: str, base_url: str = "https://api.openai.com/v1",
                          model: str = "omni-moderation-latest", timeout: float = 15.0,
                          transport: httpx.AsyncBaseTransport | None = None) -> ModerationResult:
    """Second-opinion moderation via OpenAI ``POST /moderations``. Falls back to keyword moderation on error."""
    try:
        async with httpx.AsyncClient(timeout=timeout, transport=transport) as client:
            r = await client.post(f"{base_url.rstrip('/')}/moderations",
                                  headers={"Authorization": f"Bearer {api_key}"},
                                  json={"model": model, "input": text})
            r.raise_for_status()
            result = r.json()["results"][0]
        cats = sorted(k for k, v in (result.get("categories") or {}).items() if v)
        return ModerationResult(bool(result.get("flagged")), cats, "openai")
    except (httpx.HTTPError, KeyError, IndexError, ValueError):
        return moderate(text)
