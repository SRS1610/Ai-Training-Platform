"""Declarative simulation definition schema (Pydantic v2).

A definition is pure data: it describes the work environment (panels and tools), the people the learner
talks to (characters and the facts they know), a configurable phase state machine, variables (including
secret ones such as the root cause), the actions a learner can take and their consequences, timed or
conditional events, scoring and feedback rules. See ``docs/SIMULATION_ENGINE.md`` for the full reference.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

SCHEMA_VERSION = "1.0"

#: JSON-logic style condition (see :mod:`simulation_engine.conditions`). ``None`` means "always true".
Condition = Any

ActionKind = Literal["ask", "command", "inspect", "select", "submit", "document", "escalate"]
InputType = Literal["none", "free_text", "command", "choice"]
Classification = Literal["correct", "neutral", "incorrect", "critical"]
Visibility = Literal["public", "internal", "secret"]

KNOWN_PANEL_TYPES = frozenset({
    "ticket", "chat", "terminal", "system_info", "knowledge_base", "email_inbox", "email_viewer", "siem_alerts",
    "url_sandbox", "crm_record", "patient_chart", "dashboard", "document", "log_viewer", "checklist",
    "admin_console", "case_file", "custom",
})

DEFAULT_PHASE_ORDER = ["INITIAL", "INVESTIGATION", "DIAGNOSIS", "REMEDIATION", "VALIDATION", "RESOLUTION"]


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


# ---------------------------------------------------------------------------------------------- meta / env


class Meta(_Model):
    title: str
    description: str = ""
    industry: str = "general"
    environment_type: str = "generic"
    difficulty: str = "intermediate"  # beginner | intermediate | advanced | expert
    estimated_minutes: int = 20
    briefing: str = ""
    learner_role: str = ""
    objectives: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)


class PanelVariant(_Model):
    """Data merged over the panel's base data while ``when`` holds (later variants win)."""

    when: Condition = None
    data: dict[str, Any] = Field(default_factory=dict)


class Panel(_Model):
    id: str
    type: str
    title: str
    data: dict[str, Any] = Field(default_factory=dict)
    visible_when: Condition = None
    variants: list[PanelVariant] = Field(default_factory=list)


class Environment(_Model):
    layout: str = "workspace"
    panels: list[Panel] = Field(default_factory=list)


class Tool(_Model):
    id: str
    name: str
    panel: str | None = None
    description: str = ""
    icon: str | None = None
    prompt: str = ""  # e.g. a terminal prompt "PS C:\\>"
    unknown_input_output: str = ""  # e.g. "'{{$input.text}}' is not recognized as ..."
    visible_when: Condition = None


# ---------------------------------------------------------------------------------------------- characters


class Fact(_Model):
    """Something a character knows. Revealed by an action effect, by a free-text question matching one of
    ``intents`` (while ``when`` holds), or automatically when ``auto_reveal`` and ``when`` hold."""

    id: str
    text: str
    intents: list[str] = Field(default_factory=list)
    when: Condition = None
    auto_reveal: bool = False


class Character(_Model):
    id: str
    name: str
    role: str = ""
    persona: str = ""
    avatar: str | None = None
    tone: str = ""
    facts: list[Fact] = Field(default_factory=list)
    fallback_reply: str = "Sorry, I'm not sure what you mean. Could you rephrase that?"
    patience_var: str | None = None
    patience_decay_per_minute: float = 0.0


class Intent(_Model):
    """A learner intent recognised in free text. ``patterns`` are keyword phrases (all words must be present,
    synonyms / stems / small typos tolerated); ``examples`` are whole sentences compared by word overlap."""

    id: str
    description: str = ""
    patterns: list[str] = Field(default_factory=list)
    examples: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------------------------- state machine


class AutoAdvance(_Model):
    to: str
    when: Condition


class Phase(_Model):
    id: str
    name: str
    description: str = ""
    transitions: list[str] = Field(default_factory=list)
    auto_advance: list[AutoAdvance] = Field(default_factory=list)
    terminal: bool = False


def default_phases() -> list[Phase]:
    names = {
        "INITIAL": "Initial", "INVESTIGATION": "Investigation", "DIAGNOSIS": "Diagnosis",
        "REMEDIATION": "Remediation", "VALIDATION": "Validation", "RESOLUTION": "Resolution",
    }
    out = []
    for i, pid in enumerate(DEFAULT_PHASE_ORDER):
        nxt = DEFAULT_PHASE_ORDER[i + 1:i + 2]
        out.append(Phase(id=pid, name=names[pid], transitions=nxt, terminal=pid == "RESOLUTION"))
    return out


