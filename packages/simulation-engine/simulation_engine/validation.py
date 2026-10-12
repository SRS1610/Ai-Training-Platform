"""Static validation of simulation definitions (errors block publishing, warnings are advisory) and a
best-effort ``repair`` used to sanitise AI-generated drafts."""

from __future__ import annotations

import copy
import re
from collections import Counter
from dataclasses import dataclass, field
from typing import Any

from pydantic import ValidationError

from simulation_engine.conditions import check_condition
from simulation_engine.schema import (
    DEFAULT_PHASE_ORDER,
    KNOWN_PANEL_TYPES,
    SimulationDefinition,
    default_phases,
)

_TPL = re.compile(r"\{\{\s*([$A-Za-z_][\w.$]*)\s*\}\}")


@dataclass
class Issue:
    code: str
    path: str
    message: str

    def as_dict(self) -> dict[str, str]:
        return {"code": self.code, "path": self.path, "message": self.message}


@dataclass
class ValidationReport:
    errors: list[Issue] = field(default_factory=list)
    warnings: list[Issue] = field(default_factory=list)
    stats: dict[str, Any] = field(default_factory=dict)

    @property
    def valid(self) -> bool:
        return not self.errors

    def error(self, code: str, path: str, message: str) -> None:
        self.errors.append(Issue(code, path, message))

    def warn(self, code: str, path: str, message: str) -> None:
        self.warnings.append(Issue(code, path, message))

    def as_dict(self) -> dict[str, Any]:
        return {"valid": self.valid, "errors": [e.as_dict() for e in self.errors],
                "warnings": [w.as_dict() for w in self.warnings], "stats": self.stats}


def _dupes(ids: list[str]) -> list[str]:
    return [k for k, n in Counter(ids).items() if n > 1]


def validate(definition: SimulationDefinition | dict[str, Any]) -> ValidationReport:
    """Validate structure, references, the phase graph, scoring and learner-visible secrets."""
    report = ValidationReport()
    if isinstance(definition, SimulationDefinition):
        d = definition
    else:
        try:
            d = SimulationDefinition.model_validate(definition)
        except ValidationError as exc:
            for err in exc.errors()[:50]:
                report.error("schema", ".".join(str(p) for p in err["loc"]), err["msg"])
            return report
    _check(d, report)
    report.stats = {"actions": len(d.actions), "phases": len(d.phases), "events": len(d.events),
                    "characters": len(d.characters), "facts": sum(len(c.facts) for c in d.characters),
                    "panels": len(d.environment.panels), "tools": len(d.tools)}
    return report


