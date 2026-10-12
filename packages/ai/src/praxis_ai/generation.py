"""Structured output schemas for AI content generation, schema hints for prompts, and deterministic
template builders (used by the Offline provider and as a last-resort fallback).

Every generation kind validates against a Pydantic model here before an instructor can review it.
"""

from __future__ import annotations

import re
import types
import typing
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from praxis_ai.text import keywords, sentences

QuestionKind = Literal[
    "multiple_choice",
    "multiple_select",
    "true_false",
    "short_answer",
    "long_answer",
    "fill_blank",
    "scenario",
]
GENERATION_KINDS = (
    "course",
    "module",
    "lesson",
    "quiz",
    "assignment",
    "rubric",
    "flashcards",
    "revision_notes",
    "case_study",
    "scenario",
)


class _M(BaseModel):
    model_config = ConfigDict(extra="ignore")


class Choice(_M):
    id: str
    text: str


class QuizQuestion(_M):
    type: QuestionKind = "multiple_choice"
    prompt: str = Field(min_length=3)
    choices: list[Choice] = Field(default_factory=list)
    answer_key: dict[str, Any] = Field(default_factory=dict)
    explanation: str = ""
    difficulty: int = Field(default=2, ge=1, le=5)
    points: float = Field(default=1.0, gt=0)
    skills: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def _check_key(self) -> QuizQuestion:
        if self.type in ("multiple_choice", "multiple_select"):
            if len(self.choices) < 2:
                raise ValueError("choice questions need at least two choices")
            ids = {c.id for c in self.choices}
            key = [str(x) for x in (self.answer_key.get("choice_ids") or [])]
            if not key or not set(key) <= ids:
                raise ValueError("answer_key.choice_ids must reference existing choices")
            if self.type == "multiple_choice" and len(key) != 1:
                raise ValueError("multiple_choice needs exactly one correct choice")
        elif self.type == "true_false":
            if not isinstance(self.answer_key.get("value"), bool):
                raise ValueError("true_false needs answer_key.value boolean")
        elif self.type in ("short_answer", "fill_blank"):
            acc = self.answer_key.get("accepted")
            if not isinstance(acc, list) or not acc:
                raise ValueError("short_answer needs answer_key.accepted list")
        return self


class Quiz(_M):
    title: str
    description: str = ""
    pass_percentage: float = Field(default=70.0, ge=0, le=100)
    questions: list[QuizQuestion] = Field(min_length=1)


class RubricLevel(_M):
    score: float
    label: str
    description: str = ""


class RubricCriterion(_M):
    id: str
    name: str
    description: str = ""
    weight: float = Field(default=1.0, gt=0)
    levels: list[RubricLevel] = Field(default_factory=list)


class RubricOut(_M):
    title: str
    description: str = ""
    total_points: float = 100.0
    criteria: list[RubricCriterion] = Field(min_length=1)


class EvidenceItem(_M):
    id: str
    label: str
    type: str = "text"
    required: bool = True


class AssignmentOut(_M):
    title: str
    scenario: str
    objective: str
    instructions: str
    required_evidence: list[EvidenceItem] = Field(default_factory=list)
    expected_output: str = ""
    evaluation_criteria: str = ""
    passing_score: float = Field(default=70.0, ge=0, le=100)
    rubric: RubricOut


class Flashcard(_M):
    front: str
    back: str


class FlashcardSet(_M):
    title: str
    cards: list[Flashcard] = Field(min_length=1)


class NotesSection(_M):
    heading: str
    points: list[str] = Field(default_factory=list)


class KeyTerm(_M):
    term: str
    definition: str


class RevisionNotes(_M):
    title: str
    summary: str
    sections: list[NotesSection] = Field(min_length=1)
    key_terms: list[KeyTerm] = Field(default_factory=list)


class CaseStudy(_M):
    title: str
    context: str
    challenge: str
    questions: list[str] = Field(default_factory=list)
    model_analysis: str = ""


class ScenarioCharacter(_M):
    name: str
    role: str
    persona: str = ""