class VariableSpec(_Model):
    type: Literal["bool", "int", "float", "str", "list", "dict", "any"] = "any"
    initial: Any = None
    visibility: Visibility = "internal"
    label: str = ""
    description: str = ""
    pool: list[Any] | None = None  # seeded variation: one value picked per session
    min: float | None = None
    max: float | None = None


class Variation(_Model):
    id: str
    label: str = ""
    weight: float = 1.0
    set: dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------------------------------- actions


class Problem(_Model):
    id: str
    text: str
    severity: Literal["low", "medium", "high", "critical"] = "medium"


class Effect(_Model):
    """A state change. Keys present are applied in this order: set, inc, reveal, add_problem,
    remove_problem, transition, trigger_event, complete. ``set`` values may be conditions (evaluated)."""

    set: dict[str, Any] | None = None
    inc: dict[str, float] | None = None
    reveal: list[str] = Field(default_factory=list)
    add_problem: Problem | None = None
    remove_problem: str | None = None
    transition: str | None = None
    trigger_event: str | None = None
    complete: Literal["success", "failure", "escalated"] | None = None


class Message(_Model):
    character: str | None = None  # None = system notice
    text: str
    when: Condition = None


class Output(_Model):
    text: str
    when: Condition = None
    format: Literal["text", "terminal", "markdown"] = "text"
    panel: str | None = None


class OutcomeSpec(_Model):
    effects: list[Effect] = Field(default_factory=list)
    score: dict[str, float] = Field(default_factory=dict)
    classification: Classification = "neutral"
    feedback: str = ""
    outputs: list[Output] = Field(default_factory=list)  # first matching output is shown
    messages: list[Message] = Field(default_factory=list)  # every matching message is sent
    time_cost: float | None = None


class Branch(OutcomeSpec):
    """Alternative outcome selected (first match wins) by ``when``, evaluated *before* effects apply."""

    id: str | None = None
    when: Condition = True


class Choice(_Model):
    id: str
    label: str


class InputSpec(_Model):
    type: InputType = "none"
    intents: list[str] = Field(default_factory=list)  # free_text (chat) matching
    patterns: list[str] = Field(default_factory=list)  # command regexes (full match, case-insensitive)
    choices: list[Choice] = Field(default_factory=list)
    placeholder: str = ""
    min_length: int = 0


class RepeatPolicy(_Model):
    """What happens when an action is taken again. ``diminish``: positive score deltas only count the
    first time; ``allow``: full deltas every time; ``penalize``: like diminish plus ``penalty`` on every
    repeat; ``block``: the action is rejected after the first time. ``penalty`` is also applied to
    repeats beyond ``free_repeats`` in every mode."""

    mode: Literal["diminish", "allow", "penalize", "block"] = "diminish"
    free_repeats: int = 1
    penalty: dict[str, float] = Field(default_factory=dict)
    message: str = ""


class Action(OutcomeSpec):
    id: str
    tool: str
    label: str
    kind: ActionKind = "inspect"
    description: str = ""
    character: str | None = None
    input: InputSpec = Field(default_factory=InputSpec)
    preconditions: Condition = None
    precondition_message: str = "That isn't possible right now."
    phases: list[str] = Field(default_factory=list)  # empty = available in every phase
    branches: list[Branch] = Field(default_factory=list)
    repeat: RepeatPolicy | None = None
    listed: bool | None = None  # shown as a button/menu entry; default False for command/ask
    hint: str = ""
    tags: list[str] = Field(default_factory=list)
    time_cost: float | None = 1.0


# ---------------------------------------------------------------------------------------------- events


class EventTrigger(_Model):
    type: Literal["time", "condition", "after_action"]
    at_minutes: float | None = None
    condition: Condition = None
    action: str | None = None


class Event(OutcomeSpec):
    id: str
    title: str = ""
    description: str = ""
    trigger: EventTrigger
    once: bool = True
    max_fires: int | None = None
    notify: str = ""  # learner-visible notification text


# ---------------------------------------------------------------------------------------------- scoring


class Dimension(_Model):
    id: str
    name: str
    weight: float
    max_points: float = 10.0
    baseline: Literal["zero", "full"] = "zero"
    description: str = ""


