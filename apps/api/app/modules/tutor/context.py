"""Tutor context assembly: lesson content from the learner's pinned snapshot, learner profile (progress,
previous mistakes, competency gaps) and the GRADED-CONTEXT GUARD.

The guard finds graded work the learner is in the middle of — an in-progress assessment attempt, a
draft/returned assignment submission, or an active graded simulation session — in the tutor's course, or
anywhere when the message clearly references it. When active, the tutor switches to hint mode and the
protected facts (answer keys, model answers, expected outputs, unrevealed simulation facts / secret
variables) are collected so they are (1) never put in the prompt and (2) screened out of the output.
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from praxis_ai.safety import screen_output
from praxis_ai.text import overlap, sentences, tokenize
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.assessment import Assessment, AssessmentAttempt, AttemptAnswer, AttemptStatus
from app.models.assignment import Assignment, Submission, SubmissionStatus
from app.models.content import Course, CourseVersion, LearnerSkill, Lesson, Skill
from app.models.learning import Enrolment, EnrolmentStatus, LessonProgress
from app.models.simulation import Simulation, SimulationScenario, SimulationSession, SimulationSessionStatus

SECRET_KEYS = {
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
    "hidden_facts",
    "root_cause",
}
TEXT_KEYS = (
    "body_markdown",
    "text",
    "transcript",
    "instructions",
    "scenario",
    "description",
    "caption",
    "alt_text",
    "question",
    "front",
    "back",
    "code",
    "html",
    "summary",
)
SIM_SECRET_KEYS = {
    "root_cause",
    "hidden_root_cause",
    "hidden_facts",
    "solution",
    "correct_action",
    "answer",
    "diagnosis",
}
MAX_LESSON_CHARS = 6000


# --------------------------------------------------------------------------- lesson content


def _strip_html(s: str) -> str:
    return re.sub(r"<[^>]+>", " ", s)


def _collect_text(value: Any, out: list[str], depth: int = 0) -> None:
    if depth > 6:
        return
    if isinstance(value, dict):
        for k, v in value.items():
            if k in SECRET_KEYS:
                continue
            if isinstance(v, str) and k in TEXT_KEYS and v.strip():
                out.append(_strip_html(v) if k == "html" else v)
            elif isinstance(v, dict | list):
                _collect_text(v, out, depth + 1)
    elif isinstance(value, list):
        for item in value:
            _collect_text(item, out, depth + 1)


def lesson_text(lesson: dict[str, Any]) -> str:
    parts = [f"# {lesson.get('title', '')}"]
    if lesson.get("summary"):
        parts.append(str(lesson["summary"]))
    _collect_text(lesson.get("content") or {}, parts)
    for act in lesson.get("activities") or []:
        if act.get("title"):
            parts.append(f"## {act['title']}")
        _collect_text(act.get("content") or {}, parts)
    return "\n\n".join(p for p in parts if p.strip())[:MAX_LESSON_CHARS]


def _find_lesson(snapshot: dict[str, Any], lesson_id: str) -> dict[str, Any] | None:
    for m in snapshot.get("modules") or []:
        for lsn in m.get("lessons") or []:
            if str(lsn.get("id")) == lesson_id:
                return lsn
    return None


def course_overview(snapshot: dict[str, Any]) -> str:
    c = snapshot.get("course") or {}
    parts = [f"# {c.get('title', '')}", str(c.get("description") or "")]
    objs = c.get("learning_objectives") or []
    if objs:
        parts.append("Learning objectives:\n" + "\n".join(f"- {o}" for o in objs))
    outline = []
    for m in snapshot.get("modules") or []:
        outline.append(
            f"- {m.get('title')}: " + ", ".join(str(lsn.get("title")) for lsn in m.get("lessons") or [])
        )
    if outline:
        parts.append("Course outline:\n" + "\n".join(outline))
    return "\n\n".join(p for p in parts if p.strip())[:MAX_LESSON_CHARS]


@dataclass
class CourseContext:
    course: Course | None
    title: str
    enrolment: Enrolment | None
    lesson_text: str | None
    snapshot: dict[str, Any] = field(default_factory=dict)


async def course_context(
    db: AsyncSession,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    course_id: uuid.UUID | None,
    lesson_id: uuid.UUID | None,
) -> CourseContext:
    if course_id is None:
        return CourseContext(None, "your training", None, None)
    course = await db.scalar(select(Course).where(Course.id == course_id, Course.organisation_id == org_id))
    if course is None:
        return CourseContext(None, "your training", None, None)
    enrolment = await db.scalar(
        select(Enrolment).where(
            Enrolment.organisation_id == org_id,
            Enrolment.user_id == user_id,
            Enrolment.course_id == course_id,
        )
    )
    snapshot: dict[str, Any] = {}
    if enrolment is not None:
        snapshot = (
            await db.scalar(
                select(CourseVersion.snapshot).where(CourseVersion.id == enrolment.course_version_id)
            )
        ) or {}
    elif course.current_version_id:
        snapshot = (
            await db.scalar(
                select(CourseVersion.snapshot).where(CourseVersion.id == course.current_version_id)
            )
        ) or {}
    text: str | None = None
    if lesson_id is not None:
        lsn = _find_lesson(snapshot, str(lesson_id)) if snapshot else None
        if lsn is None and enrolment is None:
            # Authors previewing a draft: fall back to live lesson rows (never for enrolled learners).
            row = await db.scalar(
                select(Lesson).where(
                    Lesson.id == lesson_id, Lesson.organisation_id == org_id, Lesson.course_id == course_id
                )
            )
            if row is not None:
                lsn = {"title": row.title, "summary": row.summary, "content": row.content, "activities": []}
        if lsn is not None:
            text = lesson_text(lsn)
    if text is None and snapshot:
        text = course_overview(snapshot)
    return CourseContext(course, course.title, enrolment, text, snapshot)


async def learner_profile(
    db: AsyncSession, org_id: uuid.UUID, user_id: uuid.UUID, ctx: CourseContext
) -> dict[str, Any]:
    profile: dict[str, Any] = {}
    if ctx.enrolment is not None:
        done = await db.scalar(
            select(func.count())
            .select_from(LessonProgress)
            .where(LessonProgress.enrolment_id == ctx.enrolment.id, LessonProgress.status == "completed")
        )
        profile["progress"] = {
            "percent": round(ctx.enrolment.progress_pct or 0, 1),
            "status": ctx.enrolment.status,
            "lessons_completed": int(done or 0),
        }
    mistakes: list[str] = []
    if ctx.course is not None:
        rows = (
            await db.execute(
                select(AttemptAnswer.question_id, AssessmentAttempt.questions_snapshot)
                .join(AssessmentAttempt, AssessmentAttempt.id == AttemptAnswer.attempt_id)
                .join(Assessment, Assessment.id == AssessmentAttempt.assessment_id)
                .where(
                    AssessmentAttempt.organisation_id == org_id,
                    AssessmentAttempt.user_id == user_id,
                    Assessment.course_id == ctx.course.id,
                    AttemptAnswer.is_correct.is_(False),
                    AssessmentAttempt.status.in_([AttemptStatus.GRADED, AttemptStatus.NEEDS_REVIEW]),
                )
                .order_by(AttemptAnswer.created_at.desc())
                .limit(20)
            )
        ).all()
        seen: set[str] = set()
        for qid, snap in rows:
            for q in snap or []:
                if str(q.get("id")) == str(qid) and q.get("prompt") and str(qid) not in seen:
                    seen.add(str(qid))
                    mistakes.append(str(q["prompt"])[:240])  # prompts only — never answer keys
        profile["previous_mistakes"] = mistakes[:5]
    gaps = (
        await db.execute(
            select(Skill.name, LearnerSkill.proficiency)
            .join(Skill, Skill.id == LearnerSkill.skill_id)
            .where(
                LearnerSkill.organisation_id == org_id,
                LearnerSkill.user_id == user_id,
                LearnerSkill.proficiency < 60,
                LearnerSkill.evidence_count > 0,
            )
            .order_by(LearnerSkill.proficiency)
            .limit(5)
        )
    ).all()
    profile["skill_gaps"] = [g[0] for g in gaps]
    return {k: v for k, v in profile.items() if v}


# --------------------------------------------------------------------------- graded-context guard


@dataclass
class GradedContext:
    items: list[dict[str, Any]] = field(default_factory=list)
    protected: list[str] = field(default_factory=list)

    @property
    def active(self) -> bool:
        return bool(self.items)

    @property
    def labels(self) -> list[str]:
        return [f"{i['type']}: {i['title']}" for i in self.items]


def _flatten_strings(value: Any, out: list[str], depth: int = 0) -> None:
    if depth > 6:
        return
    if isinstance(value, str):
        if value.strip():
            out.append(value)
    elif isinstance(value, dict):
        for k, v in value.items():
            if k in ("regex", "case_sensitive", "partial_credit", "scoring"):
                continue
            _flatten_strings(v, out, depth + 1)
    elif isinstance(value, list):
        for v in value:
            _flatten_strings(v, out, depth + 1)


def question_protected(q: dict[str, Any]) -> list[str]:
    """Strings that would give away a question's answer: correct option texts, accepted answers, model
    answers, matching targets and the explanation."""
    key = q.get("answer_key") or {}
    opts = q.get("options") or {}
    out: list[str] = []
    choices = {
        str(c.get("id")): str(c.get("text", "")) for c in opts.get("choices") or [] if isinstance(c, dict)
    }
    ids = list(key.get("choice_ids") or []) + ([key["choice_id"]] if key.get("choice_id") is not None else [])
    out += [choices[str(i)] for i in ids if str(i) in choices]
    right = {str(r.get("id")): str(r.get("text", "")) for r in opts.get("right") or [] if isinstance(r, dict)}
    for _, target in (key.get("pairs") or {}).items() if isinstance(key.get("pairs"), dict) else []:
        if str(target) in right:
            out.append(right[str(target)])
    rest = {k: v for k, v in key.items() if k not in ("choice_ids", "choice_id", "pairs", "order", "value")}
    _flatten_strings(rest, out)
    if q.get("explanation"):
        out += [s for s in sentences(str(q["explanation"])) if len(s) > 20]
    return [s for s in out if isinstance(s, str) and s.strip()]


def scenario_protected(definition: dict[str, Any], state: dict[str, Any]) -> list[str]:
    """Unrevealed character facts, secret variable values and any root-cause/solution fields."""
    out: list[str] = []
    revealed = set(state.get("revealed_facts") or [])
    for ch in definition.get("characters") or []:
        for f in ch.get("facts") or []:
            if isinstance(f, dict) and f.get("id") not in revealed and f.get("text"):
                out.append(str(f["text"]))
    variables = state.get("variables") or {}
    for name, spec in (definition.get("variables") or {}).items():
        if isinstance(spec, dict) and spec.get("visibility") == "secret":
            val = variables.get(name, spec.get("initial"))
            _flatten_strings(val, out)

    def walk(v: Any, depth: int = 0) -> None:
        if depth > 8:
            return
        if isinstance(v, dict):
            for k, val in v.items():
                if k in SIM_SECRET_KEYS:
                    _flatten_strings(val, out)
                else:
                    walk(val, depth + 1)
        elif isinstance(v, list):
            for item in v:
                walk(item, depth + 1)

    walk(definition)
    return out


def _references(message: str, *texts: str) -> bool:
    terms = set(tokenize(message))
    if len(terms) < 2:
        return False
    for t in texts:
        if not t:
            continue
        if len(t) > 6 and t.lower() in message.lower():
            return True
        if len(set(tokenize(t))) >= 3 and overlap(list(terms), t) >= 0.6:
            return True
    return False


async def graded_context(
    db: AsyncSession, org_id: uuid.UUID, user_id: uuid.UUID, course_id: uuid.UUID | None, message: str
) -> GradedContext:
    g = GradedContext()
    now = datetime.now(UTC)
    attempts = (
        await db.execute(
            select(AssessmentAttempt, Assessment)
            .join(Assessment, Assessment.id == AssessmentAttempt.assessment_id)
            .where(
                AssessmentAttempt.organisation_id == org_id,
                AssessmentAttempt.user_id == user_id,
                AssessmentAttempt.status == AttemptStatus.IN_PROGRESS,
                Assessment.kind != "survey",
            )
        )
    ).all()
    for att, a in attempts:
        if att.expires_at is not None and att.expires_at < now:
            continue
        qs = [q for q in att.questions_snapshot or [] if isinstance(q, dict)]
        in_scope = course_id is not None and a.course_id == course_id
        if in_scope or _references(message, a.title, *[str(q.get("prompt") or "") for q in qs]):
            g.items.append({"type": "assessment", "id": str(a.id), "title": a.title})
            for q in qs:
                g.protected += question_protected(q)
    subs = (
        await db.execute(
            select(Submission, Assignment)
            .join(Assignment, Assignment.id == Submission.assignment_id)
            .where(
                Submission.organisation_id == org_id,
                Submission.user_id == user_id,
                Submission.status.in_([SubmissionStatus.DRAFT, SubmissionStatus.RETURNED]),
                Assignment.deleted_at.is_(None),
            )
        )
    ).all()
    for _sub, asg in subs:
        in_scope = course_id is not None and asg.course_id == course_id
        if in_scope or _references(message, asg.title, asg.scenario or "", asg.instructions or ""):
            g.items.append({"type": "assignment", "id": str(asg.id), "title": asg.title})
            if asg.expected_output:
                g.protected += [s for s in sentences(asg.expected_output) if len(s) > 15] or [
                    asg.expected_output
                ]
    sims = (
        await db.execute(
            select(SimulationSession, Simulation, SimulationScenario.definition)
            .join(Simulation, Simulation.id == SimulationSession.simulation_id)
            .join(SimulationScenario, SimulationScenario.id == SimulationSession.scenario_id)
            .where(
                SimulationSession.organisation_id == org_id,
                SimulationSession.user_id == user_id,
                SimulationSession.status == SimulationSessionStatus.ACTIVE,
                Simulation.is_graded.is_(True),
            )
        )
    ).all()
    for sess, sim, definition in sims:
        in_scope = course_id is not None and sim.course_id == course_id
        if in_scope or _references(message, sim.title, sim.description or ""):
            g.items.append({"type": "simulation", "id": str(sim.id), "title": sim.title})
            g.protected += scenario_protected(definition or {}, sess.state or {})
    g.protected = list(dict.fromkeys(p.strip() for p in g.protected if p and p.strip()))
    return g


def redact_text(text: str, protected: list[str]) -> str:
    """Remove protected facts from context before it is placed in a prompt: exact matches are redacted and
    sentences that fuzzily restate a protected fact are dropped."""
    if not text or not protected:
        return text
    res = screen_output(text, protected)
    text = res.redacted
    kept = []
    for s in sentences(text):
        if not screen_output(s, protected).leaked:
            kept.append(s)
    return " ".join(kept) if len(kept) != len(sentences(text)) else text


def enrolled(e: Enrolment | None) -> bool:
    return e is not None and e.status != EnrolmentStatus.WITHDRAWN