class ScenarioOut(_M):
    title: str
    industry: str = "it"
    environment_type: str = "helpdesk"
    description: str
    learner_role: str
    objectives: list[str] = Field(default_factory=list)
    phases: list[str] = Field(default_factory=list)
    characters: list[ScenarioCharacter] = Field(default_factory=list)
    hidden_root_cause: str = ""
    key_actions: list[str] = Field(default_factory=list)
    red_herrings: list[str] = Field(default_factory=list)


class LessonOut(_M):
    title: str
    summary: str = ""
    duration_minutes: int = Field(default=10, ge=1, le=600)
    body_markdown: str
    examples: list[str] = Field(default_factory=list)
    key_points: list[str] = Field(default_factory=list)
    case_study: CaseStudy | None = None
    knowledge_check: Quiz | None = None


class ModuleOut(_M):
    title: str
    description: str = ""
    week: int | None = None
    lessons: list[LessonOut] = Field(min_length=1)
    quiz: Quiz | None = None


class CourseOut(_M):
    title: str
    subtitle: str = ""
    description: str
    audience: str = ""
    difficulty: str = "beginner"
    duration_minutes: int = 60
    learning_objectives: list[str] = Field(default_factory=list)
    prerequisites: list[str] = Field(default_factory=list)
    modules: list[ModuleOut] = Field(min_length=1)
    assignments: list[AssignmentOut] = Field(default_factory=list)
    final_assessment: Quiz | None = None
    flashcards: FlashcardSet | None = None
    revision_notes: RevisionNotes | None = None
    simulation_suggestion: ScenarioOut | None = None


SCHEMAS: dict[str, type[BaseModel]] = {
    "course": CourseOut,
    "module": ModuleOut,
    "lesson": LessonOut,
    "quiz": Quiz,
    "assignment": AssignmentOut,
    "rubric": RubricOut,
    "flashcards": FlashcardSet,
    "revision_notes": RevisionNotes,
    "case_study": CaseStudy,
    "scenario": ScenarioOut,
}


class GenerationInput(_M):
    subject: str = Field(min_length=2, max_length=300)
    audience: str = "professionals"
    difficulty: str = "beginner"
    objectives: list[str] = Field(default_factory=list)
    duration: str | int | None = None
    industry: str | None = None
    format: str | None = None
    weeks: int | None = Field(default=None, ge=1, le=26)
    course_id: str | None = None
    lesson_id: str | None = None
    module_id: str | None = None
    question_count: int = Field(default=5, ge=1, le=50)
    question_types: list[str] = Field(default_factory=lambda: ["multiple_choice", "true_false"])
    source_text: str | None = None  # optional grounding (existing lesson content), filled by the platform

    @field_validator("objectives", mode="before")
    @classmethod
    def _split(cls, v: Any) -> Any:
        if isinstance(v, str):
            return [s.strip(" -•") for s in re.split(r"[\n;]+", v) if s.strip(" -•")]
        return v or []


def validate_output(kind: str, data: dict[str, Any]) -> dict[str, Any]:
    """Validate & normalise generated output for ``kind``. Raises pydantic.ValidationError."""
    model = SCHEMAS[kind]
    return model.model_validate(data).model_dump(mode="json")


# --------------------------------------------------------------------------- schema hints


def _hint_for(annotation: Any, depth: int = 0) -> Any:
    origin = typing.get_origin(annotation)
    args = typing.get_args(annotation)
    if origin in (typing.Union, types.UnionType):
        non_null = [a for a in args if a is not type(None)]
        return _hint_for(non_null[0], depth) if non_null else None
    if origin is list:
        return [_hint_for(args[0], depth + 1)] if args else []
    if origin is dict:
        return {}
    if origin is Literal:
        return " | ".join(str(a) for a in args)
    if isinstance(annotation, type) and issubclass(annotation, BaseModel):
        if depth > 6:
            return {}
        return {name: _hint_for(f.annotation, depth + 1) for name, f in annotation.model_fields.items()}
    return {str: "string", int: "integer", float: "number", bool: "boolean"}.get(annotation, "any")


def schema_hint(kind: str) -> dict[str, Any]:
    hint = _hint_for(SCHEMAS[kind])
    return hint if isinstance(hint, dict) else {}


# --------------------------------------------------------------------------- deterministic templates


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")[:40] or "item"


def _title(s: str) -> str:
    s = s.strip().rstrip(".")
    return s[:1].upper() + s[1:]


