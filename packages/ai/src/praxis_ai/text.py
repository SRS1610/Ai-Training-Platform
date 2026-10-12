"""Lightweight, dependency-free text utilities: tokenising, light stemming, sentence splitting, keyword
overlap and hashing-trick embeddings (used by the offline provider, safety screens and heuristics)."""

from __future__ import annotations

import hashlib
import math
import re
from collections import Counter

STOPWORDS = frozenset(
    """a about above after again against all am an and any are as at be because been before being below
    between both but by can could did do does doing down during each few for from further had has have
    having he her here hers herself him himself his how i if in into is it its itself just me more most my
    myself no nor not now of off on once only or other our ours ourselves out over own same she should so
    some such than that the their theirs them themselves then there these they this those through to too
    under until up very was we were what when where which while who whom why will with would you your
    yours yourself yourselves also may might must shall would get got make made use used using one two
    via per etc e.g i.e lets let's""".split()
)

_TOKEN = re.compile(r"[a-z0-9][a-z0-9_\-']*")
_SENT_SPLIT = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"'(\[])|\n{2,}|\n(?=\s*[-*•#]|\s*\d+[.)])")


def stem(word: str) -> str:
    """Very small suffix-stripping stemmer (good enough for overlap scoring, deterministic)."""
    w = word.strip("'-_")
    if len(w) <= 3:
        return w
    for suffix, repl in (("ational", "ate"), ("ization", "ize"), ("fulness", "ful"), ("iveness", "ive"),
                         ("ments", "ment"), ("ingly", ""), ("edly", ""), ("ies", "y"), ("ied", "y"),
                         ("sses", "ss"), ("ness", ""), ("ing", ""), ("ers", "er"), ("ed", ""), ("ly", ""),
                         ("es", ""), ("s", "")):
        if w.endswith(suffix) and len(w) - len(suffix) >= 3:
            if suffix == "s" and w.endswith(("ss", "us", "is")):
                continue
            return w[: len(w) - len(suffix)] + repl
    return w


def tokenize(text: str, *, keep_stopwords: bool = False) -> list[str]:
    toks = _TOKEN.findall((text or "").lower())
    out: list[str] = []
    for t in toks:
        if not keep_stopwords and (t in STOPWORDS or len(t) < 2):
            continue
        out.append(stem(t))
    return out


def keywords(text: str, limit: int = 12) -> list[str]:
    """Most frequent content terms (stemmed), stable order for ties."""
    counts = Counter(tokenize(text))
    return [w for w, _ in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:limit]]


def sentences(text: str) -> list[str]:
    parts = [p.strip(" \t-*•") for p in _SENT_SPLIT.split(text or "")]
    return [p for p in (re.sub(r"\s+", " ", p) for p in parts) if len(p) > 2]


def overlap(query: str | list[str], text: str | list[str]) -> float:
    """Fraction of distinct query terms present in text (0..1)."""
    q = set(tokenize(query) if isinstance(query, str) else query)
    if not q:
        return 0.0
    t = set(tokenize(text) if isinstance(text, str) else text)
    return len(q & t) / len(q)


def normalise(text: str) -> str:
    """Lowercase, collapse whitespace and strip punctuation — used for leak matching."""
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", (text or "").lower())).strip()


# --------------------------------------------------------------------------- hashing-trick embeddings


def _hash(feature: str, dim: int) -> tuple[int, float]:
    h = hashlib.blake2b(feature.encode("utf-8"), digest_size=8).digest()
    n = int.from_bytes(h, "little")
    return n % dim, (1.0 if (n >> 63) & 1 else -1.0)


def hash_embedding(text: str, dim: int) -> list[float]:
    """Deterministic embedding: stemmed unigrams + bigrams (+ char trigrams of rare words) hashed with
    signs into ``dim`` buckets, sublinear tf weighting, L2-normalised. Texts sharing vocabulary have high
    cosine similarity; unrelated texts are near-orthogonal."""
    vec = [0.0] * dim
    toks = tokenize(text)
    if not toks:
        toks = tokenize(text, keep_stopwords=True) or ["<empty>"]
    feats: Counter[str] = Counter()
    for t in toks:
        feats["u:" + t] += 1.0
    for a, b in zip(toks, toks[1:], strict=False):
        feats["b:" + a + "_" + b] += 0.5
    for t in set(toks):
        if len(t) >= 6:  # light sub-word signal so inflections/typos still overlap
            for i in range(len(t) - 2):
                feats["c:" + t[i : i + 3]] += 0.15
    for f, w in feats.items():
        idx, sign = _hash(f, dim)
        vec[idx] += sign * (1.0 + math.log(w)) if w >= 1 else sign * w
    norm = math.sqrt(sum(v * v for v in vec))
    if norm == 0:
        return vec
    return [v / norm for v in vec]


def cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b, strict=False))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0
