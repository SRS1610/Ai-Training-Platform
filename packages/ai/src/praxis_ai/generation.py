"""Structured output schemas for AI content generation, schema hints for prompts, and deterministic
template builders (used by the Offline provider and as a last-resort fallback).

Every generation kind validates against a Pydantic model here before an instructor can review it.
"""

from __future__ import annotations

import math
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


def _lc(s: str) -> str:
    """``s`` for use mid-sentence: first letter lower-cased unless it starts an acronym (``IT``, ``DNS``)."""
    s = s.strip()
    if len(s) > 1 and s[1].isupper():
        return s
    return s[:1].lower() + s[1:]


def _industry(industry: str) -> str:
    """Industry for mid-sentence use: acronyms kept (``IT``), other words lower-cased (``banking``)."""
    return " ".join(w if len(w) > 1 and w.isupper() else w.lower() for w in industry.split())


def _ctx(inp: GenerationInput) -> str:
    bits = [f"for {inp.audience}"]
    if inp.industry:
        bits.append(f"in the {_industry(inp.industry)} industry")
    return " ".join(bits)


def _workplace(inp: GenerationInput) -> str:
    if inp.industry:
        return f"a mid-sized organisation in the {_industry(inp.industry)} sector"
    return "a mid-sized organisation"


WORDS_PER_MINUTE = 200
MIN_LESSON_MINUTES = 2


def reading_minutes(*texts: str) -> int:
    """Estimated reading time at ~200 words per minute (never less than two minutes)."""
    words = sum(len((t or "").split()) for t in texts)
    return max(MIN_LESSON_MINUTES, math.ceil(words / WORDS_PER_MINUTE))


def _source_sentences(inp: GenerationInput, topic: str, k: int = 3) -> list[str]:
    if not inp.source_text:
        return []
    from praxis_ai.text import overlap

    ss = sentences(inp.source_text)
    ranked = sorted(ss, key=lambda s: -overlap(topic, s))
    return [s for s in ranked[:k] if len(s) > 20]


# Lesson "angles": the first lesson of a module is the overview (titled with the topic itself); further
# lessons look at the same topic from a distinct, practical angle so titles and content are not repetitive.
LESSON_ANGLES: list[dict[str, Any]] = [
    {
        "name": "a worked example",
        "summary": "See {topic} applied step by step in a realistic {subj} situation.",
        "intro": "Here you follow one realistic situation from first report to verified outcome, so you can "
        "see {topic} applied end to end.",
        "heading": "The situation, step by step",
        "points": [
            "1. **Report** — a user reports an urgent {subj} problem that is affecting their team.",
            "2. **Investigate** — you confirm scope, impact and recent changes before touching anything.",
            "3. **Diagnose** — you test the most likely hypothesis with the least disruptive check first.",
            "4. **Resolve and verify** — you apply a minimal fix and confirm with the user that it worked.",
            "5. **Record** — you document what happened so the next person can resolve it faster.",
        ],
    },
    {
        "name": "common pitfalls",
        "summary": "Recognise and avoid the most common mistakes in {topic}.",
        "intro": "Most problems with {topic} come from a handful of avoidable mistakes. This lesson shows "
        "how to spot them early and what to do instead.",
        "heading": "Pitfalls to avoid",
        "points": [
            "- **Acting before investigating** — a familiar fix applied without evidence often hides the "
            "real cause.",
            "- **Skipping verification** — a change that 'should' work is not a confirmed outcome.",
            "- **Going quiet** — stakeholders who are not kept informed escalate and lose confidence.",
            "- **No record** — without documentation the same {subj} issue is solved from scratch next time.",
        ],
    },
    {
        "name": "tools and checklists",
        "summary": "Use a repeatable checklist to apply {topic} consistently.",
        "intro": "Experienced practitioners rely on simple, repeatable checklists. This lesson gives you one "
        "for {topic} that you can adapt to your own team.",
        "heading": "A practical checklist",
        "points": [
            "- Scope, impact and urgency confirmed with the person reporting the problem.",
            "- Recent changes and relevant logs reviewed.",
            "- Hypothesis written down and tested with the least disruptive check.",
            "- Fix applied, verified with the user and checked for side effects.",
            "- Outcome and next steps documented and communicated.",
        ],
    },
    {
        "name": "handling complex cases",
        "summary": "Handle {topic} when information is incomplete or the stakes are high.",
        "intro": "Not every situation is straightforward. This lesson looks at {topic} when information is "
        "incomplete, several teams are involved or the business impact is high.",
        "heading": "When it gets harder",
        "points": [
            "- **Intermittent problems** — collect timestamps and patterns before drawing conclusions.",
            "- **Several teams involved** — agree who owns the problem and who decides on changes.",
            "- **High impact** — escalate early, communicate on a fixed schedule and keep a decision log.",
        ],
    },
]