def _topics(inp: GenerationInput, n: int) -> list[str]:
    subj = inp.subject
    base = [_title(o) for o in inp.objectives] or [
        f"Foundations of {subj}",
        f"Key concepts and terminology in {subj}",
        f"{_title(subj)} in practice",
        f"Diagnosing common {subj} problems",
        f"Best practices and standards for {subj}",
        f"Applying {subj} at work",
        f"Advanced {subj} scenarios",
        f"Measuring success in {subj}",
    ]
    if inp.source_text:
        terms = keywords(inp.source_text, 8)
        base = base + [f"{_title(t)} in {subj}" for t in terms]
    out = []
    i = 0
    while len(out) < n:
        out.append(base[i % len(base)] + ("" if i < len(base) else f" (part {i // len(base) + 1})"))
        i += 1
    return out


def _ctx(inp: GenerationInput) -> str:
    bits = [f"for {inp.audience}"]
    if inp.industry:
        bits.append(f"in the {inp.industry} industry")
    return " ".join(bits)


def _source_sentences(inp: GenerationInput, topic: str, k: int = 3) -> list[str]:
    if not inp.source_text:
        return []
    from praxis_ai.text import overlap

    ss = sentences(inp.source_text)
    ranked = sorted(ss, key=lambda s: -overlap(topic, s))
    return [s for s in ranked[:k] if len(s) > 20]


def build_lesson(inp: GenerationInput, topic: str, *, with_check: bool = True) -> dict[str, Any]:
    subj = inp.subject
    grounded = _source_sentences(inp, topic)
    body = [
        f"# {topic}",
        "",
        f"This lesson introduces **{topic.lower()}** {_ctx(inp)}. By the end you will be able to explain why "
        f"it matters, recognise it in day-to-day work and apply it confidently.",
        "",
        "## Why it matters",
        f"Teams that understand {topic.lower()} resolve issues faster, communicate more clearly with "
        f"stakeholders and make fewer costly mistakes. In {subj}, small misunderstandings here often cascade "
        "into larger incidents.",
        "",
        "## Key ideas",
        f"1. **Definition** — what {topic.lower()} means and the vocabulary used by practitioners.",
        "2. **Process** — the typical sequence: identify, investigate, decide, act and verify.",
        "3. **Signals** — the evidence that tells you something is going right or wrong.",
        "4. **Communication** — how to document and explain your reasoning to others.",
    ]
    if grounded:
        body += ["", "## From your materials", *[f"> {s}" for s in grounded]]
    body += [
        "",
        "## Worked example",
        f"A colleague reports a problem related to {subj}. Rather than guessing, you gather facts, form a "
        "hypothesis, test it with the least disruptive check first, and record what you found.",
        "",
        "## Summary",
        f"{topic} is a practical skill: ask good questions, use evidence, act safely and verify the outcome.",
    ]
    lesson: dict[str, Any] = {
        "title": topic,
        "summary": f"Understand and apply {topic.lower()} {_ctx(inp)}.",
        "duration_minutes": 15,
        "body_markdown": "\n".join(body),
        "examples": [
            f"Example: applying {topic.lower()} when a customer reports an urgent {subj} issue.",
            f"Example: reviewing a past {subj} incident to find what evidence was missed.",
        ],
        "key_points": [
            f"Use evidence before acting on {topic.lower()}.",
            "Verify the outcome and document it.",
            "Escalate early when impact or risk is high.",
        ],
        "case_study": None,
        "knowledge_check": build_quiz(inp, [topic], count=2, title=f"Check: {topic}") if with_check else None,
    }
    return lesson


