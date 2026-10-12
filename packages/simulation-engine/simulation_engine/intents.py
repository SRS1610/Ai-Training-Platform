"""Deterministic free-text intent matching: normalisation, synonyms, light stemming and fuzzy word
matching (``difflib``), so learners can phrase questions naturally without an LLM deciding correctness."""

from __future__ import annotations

import re
from collections.abc import Iterable
from difflib import SequenceMatcher

from simulation_engine.schema import Intent

STOPWORDS = frozenset("""
a an the is are was were be been am do does did to of in on at for with and or but if it its this that
these those i you your yours me my we our us he she they them their there here can could would should will
shall may might please just so ok okay any some about from by as into than then also have has had
what whats when where which who whom why how
""".split())

# Question words matter for intent ("when did it start" vs "what started"), so they are kept in patterns
# even though they are stopwords for example-overlap scoring.
QUESTION_WORDS = frozenset({"what", "whats", "when", "where", "which", "who", "why", "how"})

BUILTIN_SYNONYMS: dict[str, list[str]] = {
    "computer": ["pc", "laptop", "machine", "notebook", "device", "workstation"],
    "start": ["began", "begin", "beginning", "started", "starting", "commence"],
    "error": ["errors", "message", "msg", "warning", "popup", "prompt", "alert"],
    "change": ["changed", "changes", "update", "updated", "updates", "install", "installed", "upgrade",
               "upgraded", "new"],
    "wireless": ["wifi", "wlan", "wi"],
    "wired": ["ethernet", "cable", "lan", "plugged"],
    "other": ["another", "others", "else", "colleague", "colleagues", "coworker", "phone"],
    "work": ["working", "works", "worked", "function", "functioning"],
    "internet": ["web", "online", "website", "websites", "browse", "browsing", "site", "sites"],
    "see": ["show", "showing", "display", "displayed", "says", "say", "saying", "read", "reads", "appear",
            "appears"],
    "problem": ["issue", "issues", "problems", "trouble", "fault", "symptom", "symptoms"],
    "hello": ["hi", "hey", "morning", "afternoon", "evening", "greetings"],
    "thank": ["thanks", "thankyou", "cheers", "appreciate"],
    "sorry": ["apologise", "apologize", "apologies", "regret"],
}

_WORD = re.compile(r"[a-z0-9]+(?:\.[a-z0-9]+)*")


def normalise(text: str) -> str:
    text = (text or "").lower()
    text = text.replace("’", "'").replace("'", "")
    text = re.sub(r"(?<=[a-z])-(?=[a-z])", "", text)  # wi-fi → wifi, e-mail → email
    return re.sub(r"\s+", " ", text).strip()


def stem(word: str) -> str:
    for suffix in ("ingly", "edly", "ings", "ing", "ied", "ies", "ed", "es", "ly", "s"):
        if len(word) > len(suffix) + 2 and word.endswith(suffix):
            base = word[: -len(suffix)]
            if suffix in ("ied", "ies"):
                base += "y"
            if len(base) > 2 and base[-1] == base[-2] and base[-1] not in "aeiouls":
                base = base[:-1]  # stopped → stop
            return base
    return word


class Vocabulary:
    """Maps surface words to canonical stems using built-in and definition-level synonyms."""

    def __init__(self, synonyms: dict[str, list[str]] | None = None) -> None:
        self.map: dict[str, str] = {}
        for source in (BUILTIN_SYNONYMS, synonyms or {}):
            for canonical, variants in source.items():
                canon = stem(normalise(canonical))
                for v in [canonical, *variants]:
                    self.map[normalise(v)] = canon

    def canon(self, word: str) -> str:
        return self.map.get(word) or self.map.get(stem(word)) or stem(word)

    def tokens(self, text: str, *, drop_stopwords: bool = True, keep_question_words: bool = False) -> list[str]:
        out = []
        for w in _WORD.findall(normalise(text)):
            if drop_stopwords and w in STOPWORDS and not (keep_question_words and w in QUESTION_WORDS):
                continue
            out.append(self.canon(w))
        return out


def _word_match(p: str, words: Iterable[str]) -> bool:
    for w in words:
        if w == p:
            return True
        if len(p) >= 4 and len(w) >= 4:
            if (len(p) >= 5 and (w.startswith(p) or p.startswith(w))) or SequenceMatcher(None, p, w).ratio() >= 0.84:
                return True
    return False


def score_intent(text: str, intent: Intent, vocab: Vocabulary) -> float:
    """0 when the intent does not match; otherwise a specificity score (higher = better match)."""
    words = set(vocab.tokens(text, keep_question_words=True))
    if not words:
        return 0.0
    best = 0.0
    flat = " " + " ".join(vocab.tokens(text, drop_stopwords=False)) + " "
    for pattern in intent.patterns:
        ptoks = vocab.tokens(pattern, keep_question_words=True) or vocab.tokens(pattern, drop_stopwords=False)
        if not ptoks:
            continue
        if all(_word_match(p, words) for p in ptoks):
            score = float(len(ptoks))
            if " " + " ".join(vocab.tokens(pattern, drop_stopwords=False)) + " " in flat:
                score += 0.5  # exact phrase bonus
            best = max(best, score)
    plain = set(vocab.tokens(text))
    for example in intent.examples:
        etoks = set(vocab.tokens(example))
        if not etoks or not plain:
            continue
        jaccard = len(etoks & plain) / len(etoks | plain)
        if jaccard >= 0.5:
            best = max(best, 1.0 + jaccard)
    return best


def match_intents(text: str, intents: Iterable[Intent], vocab: Vocabulary) -> list[tuple[str, float]]:
    """All matching intents, best first (ties keep definition order)."""
    scored = [(i.id, score_intent(text, i, vocab)) for i in intents]
    hits = [(iid, s) for iid, s in scored if s > 0]
    return sorted(hits, key=lambda x: -x[1])


def normalise_command(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip()).lower()