def lesson_title(topic: str, angle: int) -> str:
    if angle <= 0:
        return topic
    spec = LESSON_ANGLES[(angle - 1) % len(LESSON_ANGLES)]
    cycle = (angle - 1) // len(LESSON_ANGLES)
    return f"{topic}: {spec['name']}" + (f" (part {cycle + 1})" if cycle else "")


def build_lesson(
    inp: GenerationInput, topic: str, *, with_check: bool = True, angle: int = 0
) -> dict[str, Any]:
    subj = inp.subject
    lc = _lc(topic)
    grounded = _source_sentences(inp, topic)
    title = lesson_title(topic, angle)
    if angle <= 0:
        summary = f"Understand and apply {lc} {_ctx(inp)}."
        body = [
            f"# {title}",
            "",
            f"This lesson introduces **{lc}** {_ctx(inp)}. By the end you will be able to explain why "
            "it matters, recognise it in day-to-day work and apply it confidently.",
            "",
            "## Why it matters",
            f"Teams that understand {lc} resolve issues faster, communicate more clearly with "
            f"stakeholders and make fewer costly mistakes. In {subj}, small misunderstandings here often "
            "cascade into larger incidents.",
            "",
            "## Key ideas",
            f"1. **Definition** — what {lc} means and the vocabulary used by practitioners.",
            "2. **Process** — the typical sequence: identify, investigate, decide, act and verify.",
            "3. **Signals** — the evidence that tells you something is going right or wrong.",
            "4. **Communication** — how to document and explain your reasoning to others.",
        ]
    else:
        spec = LESSON_ANGLES[(angle - 1) % len(LESSON_ANGLES)]
        fmt = {"topic": lc, "subj": subj}
        summary = spec["summary"].format(**fmt)
        body = [
            f"# {title}",
            "",
            spec["intro"].format(**fmt),
            "",
            f"## {spec['heading']}",
            *[p.format(**fmt) for p in spec["points"]],
        ]
    if grounded:
        body += ["", "## From your materials", *[f"> {s}" for s in grounded]]
    if angle <= 0:
        body += [
            "",
            "## Worked example",
            f"A colleague reports a problem related to {subj}. Rather than guessing, you gather facts, form "
            "a hypothesis, test it with the least disruptive check first, and record what you found.",
        ]
    body += [
        "",
        "## Summary",
        f"{_title(topic)} is a practical skill: ask good questions, use evidence, act safely and verify the "
        "outcome.",
    ]
    examples = [
        f"Example: applying {lc} when a customer reports an urgent {subj} issue.",
        f"Example: reviewing a past {subj} incident to find what evidence was missed.",
    ]
    key_points = [
        f"Use evidence before acting on {lc}.",
        "Verify the outcome and document it.",
        "Escalate early when impact or risk is high.",
    ]
    markdown = "\n".join(body)
    lesson: dict[str, Any] = {
        "title": title,
        "summary": summary,
        "duration_minutes": reading_minutes(markdown, *examples, *key_points),
        "body_markdown": markdown,
        "examples": examples,
        "key_points": key_points,
        "case_study": None,
        "knowledge_check": build_quiz(inp, [topic], count=2, title=f"Check: {title}") if with_check else None,
    }
    return lesson