def _questions_for(inp: GenerationInput, topic: str, idx: int, qtype: str) -> dict[str, Any]:
    subj = inp.subject
    grounded = _source_sentences(inp, topic, 5)
    if qtype in ("short_answer", "fill_blank") and grounded:
        sent = grounded[idx % len(grounded)]
        terms = [t for t in keywords(sent, 5) if len(t) > 3]
        if terms:
            word = next(
                (w for w in re.findall(r"[A-Za-z][A-Za-z\-]{3,}", sent) if w.lower().startswith(terms[0])),
                terms[0],
            )
            return {
                "type": "fill_blank" if qtype == "fill_blank" else "short_answer",
                "prompt": "Complete the statement: "
                + re.sub(re.escape(word), "_____", sent, count=1, flags=re.I),
                "choices": [],
                "answer_key": {"accepted": [word.lower()]},
                "explanation": f"From the course material: “{sent}”",
                "difficulty": 2,
                "points": 1.0,
            }
    if qtype == "true_false":
        value = idx % 2 == 0
        statement = (
            f"In {subj}, {topic.lower()} should be based on evidence gathered before taking action."
            if value
            else f"In {subj}, it is best practice to skip verification once a fix is applied."
        )
        return {
            "type": "true_false",
            "prompt": statement,
            "choices": [],
            "answer_key": {"value": value},
            "explanation": "Evidence-led work and verification are core practices."
            if value
            else "Always verify the outcome; skipping verification hides unresolved problems.",
            "difficulty": 1,
            "points": 1.0,
        }
    if qtype in ("short_answer", "fill_blank"):
        return {
            "type": "short_answer",
            "prompt": f"Name the step that confirms a {subj} fix actually worked.",
            "choices": [],
            "answer_key": {"accepted": ["verification", "verify", "validation", "testing"]},
            "explanation": "Verification/validation confirms the fix resolved the issue.",
            "difficulty": 2,
            "points": 1.0,
        }
    if qtype == "long_answer":
        return {
            "type": "long_answer",
            "prompt": f"Explain, with an example from your workplace, how you would apply {topic.lower()}.",
            "choices": [],
            "answer_key": {
                "model_answer": f"A strong answer defines {topic.lower()}, describes "
                "gathering evidence, choosing an action, verifying and documenting."
            },
            "explanation": "Look for definition, process, evidence, verification and communication.",
            "difficulty": 3,
            "points": 5.0,
        }
    correct = f"Gather evidence, form a hypothesis and test it before changing anything ({topic.lower()})"
    distractors = [
        "Apply the most common fix immediately without investigating",
        "Wait for the problem to resolve itself",
        "Escalate every issue without collecting any details",
    ]
    rot = idx % 4
    options = distractors[:]
    options.insert(rot, correct)
    choices = [{"id": chr(97 + i), "text": t} for i, t in enumerate(options)]
    q: dict[str, Any] = {
        "type": "multiple_choice",
        "prompt": f"Which approach best reflects good practice for {topic.lower()} in {subj}?",
        "choices": choices,
        "answer_key": {"choice_ids": [chr(97 + rot)]},
        "explanation": "Evidence-led investigation avoids unnecessary changes and finds the real cause.",
        "difficulty": 2,
        "points": 1.0,
    }
    if qtype == "multiple_select":
        q["type"] = "multiple_select"
        choices.append({"id": "e", "text": "Document what you found and verify the outcome"})
        q["answer_key"] = {"choice_ids": [chr(97 + rot), "e"]}
        q["prompt"] = f"Select ALL good practices for {topic.lower()} in {subj}."
    return q


def build_quiz(
    inp: GenerationInput, topics: list[str], *, count: int | None = None, title: str | None = None
) -> dict[str, Any]:
    n = count or inp.question_count
    types_ = [t for t in inp.question_types if t in typing.get_args(QuestionKind)] or ["multiple_choice"]
    qs = [_questions_for(inp, topics[i % len(topics)], i, types_[i % len(types_)]) for i in range(n)]
    return {
        "title": title or f"{_title(inp.subject)} quiz",
        "description": f"Check your understanding of {inp.subject}.",
        "pass_percentage": 70.0,
        "questions": qs,
    }


def build_rubric(inp: GenerationInput, title: str | None = None) -> dict[str, Any]:
    subj = inp.subject
    crits = [
        (
            "investigation",
            "Investigation & evidence",
            f"Gathers relevant evidence about the {subj} problem, "
            "including logs, symptoms, scope and impact, before acting.",
        ),
        (
            "analysis",
            "Root-cause analysis",
            "Identifies the most likely root cause and explains the reasoning, ruling out alternatives.",
        ),
        (
            "solution",
            "Solution & verification",
            "Proposes a safe, effective fix, and verifies/tests that it resolved the issue.",
        ),
        (
            "communication",
            "Communication & documentation",
            "Communicates clearly with stakeholders and documents steps, findings and next actions.",
        ),
    ]
    levels = [
        (0, "Missing", "Not demonstrated."),
        (1, "Developing", "Partially demonstrated with gaps."),
        (2, "Proficient", "Demonstrated clearly and correctly."),
        (3, "Exemplary", "Demonstrated thoroughly with insight."),
    ]
    return {
        "title": title or f"{_title(subj)} practical rubric",
        "description": f"Rubric for practical {subj} work.",
        "total_points": 100.0,
        "criteria": [
            {
                "id": cid,
                "name": name,
                "description": desc,
                "weight": 1.0,
                "levels": [{"score": s, "label": lab, "description": d} for s, lab, d in levels],
            }
            for cid, name, desc in crits
        ],
    }