def _check(d: SimulationDefinition, r: ValidationReport) -> None:  # noqa: C901 - linear checklist
    panels = {p.id for p in d.environment.panels}
    tools = {t.id for t in d.tools}
    chars = {c.id for c in d.characters}
    facts = {f.id for c in d.characters for f in c.facts}
    phases = {p.id for p in d.phases}
    actions = {a.id for a in d.actions}
    events = {e.id for e in d.events}
    intents = {i.id for i in d.intents}
    dims = set(d.dimension_ids())
    variables = set(d.variables)
    problems = {eff.add_problem.id for a in d.actions for br in [a, *a.branches] for eff in br.effects
                if eff.add_problem} | {eff.add_problem.id for e in d.events for eff in e.effects if eff.add_problem}
    secret = {k for k, v in d.variables.items() if v.visibility == "secret"}

    for label, ids in (("panel", [p.id for p in d.environment.panels]), ("tool", [t.id for t in d.tools]),
                       ("character", [c.id for c in d.characters]),
                       ("fact", [f.id for c in d.characters for f in c.facts]),
                       ("phase", [p.id for p in d.phases]), ("action", [a.id for a in d.actions]),
                       ("event", [e.id for e in d.events]), ("intent", [i.id for i in d.intents]),
                       ("dimension", d.dimension_ids()), ("feedback_rule", [f.id for f in d.feedback_rules])):
        for dup in _dupes(ids):
            r.error("duplicate_id", label, f"Duplicate {label} id '{dup}'")

    def cond(c: Any, path: str) -> None:
        if c is None:
            return
        errors, refs = check_condition(c)
        for e in errors:
            r.error("condition", path, e)
        for kind, known in (("variables", variables), ("facts", facts), ("phases", phases), ("actions", actions),
                            ("events", events), ("problems", problems)):
            for ref in sorted(refs[kind] - known):
                r.error("unknown_ref", path, f"Condition references unknown {kind[:-1]} '{ref}'")

    def text(t: str, path: str, *, learner_visible: bool = True) -> None:
        for name in _TPL.findall(t):
            if name.startswith("$"):
                continue
            base = name.split(".")[0]
            if base not in variables:
                r.error("unknown_ref", path, f"Template references unknown variable '{name}'")
            elif learner_visible and base in secret:
                r.error("secret_leak", path, f"Secret variable '{base}' must not be shown to learners")

    def walk_text(data: Any, path: str) -> None:
        if isinstance(data, str):
            text(data, path)
        elif isinstance(data, list):
            for i, x in enumerate(data):
                walk_text(x, f"{path}[{i}]")
        elif isinstance(data, dict):
            for k, v in data.items():
                walk_text(v, f"{path}.{k}")

    def outcome(spec: Any, path: str) -> None:
        for k in spec.score:
            if k not in dims:
                r.error("unknown_ref", f"{path}.score", f"Unknown scoring dimension '{k}'")
        for i, eff in enumerate(spec.effects):
            p = f"{path}.effects[{i}]"
            for name, value in {**(eff.set or {}), **(eff.inc or {})}.items():
                if name not in variables:
                    r.error("unknown_ref", p, f"Effect changes undeclared variable '{name}'")
                if isinstance(value, dict | list):
                    cond(value, p)
            for f in eff.reveal:
                if f not in facts:
                    r.error("unknown_ref", p, f"Effect reveals unknown fact '{f}'")
            if eff.transition and eff.transition not in phases:
                r.error("unknown_ref", p, f"Effect transitions to unknown phase '{eff.transition}'")
            if eff.trigger_event and eff.trigger_event not in events:
                r.error("unknown_ref", p, f"Effect triggers unknown event '{eff.trigger_event}'")
            if eff.remove_problem and eff.remove_problem not in problems:
                r.warn("unknown_ref", p, f"Effect removes problem '{eff.remove_problem}' that is never added")
            if eff.add_problem:
                text(eff.add_problem.text, p)
        for i, o in enumerate(spec.outputs):
            cond(o.when, f"{path}.outputs[{i}].when")
            text(o.text, f"{path}.outputs[{i}]")
            if o.panel and o.panel not in panels:
                r.error("unknown_ref", f"{path}.outputs[{i}]", f"Unknown panel '{o.panel}'")
        for i, m in enumerate(spec.messages):
            cond(m.when, f"{path}.messages[{i}].when")
            text(m.text, f"{path}.messages[{i}]")
            if m.character and m.character not in chars:
                r.error("unknown_ref", f"{path}.messages[{i}]", f"Unknown character '{m.character}'")

    # meta / scoring
    if not d.meta.title.strip():
        r.error("meta", "meta.title", "Title is required")
    weights = sum(dim.weight for dim in d.scoring.dimensions)
    if abs(weights - 100) > 0.01:
        r.error("weights", "scoring.dimensions", f"Dimension weights must sum to 100 (got {weights:g})")
    for i, dim in enumerate(d.scoring.dimensions):
        if dim.max_points <= 0 or dim.weight < 0:
            r.error("scoring", f"scoring.dimensions[{i}]", "max_points must be > 0 and weight >= 0")
    if d.scoring.efficiency:
        if d.scoring.efficiency.dimension not in dims:
            r.error("unknown_ref", "scoring.efficiency", "Efficiency dimension is not a scoring dimension")
        if d.scoring.efficiency.max_minutes <= d.scoring.efficiency.target_minutes:
            r.error("scoring", "scoring.efficiency", "max_minutes must be greater than target_minutes")
    if d.scoring.process:
        if d.scoring.process.dimension not in dims:
            r.error("unknown_ref", "scoring.process", "Process dimension is not a scoring dimension")
        for p in d.scoring.process.required_order:
            if p not in phases:
                r.error("unknown_ref", "scoring.process.required_order", f"Unknown phase '{p}'")
    if not d.scoring.bands:
        r.error("scoring", "scoring.bands", "At least one band is required")
    elif min(b.min for b in d.scoring.bands) > 0:
        r.warn("scoring", "scoring.bands", "No band covers a score of 0")

    # environment
    for i, p in enumerate(d.environment.panels):
        if p.type not in KNOWN_PANEL_TYPES:
            r.warn("panel_type", f"environment.panels[{i}]", f"Unknown panel type '{p.type}' (rendered generically)")
        cond(p.visible_when, f"environment.panels[{i}].visible_when")
        walk_text(p.data, f"environment.panels[{i}].data")
        for j, v in enumerate(p.variants):
            cond(v.when, f"environment.panels[{i}].variants[{j}].when")
            walk_text(v.data, f"environment.panels[{i}].variants[{j}].data")
    for i, t in enumerate(d.tools):
        if t.panel and t.panel not in panels:
            r.error("unknown_ref", f"tools[{i}]", f"Tool '{t.id}' references unknown panel '{t.panel}'")
        cond(t.visible_when, f"tools[{i}].visible_when")
        text(t.unknown_input_output, f"tools[{i}].unknown_input_output")
        text(t.prompt, f"tools[{i}].prompt")
    for i, c in enumerate(d.characters):
        if c.patience_var and c.patience_var not in variables:
            r.error("unknown_ref", f"characters[{i}]", f"Unknown patience variable '{c.patience_var}'")
        for j, f in enumerate(c.facts):
            text(f.text, f"characters[{i}].facts[{j}]")
            cond(f.when, f"characters[{i}].facts[{j}].when")
            for it in f.intents:
                if it not in intents:
                    r.error("unknown_ref", f"characters[{i}].facts[{j}]", f"Unknown intent '{it}'")
    for i, intent in enumerate(d.intents):
        if not intent.patterns and not intent.examples:
            r.error("intent", f"intents[{i}]", f"Intent '{intent.id}' needs patterns or examples")
    for i, m in enumerate(d.opening_messages):
        text(m.text, f"opening_messages[{i}]")
        if m.character and m.character not in chars:
            r.error("unknown_ref", f"opening_messages[{i}]", f"Unknown character '{m.character}'")
    for name, spec in d.variables.items():
        if spec.pool is not None and not spec.pool:
            r.error("variable", f"variables.{name}", "pool must not be empty")
    for i, v in enumerate(d.variations):
        for name in v.set:
            if name not in variables:
                r.error("unknown_ref", f"variations[{i}]", f"Variation sets undeclared variable '{name}'")

    # phases
    if d.initial_phase not in phases:
        r.error("unknown_ref", "initial_phase", f"Initial phase '{d.initial_phase}' does not exist")
    for i, ph in enumerate(d.phases):
        for t in ph.transitions:
            if t not in phases:
                r.error("unknown_ref", f"phases[{i}].transitions", f"Unknown phase '{t}'")
        for j, aa in enumerate(ph.auto_advance):
            cond(aa.when, f"phases[{i}].auto_advance[{j}].when")
            if aa.to not in ph.transitions:
                r.error("transition", f"phases[{i}].auto_advance[{j}]",
                        f"Auto-advance from '{ph.id}' to '{aa.to}' is not an allowed transition")

    # actions
    for i, a in enumerate(d.actions):
        path = f"actions[{i}]"
        if a.tool not in tools:
            r.error("unknown_ref", path, f"Action '{a.id}' uses unknown tool '{a.tool}'")
        if a.character and a.character not in chars:
            r.error("unknown_ref", path, f"Action '{a.id}' references unknown character '{a.character}'")
        if a.kind == "ask" and not a.character:
            r.error("action", path, f"Ask action '{a.id}' needs a character")
        for p in a.phases:
            if p not in phases:
                r.error("unknown_ref", f"{path}.phases", f"Unknown phase '{p}'")
        cond(a.preconditions, f"{path}.preconditions")
        it = a.input
        if it.type == "command":
            if not it.patterns:
                r.error("action", f"{path}.input", f"Command action '{a.id}' needs at least one pattern")
            for pat in it.patterns:
                if len(pat) > 300:
                    r.error("action", f"{path}.input", "Command pattern too long (max 300 chars)")
                    continue
                try:
                    re.compile(pat)
                except re.error as exc:
                    r.error("regex", f"{path}.input", f"Invalid command pattern '{pat}': {exc}")
        if it.type == "free_text" and a.kind == "ask" and not it.intents:
            r.error("action", f"{path}.input", f"Chat action '{a.id}' needs intents to be matched")
        for intent in it.intents:
            if intent not in intents:
                r.error("unknown_ref", f"{path}.input", f"Unknown intent '{intent}'")
        if it.type == "choice":
            if not it.choices:
                r.error("action", f"{path}.input", f"Choice action '{a.id}' needs choices")
            for dup in _dupes([c.id for c in it.choices]):
                r.error("duplicate_id", f"{path}.input", f"Duplicate choice id '{dup}'")
            for c in it.choices:
                text(c.label, f"{path}.input.choices")
        text(a.label, f"{path}.label")
        outcome(a, path)
        for j, br in enumerate(a.branches):
            cond(br.when, f"{path}.branches[{j}].when")
            outcome(br, f"{path}.branches[{j}]")

    # events
    for i, e in enumerate(d.events):
        path = f"events[{i}]"
        t = e.trigger
        if t.type == "time" and t.at_minutes is None:
            r.error("event", path, "Time trigger needs at_minutes")
        if t.type == "condition" and t.condition is None:
            r.error("event", path, "Condition trigger needs a condition")
        if t.type == "after_action" and t.action not in actions:
            r.error("unknown_ref", path, f"Event triggers after unknown action '{t.action}'")
        cond(t.condition, f"{path}.trigger.condition")
        text(e.notify, f"{path}.notify")
        outcome(e, path)

    # completion / feedback
    cond(d.completion.success, "completion.success")
    cond(d.completion.failure, "completion.failure")
    for i, fr in enumerate(d.feedback_rules):
        cond(fr.when, f"feedback_rules[{i}].when")

    _graph_checks(d, r)
    _reachability_checks(d, r)