# --------------------------------------------------------------------------- question variants
# Each (topic, type, variant) combination yields a distinct question. Prompts carry the topic as a label so
# they read correctly whether the topic is a noun phrase ("Foundations of DNS") or an objective
# ("Triage incidents").

_MC_VARIANTS: list[tuple[str, str, list[str], str]] = [
    (
        "Which approach best reflects good practice in {subj}?",
        "Gather evidence, form a hypothesis and test it before changing anything",
        [
            "Apply the most common fix immediately without investigating",
            "Wait for the problem to resolve itself",
            "Escalate every issue without collecting any details",
        ],
        "Evidence-led investigation avoids unnecessary changes and finds the real cause.",
    ),
    (
        "A new {subj} problem has just been reported. What should you do first?",
        "Confirm the scope, the impact and any recent changes",
        [
            "Apply the fix that worked last time",
            "Close the ticket and wait for the user to call back",
            "Restart every affected system at once",
        ],
        "Understanding scope, impact and recent changes guides a safe, targeted response.",
    ),
    (
        "How do you know that your {subj} work was successful?",
        "The affected users confirm the outcome and you have checked for side effects",
        [
            "Nobody has complained for an hour",
            "The change was applied without errors",
            "A colleague agreed the fix looked right",
        ],
        "Only verification with the people affected, plus a check for side effects, confirms success.",
    ),
    (
        "Why should you document your {subj} work as you go?",
        "So colleagues can understand, repeat or audit what was done",
        [
            "Documentation is only needed when a fix fails",
            "It is only required by auditors once a year",
            "It replaces the need to verify the fix",
        ],
        "Clear records speed up future work and support accountability.",
    ),
]
_MS_VARIANTS: list[tuple[str, list[str], list[str], str]] = [
    (
        "Select ALL good practices in {subj}.",
        [
            "Gather evidence, form a hypothesis and test it before changing anything",
            "Document what you found and verify the outcome",
        ],
        [
            "Apply the most common fix immediately without investigating",
            "Wait for the problem to resolve itself",
            "Escalate every issue without collecting any details",
        ],
        "Evidence-led investigation, verification and documentation are core practices.",
    ),
    (
        "Select ALL the information worth collecting before you act on a new {subj} problem.",
        [
            "The scope and number of affected users",
            "Recent changes to the systems involved",
            "Relevant logs or error messages",
        ],
        ["The user's opinion of the support team", "Unrelated tickets from last year"],
        "Scope, recent changes and logs point to the cause; opinions and unrelated history do not.",
    ),
]
_TF_VARIANTS: list[tuple[str, bool, str]] = [
    (
        "In {subj}, decisions should be based on evidence gathered before taking action.",
        True,
        "Evidence-led work avoids unnecessary changes.",
    ),
    (
        "In {subj}, it is best practice to skip verification once a fix is applied.",
        False,
        "Always verify the outcome; skipping verification hides unresolved problems.",
    ),
    (
        "Documenting decisions helps colleagues handle similar {subj} issues later.",
        True,
        "Good records make future work faster and more consistent.",
    ),
    (
        "In {subj}, the quickest fix should always be applied before any evidence is gathered.",
        False,
        "Acting without evidence often treats symptoms and hides the real cause.",
    ),
]
_SA_VARIANTS: list[tuple[str, list[str], str]] = [
    (
        "In {subj}, name the step that confirms a fix actually worked.",
        ["verification", "verify", "validation", "testing"],
        "Verification/validation confirms the fix resolved the issue.",
    ),
    (
        "In {subj}, what term describes the underlying reason a problem occurs?",
        ["root cause", "root-cause", "the root cause"],
        "The root cause is the underlying reason; fixing it prevents recurrence.",
    ),
    (
        "In {subj}, what should you do early when the impact or risk of a problem is high?",
        ["escalate", "escalation", "escalate it", "escalate early"],
        "Early escalation brings the right people and authority in before impact grows.",
    ),
]
_LONG_VARIANTS: list[tuple[str, str]] = [
    (
        "Explain, with an example from your workplace, how you would put this into practice in {subj}.",
        "A strong answer explains the key ideas, then describes gathering evidence, choosing an action, "
        "verifying the outcome and documenting it.",
    ),
    (
        "Describe a situation in {subj} where this went wrong. What evidence would have helped, and what "
        "would you do differently?",
        "A strong answer identifies the missing evidence or untested assumption, explains its impact and "
        "proposes a structured, verified approach.",
    ),
]
_SCENARIO_VARIANTS: list[tuple[str, str]] = [
    (
        "Scenario: a stakeholder reports an urgent {subj} problem and wants it fixed immediately. Describe "
        "your first three steps and how you would keep them informed.",
        "A strong answer confirms scope and impact, investigates before changing anything, sets "
        "expectations and agrees a time for the next update.",
    ),
    (
        "Scenario: your first fix for the {subj} problem did not work and users are frustrated. What do "
        "you do next?",
        "A strong answer reverts or contains the change safely, revisits the evidence, tests a new "
        "hypothesis and communicates honestly with users.",
    ),
]


