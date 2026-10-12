from __future__ import annotations

import pytest

from simulation_engine.intents import Vocabulary, match_intents, normalise, normalise_command, score_intent, stem
from simulation_engine.schema import Intent


def test_normalise_and_stem():
    assert normalise("  Wi-Fi isn’t   WORKING ") == "wifi isnt working"
    assert stem("started") == "start" and stem("stopped") == "stop" and stem("replies") == "reply"
    assert stem("is") == "is"
    assert normalise_command("  IPCONFIG   /ALL ") == "ipconfig /all"


def test_vocabulary_synonyms():
    v = Vocabulary({"intranet": ["sharepoint"]})
    assert v.tokens("When did the laptop begin failing?", keep_question_words=True)[:3] == ["when", "computer", "start"]
    assert v.canon("sharepoint") == "intranet"


INTENTS = [
    Intent(id="when", patterns=["when start", "how long"]),
    Intent(id="error", patterns=["error", "what see"], examples=["What do you see on screen right now?"]),
    Intent(id="other", patterns=["anyone other"], examples=["Is your colleague affected?"]),
    Intent(id="empty", patterns=["the a"]),  # stopword-only pattern still usable
]


@pytest.mark.parametrize("text, expected", [
    ("When did this begin?", "when"),
    ("how long has it been like this", "when"),
    ("What errror do you get?", "error"),  # typo tolerated
    ("what do you see on your screen right now", "error"),
    ("Is anyone else having this?", "other"),
])
def test_match_intents(text, expected):
    hits = match_intents(text, INTENTS, Vocabulary())
    assert hits and hits[0][0] == expected


def test_no_match_and_empty():
    v = Vocabulary()
    assert match_intents("purple elephants dance", INTENTS, v) == []
    assert score_intent("", INTENTS[0], v) == 0
    assert score_intent("the a", INTENTS[3], v) > 0
    assert score_intent("words", Intent(id="x", patterns=[""], examples=[""]), v) == 0