class EfficiencySpec(_Model):
    dimension: str = "efficiency"
    target_minutes: float
    max_minutes: float
    require_success: bool = True  # efficiency only counts for successfully completed runs


class ProcessSpec(_Model):
    dimension: str = "troubleshooting_process"
    required_order: list[str] = Field(default_factory=lambda: list(DEFAULT_PHASE_ORDER))
    skip_penalty: float = 4.0


class Band(_Model):
    name: str
    min: float


def default_bands() -> list[Band]:
    return [Band(name="Expert", min=95), Band(name="Advanced", min=85), Band(name="Competent", min=70),
            Band(name="Needs Improvement", min=50), Band(name="Fail", min=0)]


class Scoring(_Model):
    dimensions: list[Dimension]
    efficiency: EfficiencySpec | None = None
    process: ProcessSpec | None = None
    bands: list[Band] = Field(default_factory=default_bands)
    pass_mark: float = 70.0
    critical_cap: float | None = 49.0  # total is capped here if any critical action was taken
    require_completion: bool = True  # unfinished runs cannot pass


class Completion(_Model):
    success: Condition = None
    failure: Condition = None
    max_sim_minutes: float | None = None
    max_actions: int | None = None


class FeedbackRule(_Model):
    id: str
    when: Condition
    type: Literal["strength", "improvement", "missed_step", "tip"]
    text: str
    priority: int = 0


class UnknownInputPolicy(_Model):
    penalty: dict[str, float] = Field(default_factory=lambda: {"communication": -1.0})
    max_penalised: int = 5
    time_cost: float = 0.5
    reply: str = "I'm not sure what you mean."


class Settings(_Model):
    unknown_input: UnknownInputPolicy = Field(default_factory=UnknownInputPolicy)
    repeat: RepeatPolicy = Field(default_factory=RepeatPolicy)
    show_feedback: bool = True  # per-action feedback hints for ungraded runs
    show_feedback_when_graded: bool = False
    ai_character_voice: bool = True  # allow the AI layer to rephrase character replies
    session_timeout_minutes: int = 240  # wall-clock minutes before an idle session expires


class SimulationDefinition(_Model):
    schema_version: str = SCHEMA_VERSION
    key: str | None = None
    meta: Meta
    environment: Environment = Field(default_factory=Environment)
    tools: list[Tool] = Field(default_factory=list)
    characters: list[Character] = Field(default_factory=list)
    intents: list[Intent] = Field(default_factory=list)
    synonyms: dict[str, list[str]] = Field(default_factory=dict)
    phases: list[Phase] = Field(default_factory=default_phases)
    initial_phase: str = "INITIAL"
    variables: dict[str, VariableSpec] = Field(default_factory=dict)
    variations: list[Variation] = Field(default_factory=list)
    opening_messages: list[Message] = Field(default_factory=list)
    actions: list[Action] = Field(default_factory=list)
    events: list[Event] = Field(default_factory=list)
    scoring: Scoring
    completion: Completion = Field(default_factory=Completion)
    feedback_rules: list[FeedbackRule] = Field(default_factory=list)
    settings: Settings = Field(default_factory=Settings)

    # -- lookups (not cached: definitions are small and treated as immutable values)
    def action(self, action_id: str) -> Action | None:
        return next((a for a in self.actions if a.id == action_id), None)

    def phase(self, phase_id: str) -> Phase | None:
        return next((p for p in self.phases if p.id == phase_id), None)

    def character(self, character_id: str) -> Character | None:
        return next((c for c in self.characters if c.id == character_id), None)

    def tool(self, tool_id: str) -> Tool | None:
        return next((t for t in self.tools if t.id == tool_id), None)

    def panel(self, panel_id: str) -> Panel | None:
        return next((p for p in self.environment.panels if p.id == panel_id), None)

    def event(self, event_id: str) -> Event | None:
        return next((e for e in self.events if e.id == event_id), None)

    def fact(self, fact_id: str) -> tuple[Character, Fact] | None:
        for c in self.characters:
            for f in c.facts:
                if f.id == fact_id:
                    return c, f
        return None

    def dimension_ids(self) -> list[str]:
        return [d.id for d in self.scoring.dimensions]


def parse_definition(data: SimulationDefinition | dict[str, Any]) -> SimulationDefinition:
    """Accept a model or a plain dict (raises ``pydantic.ValidationError`` on bad structure)."""
    if isinstance(data, SimulationDefinition):
        return data
    return SimulationDefinition.model_validate(data)