_GROUNDED_PER_TOPIC = 5
# Upper bound on variants of any type (grounded fill-in-the-blanks come before the generic short answers).
_MAX_VARIANTS = _GROUNDED_PER_TOPIC + max(
    len(v)
    for v in (_MC_VARIANTS, _MS_VARIANTS, _TF_VARIANTS, _SA_VARIANTS, _LONG_VARIANTS, _SCENARIO_VARIANTS)
)


def _key(prompt: str) -> str:
    return " ".join(prompt.lower().split())


def _labelled(prompt: str, topic: str) -> str:
    return f"{prompt} (Topic: {_title(topic)})"


def _question(inp: GenerationInput, topic: str, qtype: str, variant: int, rot: int) -> dict[str, Any] | None:
    """Question ``variant`` of ``qtype`` about ``topic``, or None once that type has no more variants."""
    subj = inp.subject
    fmt = {"subj": subj}
    if qtype in ("short_answer", "fill_blank"):
        grounded = _source_sentences(inp, topic, _GROUNDED_PER_TOPIC)
        if variant < len(grounded):
            sent = grounded[variant]
            terms = [t for t in keywords(sent, 5) if len(t) > 3]
            if terms:
                word = next(
                    (
                        w
                        for w in re.findall(r"[A-Za-z][A-Za-z\-]{3,}", sent)
                        if w.lower().startswith(terms[0])
                    ),
                    terms[0],
                )
                prompt = "Complete the statement: " + re.sub(
                    re.escape(word), "_____", sent, count=1, flags=re.I
                )
                return {
                    "type": "fill_blank" if qtype == "fill_blank" else "short_answer",
                    "prompt": prompt,
                    "_key": _key(prompt),
                    "choices": [],
                    "answer_key": {"accepted": [word.lower()]},
                    "explanation": f"From the course material: “{sent}”",
                    "difficulty": 2,
                    "points": 1.0,
                }
            return None  # try the next variant (a later pass reaches the generic questions)
        v = variant - len(grounded)
        if v >= len(_SA_VARIANTS):
            return None
        prompt, accepted, why = _SA_VARIANTS[v]
        return {
            "type": "short_answer",
            "prompt": _labelled(prompt.format(**fmt), topic),
            "_key": _key(prompt.format(**fmt)),
            "choices": [],
            "answer_key": {"accepted": accepted},
            "explanation": why,
            "difficulty": 2,
            "points": 1.0,
        }
    if qtype == "true_false":
        if variant >= len(_TF_VARIANTS):
            return None
        statement, value, why = _TF_VARIANTS[variant]
        return {
            "type": "true_false",
            "prompt": _labelled(statement.format(**fmt), topic),
            "_key": _key(statement.format(**fmt)),
            "choices": [],
            "answer_key": {"value": value},
            "explanation": why,
            "difficulty": 1,
            "points": 1.0,
        }
    if qtype in ("long_answer", "scenario"):
        variants = _LONG_VARIANTS if qtype == "long_answer" else _SCENARIO_VARIANTS
        if variant >= len(variants):
            return None
        prompt, model = variants[variant]
        return {
            "type": qtype,
            "prompt": _labelled(prompt.format(**fmt), topic),
            "_key": _key(prompt.format(**fmt)),
            "choices": [],
            "answer_key": {"model_answer": model},
            "explanation": "Look for evidence gathering, a clear decision, verification and communication.",
            "difficulty": 3,
            "points": 5.0,
        }
    if qtype == "multiple_select":
        if variant >= len(_MS_VARIANTS):
            return None
        prompt, correct, wrong, why = _MS_VARIANTS[variant]
        texts = correct + wrong
        shift = (rot + variant) % len(texts)
        ordered = texts[shift:] + texts[:shift]
        choices = [{"id": chr(97 + i), "text": t} for i, t in enumerate(ordered)]
        return {
            "type": "multiple_select",
            "prompt": _labelled(prompt.format(**fmt), topic),
            "_key": _key(prompt.format(**fmt)),
            "choices": choices,
            "answer_key": {"choice_ids": [c["id"] for c in choices if c["text"] in correct]},
            "explanation": why,
            "difficulty": 2,
            "points": 1.0,
        }
    # multiple_choice (also the fallback for unknown types)
    if variant >= len(_MC_VARIANTS):
        return None
    prompt, correct, distractors, why = _MC_VARIANTS[variant]
    pos = (rot + variant) % (len(distractors) + 1)
    options = distractors[:]
    options.insert(pos, correct)
    return {
        "type": "multiple_choice",
        "prompt": _labelled(prompt.format(**fmt), topic),
        "_key": _key(prompt.format(**fmt)),
        "choices": [{"id": chr(97 + i), "text": t} for i, t in enumerate(options)],
        "answer_key": {"choice_ids": [chr(97 + pos)]},
        "explanation": why,
        "difficulty": 2,
        "points": 1.0,
    }