def build_assignment(inp: GenerationInput) -> dict[str, Any]:
    subj = inp.subject
    industry = inp.industry or "a mid-sized organisation"
    return {
        "title": f"Practical: resolving a {subj} issue",
        "scenario": f"You work {_ctx(inp)} at {industry}. A stakeholder reports an urgent {subj} "
        "problem that is "
        "affecting several users. Information is incomplete and the stakeholder is under pressure.",
        "objective": f"Demonstrate a structured, evidence-led approach to a realistic {subj} problem.",
        "instructions": "1. Describe how you would investigate, listing the evidence you would collect.\n"
        "2. State the most likely root cause and why.\n3. Describe the fix and how you will "
        "verify it.\n4. Write the update you would send to the stakeholder.",
        "required_evidence": [
            {"id": "analysis", "label": "Written analysis", "type": "text", "required": True},
            {
                "id": "evidence",
                "label": "Supporting evidence (screenshots, logs or notes)",
                "type": "file",
                "required": False,
            },
        ],
        "expected_output": f"A strong answer gathers scope/impact and logs, isolates the {subj} "
        "root cause by "
        "testing hypotheses, applies a minimal safe fix, verifies with the user and documents "
        "the outcome with a clear stakeholder update.",
        "evaluation_criteria": "Investigation quality, root-cause reasoning, solution safety and "
        "verification, "
        "communication.",
        "passing_score": 70.0,
        "rubric": build_rubric(inp),
    }


def build_flashcards(inp: GenerationInput, topics: list[str]) -> dict[str, Any]:
    cards = []
    for t in topics:
        cards.append(
            {
                "front": f"What is the goal of {t.lower()}?",
                "back": f"To apply {inp.subject} reliably: gather evidence, act safely, verify and document.",
            }
        )
    if inp.source_text:
        for s in sentences(inp.source_text)[:6]:
            kw = keywords(s, 1)
            if kw:
                cards.append({"front": f"Explain: {kw[0]}", "back": s})
    cards.append(
        {
            "front": "Why verify after a fix?",
            "back": "To confirm the problem is actually resolved and no side effects were introduced.",
        }
    )
    return {"title": f"{_title(inp.subject)} flashcards", "cards": cards}


def build_revision_notes(inp: GenerationInput, topics: list[str]) -> dict[str, Any]:
    return {
        "title": f"{_title(inp.subject)} revision notes",
        "summary": f"Key ideas to remember about {inp.subject} {_ctx(inp)}.",
        "sections": [
            {
                "heading": t,
                "points": [
                    f"Define {t.lower()} in your own words.",
                    "Use evidence before acting.",
                    "Verify outcomes and document decisions.",
                ],
            }
            for t in topics
        ],
        "key_terms": [
            {"term": "Root cause", "definition": "The underlying reason a problem occurs."},
            {"term": "Verification", "definition": "Confirming a change achieved the intended outcome."},
        ],
    }


def build_case_study(inp: GenerationInput) -> dict[str, Any]:
    subj = inp.subject
    return {
        "title": f"Case study: a {subj} incident",
        "context": f"An organisation {_ctx(inp)} experienced a "
        f"disruption related to {subj}. Early fixes addressed symptoms rather than the cause.",
        "challenge": "Work out what went wrong in the response and what should have been done differently.",
        "questions": [
            "What evidence was available early on?",
            "Which assumptions were untested?",
            "What would a structured response have looked like?",
        ],
        "model_analysis": "The team skipped evidence gathering; a structured investigation "
        "would have isolated "
        "the cause sooner and avoided repeated outages.",
    }