def _graph_checks(d: SimulationDefinition, r: ValidationReport) -> None:
    phases = {p.id for p in d.phases}
    if d.initial_phase not in phases:
        return
    forced: dict[str, set[str]] = {}
    for a in d.actions:
        for spec in [a, *a.branches]:
            for eff in spec.effects:
                if eff.transition:
                    for p in a.phases or list(phases):
                        forced.setdefault(p, set()).add(eff.transition)
    for e in d.events:
        for eff in e.effects:
            if eff.transition:
                for p in phases:
                    forced.setdefault(p, set()).add(eff.transition)
    seen = {d.initial_phase}
    todo = [d.initial_phase]
    while todo:
        cur = todo.pop()
        ph = d.phase(cur)
        nxt = set(ph.transitions if ph else []) | forced.get(cur, set())
        for n in nxt:
            if n in phases and n not in seen:
                seen.add(n)
                todo.append(n)
    for p in d.phases:
        if p.id not in seen:
            r.error("unreachable_phase", f"phases.{p.id}", f"Phase '{p.id}' can never be reached")
        elif not p.terminal and not p.transitions and not forced.get(p.id):
            ends = any(eff.complete for a in d.actions for s in [a, *a.branches] for eff in s.effects
                       if not a.phases or p.id in a.phases)
            if not ends and d.completion.success is None:
                r.error("dead_end", f"phases.{p.id}", f"Phase '{p.id}' has no way forward and no way to finish")
            elif not ends:
                r.warn("dead_end", f"phases.{p.id}", f"Phase '{p.id}' has no outgoing transitions")
    if d.completion.success is None and not any(p.terminal for p in d.phases) and not any(
        eff.complete for a in d.actions for s in [a, *a.branches] for eff in s.effects
    ):
        r.error("no_completion", "completion", "No completion condition, terminal phase or completing action")