def build_quiz(
    inp: GenerationInput, topics: list[str], *, count: int | None = None, title: str | None = None
) -> dict[str, Any]:
    """Up to ``count`` questions, every one distinct. Variants are visited type by type (so the first
    questions mix the requested types) and labelled with the topics in turn; a question whose wording
    (ignoring the topic label) was already used is skipped. When fewer unique questions exist than were
    requested the quiz is capped at the unique ones instead of repeating questions."""
    n = count or inp.question_count
    known = typing.get_args(QuestionKind)
    types_ = list(dict.fromkeys(t for t in inp.question_types if t in known)) or ["multiple_choice"]
    topics_ = list(dict.fromkeys(t for t in topics if t and t.strip())) or [_title(inp.subject)]
    qs: list[dict[str, Any]] = []
    seen: set[str] = set()
    for variant in range(_MAX_VARIANTS):
        for qtype in types_:
            if len(qs) >= n:
                break
            q = _question(inp, topics_[len(qs) % len(topics_)], qtype, variant, rot=len(qs))
            if q is None:
                continue
            key = q.pop("_key")
            if key in seen:
                continue
            seen.add(key)
            qs.append(q)
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
    return {
        "title": f"Practical: resolving a {subj} issue",
        "scenario": f"You are part of a team of {inp.audience} at {_workplace(inp)}. A stakeholder reports "
        f"an urgent {subj} problem that is affecting several users. Information is incomplete and the "
        "stakeholder is under pressure.",
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
                "front": f"What is the goal of {_lc(t)}?",
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
                    f"Define {_lc(t)} in your own words.",
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
    return {
        "title": title,
        "description": f"Module covering {_lc(title)}.",
        "week": week,
        "lessons": [build_lesson(inp, title, with_check=False, angle=i) for i in range(max(1, n_lessons))],
        "quiz": build_quiz(inp, [title], count=min(inp.question_count, 4), title=f"Quiz: {title}"),
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