def build_scenario(inp: GenerationInput) -> dict[str, Any]:
    subj = inp.subject
    return {
        "title": f"{_title(subj)} simulation",
        "industry": (inp.industry or "it").lower()[:32],
        "environment_type": "helpdesk",
        "description": f"The learner handles a live {subj} incident from first report to resolution.",
        "learner_role": "Support analyst",
        "objectives": [
            f"Investigate a {subj} problem methodically",
            "Identify the root cause",
            "Fix, verify and communicate",
        ],
        "phases": ["INITIAL", "INVESTIGATION", "DIAGNOSIS", "REMEDIATION", "VALIDATION", "RESOLUTION"],
        "characters": [
            {
                "name": "Alex",
                "role": "Affected user",
                "persona": "Stressed, non-technical, cooperative when reassured",
            }
        ],
        "hidden_root_cause": f"A misconfiguration introduced during a recent {subj} change.",
        "key_actions": [
            "Ask about scope and recent changes",
            "Check logs",
            "Test the hypothesis",
            "Apply the fix",
            "Confirm with the user",
            "Document",
        ],
        "red_herrings": ["A recent unrelated software update"],
    }


def build_module(inp: GenerationInput, title: str, week: int | None, n_lessons: int = 2) -> dict[str, Any]:
    subs = [title] + [
        f"{title}: applying it" if i == 1 else f"{title}: deeper dive {i}" for i in range(1, n_lessons)
    ]
    return {
        "title": title,
        "description": f"Module covering {title.lower()}.",
        "week": week,
        "lessons": [build_lesson(inp, s, with_check=False) for s in subs],
        "quiz": build_quiz(inp, subs, count=min(inp.question_count, 4), title=f"Quiz: {title}"),
    }


def build_course(inp: GenerationInput) -> dict[str, Any]:
    n_modules = inp.weeks or 3
    topics = _topics(inp, n_modules)
    modules = [build_module(inp, t, (i + 1) if inp.weeks else None) for i, t in enumerate(topics)]
    minutes = sum(lesson["duration_minutes"] for m in modules for lesson in m["lessons"])
    return {
        "title": _title(inp.subject) if len(inp.subject) < 80 else _title(inp.subject[:77]) + "...",
        "subtitle": f"A practical course {_ctx(inp)}",
        "description": f"Build practical, job-ready capability in {inp.subject} {_ctx(inp)} through lessons, "
        "quizzes, a practical assignment and a final assessment.",
        "audience": inp.audience,
        "difficulty": inp.difficulty,
        "duration_minutes": minutes,
        "learning_objectives": [_title(o) for o in inp.objectives]
        or [
            f"Explain the core concepts of {inp.subject}",
            f"Apply {inp.subject} to realistic problems",
            "Verify and communicate outcomes",
        ],
        "prerequisites": [],
        "modules": modules,
        "assignments": [build_assignment(inp)],
        "final_assessment": build_quiz(
            inp, topics, count=max(inp.question_count, 5), title=f"Final assessment: {_title(inp.subject)}"
        ),
        "flashcards": build_flashcards(inp, topics),
        "revision_notes": build_revision_notes(inp, topics),
        "simulation_suggestion": build_scenario(inp),
    }


def build_template(kind: str, raw_input: dict[str, Any]) -> dict[str, Any]:
    """Deterministic, schema-valid output for ``kind`` built purely from the inputs."""
    inp = GenerationInput.model_validate(raw_input)
    topics = _topics(inp, max(3, min(6, inp.weeks or 3)))
    builders = {
        "course": lambda: build_course(inp),
        "module": lambda: build_module(inp, topics[0], None, 3),
        "lesson": lambda: build_lesson(inp, topics[0]),
        "quiz": lambda: build_quiz(inp, topics),
        "assignment": lambda: build_assignment(inp),
        "rubric": lambda: build_rubric(inp),
        "flashcards": lambda: build_flashcards(inp, topics),
        "revision_notes": lambda: build_revision_notes(inp, topics),
        "case_study": lambda: build_case_study(inp),
        "scenario": lambda: build_scenario(inp),
    }
    out = builders[kind]()
    if kind == "lesson":
        out["case_study"] = build_case_study(inp)
    return validate_output(kind, out)