def _reachability_checks(d: SimulationDefinition, r: ValidationReport) -> None:
    dims = {dim.id: dim for dim in d.scoring.dimensions}
    achievable: dict[str, float] = dict.fromkeys(dims, 0.0)
    for a in d.actions:
        best: dict[str, float] = {}
        for spec in [a, *a.branches]:
            for k, v in spec.score.items():
                if v > 0:
                    best[k] = max(best.get(k, 0.0), v)
        for k, v in best.items():
            if k in achievable:
                achievable[k] += v
    for e in d.events:
        for k, v in e.score.items():
            if v > 0 and k in achievable:
                achievable[k] += v
    eff_dim = d.scoring.efficiency.dimension if d.scoring.efficiency else None
    for k, dim in dims.items():
        if dim.baseline == "full" or k == eff_dim:
            continue
        if achievable[k] < dim.max_points:
            r.warn("unreachable_max", f"scoring.dimensions.{k}",
                   f"'{dim.name}' can reach at most {achievable[k]:g} of {dim.max_points:g} points")
    if not any(a.classification == "correct" or any(b.classification == "correct" for b in a.branches)
               for a in d.actions):
        r.warn("no_correct_actions", "actions", "No action is classified as correct")
    phases_with_actions = {p for a in d.actions for p in (a.phases or [x.id for x in d.phases])}
    for p in d.phases:
        if p.id not in phases_with_actions and not p.terminal:
            r.warn("empty_phase", f"phases.{p.id}", f"No actions are available in phase '{p.id}'")


