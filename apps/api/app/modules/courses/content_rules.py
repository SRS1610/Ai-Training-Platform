"""Per-type validation of lesson and activity content payloads.

Every validator returns a *normalised* copy of the payload (unknown keys are kept so the builder can
store presentation hints, but required keys are type-checked) or raises ``BadRequest``.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from typing import Any

from app.core.errors import BadRequest
from app.models.content import LessonType

# Lesson types whose completion is driven by a graded component (events), not by the learner.
LINKED_TYPES: dict[str, str] = {
    LessonType.QUIZ: "assessment_id",
    LessonType.ASSIGNMENT: "assignment_id",
    LessonType.SIMULATION: "simulation_id",
}
LINK_FIELDS = ("assessment_id", "assignment_id", "simulation_id")

# Keys that must never reach learners through a published snapshot.
SECRET_KEYS = frozenset(
    {
        "answer_key",
        "answer",
        "answers",
        "answer_ids",
        "correct",
        "correct_answer",
        "correct_answers",
        "correct_option",
        "correct_option_ids",
        "is_correct",
        "expected_output",
        "expected_outputs",
        "solution",
        "solution_code",
        "model_answer",
        "hidden_tests",
        "grading_notes",
    }
)

_URL_RE = re.compile(r"^(https?://[^\s]+|/[^\s]*)$", re.IGNORECASE)
MAX_TEXT = 200_000


def _err(field: str, msg: str) -> BadRequest:
    return BadRequest(msg, code="invalid_content", details={"field": field})


def _str(content: dict[str, Any], key: str, *, required: bool = False, max_len: int = MAX_TEXT) -> None:
    val = content.get(key)
    if val is None or (isinstance(val, str) and not val.strip()):
        if required:
            raise _err(key, f"'{key}' is required for this content type")
        return
    if not isinstance(val, str):
        raise _err(key, f"'{key}' must be a string")
    if len(val) > max_len:
        raise _err(key, f"'{key}' is too long")


def _url(content: dict[str, Any], key: str, *, required: bool = False) -> None:
    _str(content, key, required=required, max_len=2048)
    val = content.get(key)
    if isinstance(val, str) and val.strip() and not _URL_RE.match(val.strip()):
        raise _err(key, f"'{key}' must be an http(s) URL or an absolute path")


def _media(content: dict[str, Any], url_key: str) -> None:
    """Media blocks need a URL or an uploaded file id."""
    if not content.get(url_key) and not content.get("file_id"):
        raise _err(url_key, f"'{url_key}' or 'file_id' is required for this content type")
    _url(content, url_key)
    if content.get("file_id") is not None:
        _str(content, "file_id", max_len=64)


def _video(c: dict[str, Any]) -> None:
    _media(c, "video_url")
    _url(c, "captions_url")
    _url(c, "poster_url")
    _str(c, "transcript")


def _audio(c: dict[str, Any]) -> None:
    _media(c, "audio_url")
    _str(c, "transcript")


def _document(c: dict[str, Any]) -> None:
    if not c.get("url") and not c.get("file_id"):
        raise _err("file_id", "'file_id' or 'url' is required for this content type")
    _url(c, "url")
    _url(c, "embed_url")


def _text(c: dict[str, Any]) -> None:
    _str(c, "body_markdown", required=True)


def _interactive(c: dict[str, Any]) -> None:
    if not c.get("html") and not c.get("url"):
        raise _err("html", "'html' or 'url' is required for interactive content")
    _str(c, "html")
    _url(c, "url")


def _image(c: dict[str, Any]) -> None:
    _media(c, "image_url")
    _str(c, "alt_text", max_len=1000)
    _str(c, "caption", max_len=2000)


def _infographic(c: dict[str, Any]) -> None:
    _image(c)
    _str(c, "body_markdown")


def _code(c: dict[str, Any]) -> None:
    _str(c, "language", required=True, max_len=40)
    _str(c, "code", required=True)
    _str(c, "instructions")


def _flashcards(c: dict[str, Any]) -> None:
    cards = c.get("cards")
    if not isinstance(cards, list) or not cards:
        raise _err("cards", "'cards' must be a non-empty list of {front, back}")
    if len(cards) > 500:
        raise _err("cards", "Too many flashcards (max 500)")
    for i, card in enumerate(cards):
        if not isinstance(card, dict):
            raise _err(f"cards[{i}]", "Each card must be an object with 'front' and 'back'")
        for side in ("front", "back"):
            v = card.get(side)
            if not isinstance(v, str) or not v.strip():
                raise _err(f"cards[{i}].{side}", f"Card {i + 1} needs a non-empty '{side}'")


def _scenario(c: dict[str, Any]) -> None:
    if not c.get("scenario") and not c.get("body_markdown"):
        raise _err("scenario", "'scenario' or 'body_markdown' is required for scenario lessons")
    _str(c, "scenario")
    _str(c, "body_markdown")
    choices = c.get("choices")
    if choices is not None:
        if not isinstance(choices, list):
            raise _err("choices", "'choices' must be a list")
        for i, ch in enumerate(choices):
            if not isinstance(ch, dict) or not isinstance(ch.get("text"), str) or not ch["text"].strip():
                raise _err(f"choices[{i}]", "Each choice needs a non-empty 'text'")


def _nothing(c: dict[str, Any]) -> None:
    _str(c, "body_markdown")
    _str(c, "instructions")


LESSON_VALIDATORS: dict[str, Callable[[dict[str, Any]], None]] = {
    LessonType.VIDEO: _video,
    LessonType.AUDIO: _audio,
    LessonType.PDF: _document,
    LessonType.POWERPOINT: _document,
    LessonType.TEXT: _text,
    LessonType.INTERACTIVE_HTML: _interactive,
    LessonType.IMAGE: _image,
    LessonType.INFOGRAPHIC: _infographic,
    LessonType.CODE: _code,
    LessonType.QUIZ: _nothing,
    LessonType.FLASHCARDS: _flashcards,
    LessonType.SCENARIO: _scenario,
    LessonType.SIMULATION: _nothing,
    LessonType.ASSIGNMENT: _nothing,
    LessonType.AI_TUTOR: _nothing,
    LessonType.MIXED: _nothing,
}


def _callout(c: dict[str, Any]) -> None:
    _str(c, "body_markdown", required=True)
    if c.get("variant") is not None and c["variant"] not in {"info", "tip", "warning", "danger", "success"}:
        raise _err("variant", "variant must be one of info, tip, warning, danger, success")


def _check(c: dict[str, Any]) -> None:
    """Ungraded knowledge check: {question, options:[{id,text}], answer_ids:[...], explanation}."""
    _str(c, "question", required=True)
    options = c.get("options")
    if not isinstance(options, list) or len(options) < 2:
        raise _err("options", "A knowledge check needs at least two options")
    ids = set()
    for i, o in enumerate(options):
        if not isinstance(o, dict) or not str(o.get("id", "")).strip() or not str(o.get("text", "")).strip():
            raise _err(f"options[{i}]", "Each option needs an 'id' and 'text'")
        ids.add(str(o["id"]))
    answers = c.get("answer_ids")
    if not isinstance(answers, list) or not answers or not {str(a) for a in answers} <= ids:
        raise _err("answer_ids", "'answer_ids' must list one or more option ids")


def _embed(c: dict[str, Any]) -> None:
    _url(c, "url", required=True)


ACTIVITY_VALIDATORS: dict[str, Callable[[dict[str, Any]], None]] = {
    "text": _text,
    "video": _video,
    "audio": _audio,
    "image": _image,
    "code": _code,
    "flashcards": _flashcards,
    "callout": _callout,
    "check": _check,
    "embed": _embed,
    "pdf": _document,
    "file": _document,
    "scenario": _scenario,
    "interactive_html": _interactive,
}


def validate_lesson_content(lesson_type: str, content: dict[str, Any] | None) -> dict[str, Any]:
    if lesson_type not in LESSON_VALIDATORS:
        raise BadRequest(f"Unknown lesson type '{lesson_type}'", code="invalid_lesson_type")
    content = dict(content or {})
    LESSON_VALIDATORS[lesson_type](content)
    return content


def validate_activity_content(activity_type: str, content: dict[str, Any] | None) -> dict[str, Any]:
    if activity_type not in ACTIVITY_VALIDATORS:
        raise BadRequest(
            f"Unknown activity type '{activity_type}'",
            code="invalid_activity_type",
            details={"allowed": sorted(ACTIVITY_VALIDATORS)},
        )
    content = dict(content or {})
    ACTIVITY_VALIDATORS[activity_type](content)
    return content


def strip_secrets(value: Any) -> Any:
    """Recursively drop answer keys / expected outputs before content is frozen into a snapshot."""
    if isinstance(value, dict):
        return {k: strip_secrets(v) for k, v in value.items() if k not in SECRET_KEYS}
    if isinstance(value, list):
        return [strip_secrets(v) for v in value]
    return value
