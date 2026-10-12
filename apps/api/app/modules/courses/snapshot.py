"""Pure helpers over a published course snapshot (``course_versions.snapshot``).

Snapshot layout (schema_version 1)::

    {
      "schema_version": 1,
      "course": {id, slug, title, subtitle, description, category, difficulty, duration_minutes,
                 learning_objectives, prerequisites, target_audience, tags, thumbnail_url, sequential,
                 certificate_enabled, pass_threshold, ai_tutor_enabled, skills: [{id, name}]},
      "modules": [{id, title, description, position,
                   lessons: [{id, module_id, title, summary, lesson_type, content, duration_minutes, position,
                              is_required, is_preview, assessment_id, assignment_id, simulation_id,
                              linked: {type, id, title, ...} | null, skill_ids,
                              activities: [{id, activity_type, title, content, position}]}]}],
      "stats": {module_count, lesson_count, required_lesson_count, duration_minutes}
    }
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

from app.modules.courses.content_rules import LINKED_TYPES

SCHEMA_VERSION = 1


def iter_lessons(snapshot: dict[str, Any]) -> Iterator[tuple[dict[str, Any], dict[str, Any]]]:
    """Yield ``(module, lesson)`` in learning order."""
    for module in snapshot.get("modules") or []:
        for lesson in module.get("lessons") or []:
            yield module, lesson


def lessons_in_order(snapshot: dict[str, Any]) -> list[dict[str, Any]]:
    return [lesson for _, lesson in iter_lessons(snapshot)]


def find_lesson(snapshot: dict[str, Any], lesson_id: str) -> tuple[dict[str, Any], dict[str, Any]] | None:
    for module, lesson in iter_lessons(snapshot):
        if lesson["id"] == lesson_id:
            return module, lesson
    return None


def required_lesson_ids(snapshot: dict[str, Any]) -> list[str]:
    """Required lessons count toward completion; if a course marks none required, all lessons count."""
    lessons = lessons_in_order(snapshot)
    required = [lsn["id"] for lsn in lessons if lsn.get("is_required", True)]
    return required or [lsn["id"] for lsn in lessons]


def is_event_completed(lesson: dict[str, Any]) -> bool:
    """Quiz / assignment / simulation lessons complete via grading events, not the learner."""
    return lesson.get("lesson_type") in LINKED_TYPES


def locked_lesson_ids(snapshot: dict[str, Any], completed: set[str]) -> set[str]:
    """In sequential courses a lesson unlocks once every earlier *required* lesson is complete."""
    if not (snapshot.get("course") or {}).get("sequential"):
        return set()
    locked: set[str] = set()
    blocked = False
    for lesson in lessons_in_order(snapshot):
        if blocked:
            locked.add(lesson["id"])
        if lesson.get("is_required", True) and lesson["id"] not in completed:
            blocked = True
    return locked


def next_lesson(snapshot: dict[str, Any], completed: set[str]) -> dict[str, Any] | None:
    """First incomplete required lesson, else first incomplete lesson, else None."""
    lessons = lessons_in_order(snapshot)
    for lesson in lessons:
        if lesson.get("is_required", True) and lesson["id"] not in completed:
            return lesson
    for lesson in lessons:
        if lesson["id"] not in completed:
            return lesson
    return None


def linked_ids(snapshot: dict[str, Any]) -> dict[str, set[str]]:
    """Graded components referenced by the snapshot: {"assessment_id": {...}, ...}."""
    out: dict[str, set[str]] = {"assessment_id": set(), "assignment_id": set(), "simulation_id": set()}
    for _, lesson in iter_lessons(snapshot):
        field = LINKED_TYPES.get(lesson.get("lesson_type", ""))
        if field and lesson.get(field):
            out[field].add(lesson[field])
    return out


_DIFF_FIELDS = (
    "title", "summary", "lesson_type", "content", "duration_minutes", "is_required", "is_preview",
    "assessment_id", "assignment_id", "simulation_id", "activities",
)
_COURSE_DIFF_FIELDS = (
    "title", "subtitle", "description", "category", "difficulty", "duration_minutes", "learning_objectives",
    "prerequisites", "target_audience", "tags", "thumbnail_url", "sequential", "pass_threshold",
    "certificate_enabled", "skills",
)


def _strip_activity_ids(activities: list[dict[str, Any]]) -> list[tuple[Any, ...]]:
    return [(a.get("activity_type"), a.get("title"), a.get("content")) for a in activities or []]


def diff_snapshots(old: dict[str, Any], new: dict[str, Any]) -> dict[str, Any]:
    """Summarise changes between two snapshots (lessons added / removed / changed / moved, modules too)."""
    old_lessons = {lsn["id"]: (m, lsn) for m, lsn in iter_lessons(old)}
    new_lessons = {lsn["id"]: (m, lsn) for m, lsn in iter_lessons(new)}
    old_order = {lid: i for i, lid in enumerate(old_lessons)}
    new_order = {lid: i for i, lid in enumerate(new_lessons)}

    def _brief(pair: tuple[dict[str, Any], dict[str, Any]]) -> dict[str, Any]:
        m, lsn = pair
        return {"id": lsn["id"], "title": lsn["title"], "lesson_type": lsn.get("lesson_type"),
                "module_id": m["id"], "module_title": m["title"]}

    added = [_brief(new_lessons[i]) for i in new_lessons if i not in old_lessons]
    removed = [_brief(old_lessons[i]) for i in old_lessons if i not in new_lessons]
    changed: list[dict[str, Any]] = []
    moved: list[dict[str, Any]] = []
    common = [i for i in new_lessons if i in old_lessons]
    # Relative order among lessons present in both versions.
    old_rel = {lid: n for n, lid in enumerate(sorted(common, key=lambda x: old_order[x]))}
    for n, lid in enumerate(sorted(common, key=lambda x: new_order[x])):
        (om, ol), (nm, nl) = old_lessons[lid], new_lessons[lid]
        fields = []
        for f in _DIFF_FIELDS:
            a, b = ol.get(f), nl.get(f)
            if f == "activities":
                a, b = _strip_activity_ids(a), _strip_activity_ids(b)
            if a != b:
                fields.append(f)
        if fields:
            changed.append({**_brief(new_lessons[lid]), "fields": fields})
        if om["id"] != nm["id"] or old_rel[lid] != n:
            moved.append({**_brief(new_lessons[lid]), "from_module_id": om["id"]})

    old_mods = {m["id"]: m for m in old.get("modules") or []}
    new_mods = {m["id"]: m for m in new.get("modules") or []}
    oc, nc = old.get("course") or {}, new.get("course") or {}
    return {
        "lessons_added": added,
        "lessons_removed": removed,
        "lessons_changed": changed,
        "lessons_moved": moved,
        "modules_added": [{"id": i, "title": m["title"]} for i, m in new_mods.items() if i not in old_mods],
        "modules_removed": [{"id": i, "title": m["title"]} for i, m in old_mods.items() if i not in new_mods],
        "modules_renamed": [
            {"id": i, "from": old_mods[i]["title"], "to": m["title"]}
            for i, m in new_mods.items() if i in old_mods and old_mods[i]["title"] != m["title"]
        ],
        "course_fields_changed": [f for f in _COURSE_DIFF_FIELDS if oc.get(f) != nc.get(f)],
        "summary": {"added": len(added), "removed": len(removed), "changed": len(changed), "moved": len(moved)},
    }