# ---------------------------------------------------------------------------------------------- repair

_ALLOWED_TOP = set(SimulationDefinition.model_fields)


def _slug(value: Any, fallback: str) -> str:
    s = re.sub(r"[^a-z0-9_]+", "_", str(value or "").lower()).strip("_")
    return s[:64] or fallback


def repair(raw: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """Best-effort fixes for machine-generated definitions: drop unknown keys and dangling references,
    fill required fields, normalise weights to 100, ensure phases/completion exist. Returns (fixed, notes).
    The result still has to pass :func:`validate` before it can be used."""
    notes: list[str] = []
    d = copy.deepcopy(raw) if isinstance(raw, dict) else {}
    for k in list(d):
        if k not in _ALLOWED_TOP:
            d.pop(k)
            notes.append(f"Removed unknown top-level key '{k}'")
    meta = d.get("meta") if isinstance(d.get("meta"), dict) else {}
    meta.setdefault("title", "Untitled simulation")
    d["meta"] = meta
    if not isinstance(d.get("phases"), list) or not d["phases"]:
        d["phases"] = [p.model_dump() for p in default_phases()]
        d["initial_phase"] = "INITIAL"
        notes.append("Added default phases")
    phase_ids = [p.get("id") for p in d["phases"] if isinstance(p, dict)]
    if d.get("initial_phase") not in phase_ids:
        d["initial_phase"] = phase_ids[0]
        notes.append("Reset initial phase")
    for p in d["phases"]:
        p.setdefault("name", str(p.get("id", "")).title())
        p["transitions"] = [t for t in p.get("transitions", []) if t in phase_ids]
        p["auto_advance"] = [aa for aa in p.get("auto_advance", []) if isinstance(aa, dict)
                             and aa.get("to") in p["transitions"]]
    for key in ("tools", "characters", "intents", "actions", "events", "feedback_rules", "variations",
                "opening_messages"):
        if not isinstance(d.get(key), list):
            d[key] = []
    if not isinstance(d.get("variables"), dict):
        d["variables"] = {}
    env = d.get("environment") if isinstance(d.get("environment"), dict) else {}
    env.setdefault("panels", [])
    d["environment"] = env
    panel_ids = {p.get("id") for p in env["panels"] if isinstance(p, dict)}
    for t in d["tools"]:
        if t.get("panel") and t["panel"] not in panel_ids:
            t["panel"] = None
            notes.append(f"Cleared unknown panel on tool '{t.get('id')}'")
        t.setdefault("name", str(t.get("id", "Tool")).replace("_", " ").title())
    tool_ids = {t.get("id") for t in d["tools"]}
    intent_ids = {i.get("id") for i in d["intents"]}
    char_ids = {c.get("id") for c in d["characters"]}
    fact_ids = {f.get("id") for c in d["characters"] for f in c.get("facts", [])}
    for c in d["characters"]:
        c.setdefault("name", str(c.get("id", "Character")).title())
        for f in c.get("facts", []):
            f["intents"] = [i for i in f.get("intents", []) if i in intent_ids]
    sc = d.get("scoring") if isinstance(d.get("scoring"), dict) else {}
    dims = [x for x in sc.get("dimensions", []) if isinstance(x, dict) and x.get("id")]
    if not dims:
        dims = [{"id": "technical_accuracy", "name": "Technical accuracy", "weight": 40, "max_points": 20},
                {"id": "troubleshooting_process", "name": "Process", "weight": 25, "max_points": 15},
                {"id": "communication", "name": "Communication", "weight": 15, "max_points": 10},
                {"id": "decision_making", "name": "Decision making", "weight": 10, "max_points": 10},
                {"id": "efficiency", "name": "Efficiency", "weight": 10, "max_points": 10}]
        notes.append("Added default scoring dimensions")
    for x in dims:
        x.setdefault("name", x["id"].replace("_", " ").title())
        x["weight"] = float(x.get("weight") or 0)
    total = sum(x["weight"] for x in dims)
    if abs(total - 100) > 0.01:
        if total <= 0:
            for x in dims:
                x["weight"] = 100 / len(dims)
        else:
            for x in dims:
                x["weight"] = round(x["weight"] * 100 / total, 2)
        drift = round(100 - sum(x["weight"] for x in dims), 2)
        dims[0]["weight"] = round(dims[0]["weight"] + drift, 2)
        notes.append("Normalised dimension weights to 100")
    sc["dimensions"] = dims
    dim_ids = {x["id"] for x in dims}
    for key in ("efficiency", "process"):
        if isinstance(sc.get(key), dict) and sc[key].get("dimension", "efficiency" if key == "efficiency"
                                                         else "troubleshooting_process") not in dim_ids:
            sc.pop(key)
            notes.append(f"Removed {key} scoring that referenced a missing dimension")
    if isinstance(sc.get("process"), dict):
        sc["process"]["required_order"] = [p for p in sc["process"].get("required_order", DEFAULT_PHASE_ORDER)
                                           if p in phase_ids]
    d["scoring"] = sc
    var_names = set(d["variables"])
    kept = []
    for a in d["actions"]:
        if not isinstance(a, dict) or not a.get("id"):
            continue
        if a.get("tool") not in tool_ids:
            notes.append(f"Dropped action '{a.get('id')}' with unknown tool '{a.get('tool')}'")
            continue
        if a.get("character") and a["character"] not in char_ids:
            a["character"] = None
        if a.get("kind") == "ask" and not a.get("character"):
            a["kind"] = "inspect"
        a.setdefault("label", str(a["id"]).replace("_", " ").capitalize())
        inp = a.get("input") if isinstance(a.get("input"), dict) else {}
        inp["intents"] = [i for i in inp.get("intents", []) if i in intent_ids]
        if inp.get("type") == "free_text" and a.get("kind") == "ask" and not inp["intents"]:
            notes.append(f"Dropped chat action '{a['id']}' without valid intents")
            continue
        a["input"] = inp
        a["phases"] = [p for p in a.get("phases", []) if p in phase_ids]
        for spec in [a, *a.get("branches", [])]:
            _repair_outcome(spec, dim_ids, var_names, fact_ids, phase_ids, notes)
        kept.append(a)
    d["actions"] = kept
    for e in d["events"]:
        _repair_outcome(e, dim_ids, var_names, fact_ids, phase_ids, notes)
    action_ids = {a["id"] for a in kept}
    d["events"] = [e for e in d["events"] if isinstance(e, dict) and isinstance(e.get("trigger"), dict) and (
        e["trigger"].get("type") != "after_action" or e["trigger"].get("action") in action_ids)]
    return d, notes


def _repair_outcome(spec: dict[str, Any], dims: set[str], var_names: set[str], fact_ids: set[str],
                    phase_ids: list[str], notes: list[str]) -> None:
    if isinstance(spec.get("score"), dict):
        spec["score"] = {k: v for k, v in spec["score"].items() if k in dims and isinstance(v, int | float)}
    effects = []
    for eff in spec.get("effects", []) or []:
        if not isinstance(eff, dict):
            continue
        for key in ("set", "inc"):
            if isinstance(eff.get(key), dict):
                for name in list(eff[key]):
                    if name not in var_names:
                        eff[key].pop(name)
                        notes.append(f"Removed effect on undeclared variable '{name}'")
        if eff.get("reveal"):
            eff["reveal"] = [f for f in eff["reveal"] if f in fact_ids]
        if eff.get("transition") and eff["transition"] not in phase_ids:
            eff.pop("transition")
        effects.append(eff)
    spec["effects"] = effects
