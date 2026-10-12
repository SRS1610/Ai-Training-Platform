"""Deterministic simulation reducer.

``start(definition, seed)`` → initial state; ``step(definition, state, action_id, input)`` → ``StepResult``
(new state + outcome). State is a JSON-serialisable dict that the API persists server side; learners only
ever see :func:`learner_view` / :func:`public_outcome` projections of it. Given the same definition, seed
and inputs, every run produces identical states (no wall clock, no randomness after ``start``).
"""

from __future__ import annotations

import copy
import random
import re
from dataclasses import dataclass, field
from typing import Any

from simulation_engine.conditions import EvalContext, _lookup, evaluate, truthy
from simulation_engine.intents import Vocabulary, match_intents, normalise_command, score_intent
from simulation_engine.schema import (
    Action,
    Effect,
    Event,
    OutcomeSpec,
    RepeatPolicy,
    SimulationDefinition,
    parse_definition,
)

STATE_VERSION = 1
UNKNOWN_ACTION_ID = "__unknown__"
MAX_INPUT_CHARS = 4000
_MAX_CASCADE = 8


class EngineError(ValueError):
    """Invalid request against the engine (bad action id, bad choice, missing tool)."""


class UnknownAction(EngineError):
    pass


class InvalidInput(EngineError):
    pass


class SimulationEnded(EngineError):
    pass


@dataclass
class StepResult:
    state: dict[str, Any]
    outcome: dict[str, Any]


@dataclass
class Resolution:
    kind: str  # action | fact | unknown
    action_id: str | None = None
    fact_id: str | None = None
    character: str | None = None
    intent: str | None = None
    args: list[Any] = field(default_factory=list)
    named_args: dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------------------------- helpers

_TPL = re.compile(r"\{\{\s*([$A-Za-z_][\w.$]*)\s*\}\}")


def _fmt(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "yes" if value else "no"
    if isinstance(value, float):
        return f"{value:g}"
    if isinstance(value, list):
        return ", ".join(_fmt(v) for v in value)
    return str(value)


def render(text: str, ctx: EvalContext) -> str:
    """Interpolate ``{{variable}}`` / ``{{$input.text}}`` / ``{{$minutes}}`` placeholders."""
    if "{{" not in text:
        return text
    return _TPL.sub(lambda m: _fmt(_lookup(ctx, m.group(1))), text)


def render_data(data: Any, ctx: EvalContext) -> Any:
    if isinstance(data, str):
        return render(data, ctx)
    if isinstance(data, list):
        return [render_data(x, ctx) for x in data]
    if isinstance(data, dict):
        return {k: render_data(v, ctx) for k, v in data.items()}
    return data


def _ctx(state: dict[str, Any], inp: dict[str, Any] | None = None) -> EvalContext:
    return EvalContext.from_state(state, inp)


def _clamp(d: SimulationDefinition, name: str, value: Any) -> Any:
    spec = d.variables.get(name)
    if spec is None or not isinstance(value, int | float) or isinstance(value, bool):
        return value
    if spec.min is not None and value < spec.min:
        value = type(value)(spec.min)
    if spec.max is not None and value > spec.max:
        value = type(value)(spec.max)
    return value


def _norm_input(raw: Any) -> dict[str, Any]:
    if raw is None:
        return {}
    if isinstance(raw, str):
        raw = {"text": raw}
    if not isinstance(raw, dict):
        raise InvalidInput("input must be a string or an object")
    out = {k: v for k, v in raw.items() if k in ("text", "choice", "args", "named")}
    if isinstance(out.get("text"), str):
        out["text"] = out["text"][:MAX_INPUT_CHARS]
    return out


def is_listed(action: Action) -> bool:
    return action.listed if action.listed is not None else action.kind not in ("command", "ask")


def _repeat_policy(d: SimulationDefinition, a: Action) -> RepeatPolicy:
    return a.repeat or d.settings.repeat


def is_available(d: SimulationDefinition, state: dict[str, Any], a: Action) -> bool:
    if a.phases and state["phase"] not in a.phases:
        return False
    tool = d.tool(a.tool)
    ctx = _ctx(state)
    if tool is not None and not truthy(tool.visible_when, ctx):
        return False
    if _repeat_policy(d, a).mode == "block" and state["action_counts"].get(a.id, 0) >= 1:
        return False
    return truthy(a.preconditions, ctx)


def _vocab(d: SimulationDefinition) -> Vocabulary:
    return Vocabulary(d.synonyms)


# ---------------------------------------------------------------------------------------------- start


def start(definition: SimulationDefinition | dict[str, Any], seed: int = 0) -> dict[str, Any]:
    """Create the initial state. ``seed`` deterministically picks variable pool values and a variation."""
    d = parse_definition(definition)
    rng = random.Random(seed)
    variables: dict[str, Any] = {name: copy.deepcopy(spec.initial) for name, spec in d.variables.items()}
    for name in sorted(d.variables):
        pool = d.variables[name].pool
        if pool:
            variables[name] = copy.deepcopy(rng.choice(pool))
    variation_id = None
    if d.variations:
        weights = [max(v.weight, 0.0) for v in d.variations]
        chosen = rng.choices(d.variations, weights=weights if sum(weights) > 0 else None)[0]
        variables.update(copy.deepcopy(chosen.set))
        variation_id = chosen.id
    state: dict[str, Any] = {
        "state_version": STATE_VERSION,
        "schema_version": d.schema_version,
        "seed": seed,
        "variation": variation_id,
        "phase": d.initial_phase,
        "phase_history": [{"phase": d.initial_phase, "seq": 0, "minutes": 0.0}],
        "variables": variables,
        "revealed_facts": [],
        "problems": [],
        "action_counts": {},
        "outcome_counts": {},
        "history": [],
        "score": {dim: 0.0 for dim in d.dimension_ids()},
        "minutes": 0.0,
        "fired_events": {},
        "transcript": [],
        "seq": 0,
        "unknown_inputs": 0,
        "criticals": [],
        "ended": False,
        "end_reason": None,
    }
    ctx = _ctx(state)
    for msg in d.opening_messages:
        if truthy(msg.when, ctx):
            state["transcript"].append(_message_entry(d, state, msg.character, render(msg.text, ctx)))
    _auto_reveal(d, state, None)
    return state


# ---------------------------------------------------------------------------------------------- resolve


def resolve_input(
    definition: SimulationDefinition | dict[str, Any],
    state: dict[str, Any],
    *,
    text: str,
    tool: str | None = None,
    character: str | None = None,
) -> Resolution:
    """Map free text (a chat message or a typed command) to an action, a character fact or "unknown"."""
    d = parse_definition(definition)
    if character is not None:
        return _resolve_chat(d, state, text, character)
    if tool is None:
        raise EngineError("tool or character is required to interpret free input")
    if d.tool(tool) is None:
        raise EngineError(f"unknown tool '{tool}'")
    cmd = normalise_command(text)
    available: list[Resolution] = []
    unavailable: list[Resolution] = []
    for a in d.actions:
        if a.tool != tool or a.input.type != "command":
            continue
        for pattern in a.input.patterns:
            try:
                m = re.fullmatch(pattern, cmd, flags=re.IGNORECASE)
            except re.error:
                continue
            if m:
                res = Resolution("action", action_id=a.id, args=list(m.groups()), named_args=m.groupdict())
                (available if is_available(d, state, a) else unavailable).append(res)
                break
    if available or unavailable:
        return (available or unavailable)[0]
    # free-text actions bound to the tool (e.g. a search box)
    vocab = _vocab(d)
    intents = {i.id: i for i in d.intents}
    best: tuple[float, Resolution] | None = None
    for a in d.actions:
        if a.tool != tool or a.input.type != "free_text" or not a.input.intents:
            continue
        s = max((score_intent(text, intents[i], vocab) for i in a.input.intents if i in intents), default=0.0)
        if s > 0 and (best is None or s > best[0]):
            best = (s, Resolution("action", action_id=a.id, intent=None))
    return best[1] if best else Resolution("unknown")


def _resolve_chat(d: SimulationDefinition, state: dict[str, Any], text: str, character: str) -> Resolution:
    char = d.character(character)
    if char is None:
        raise EngineError(f"unknown character '{character}'")
    vocab = _vocab(d)
    intents = {i.id: i for i in d.intents}
    ranked = {iid: s for iid, s in match_intents(text, intents.values(), vocab)}
    best: tuple[float, int, int, Resolution] | None = None  # (score, available, -order, res)
    for order, a in enumerate(d.actions):
        if a.kind != "ask" or a.character != character:
            continue
        hits = [(ranked[i], i) for i in a.input.intents if i in ranked]
        if not hits:
            continue
        s, iid = max(hits)
        key = (s, int(is_available(d, state, a)), -order)
        if best is None or key > best[:3]:
            best = (*key, Resolution("action", action_id=a.id, character=character, intent=iid))
    fact_best: tuple[float, Resolution] | None = None
    ctx = _ctx(state)
    for f in char.facts:
        hits = [(ranked[i], i) for i in f.intents if i in ranked]
        if hits and truthy(f.when, ctx):
            s, iid = max(hits)
            if fact_best is None or s > fact_best[0]:
                fact_best = (s, Resolution("fact", fact_id=f.id, character=character, intent=iid))
    if best and (fact_best is None or best[0] >= fact_best[0]):
        return best[3]
    if fact_best:
        return fact_best[1]
    return Resolution("unknown", character=character)


# ---------------------------------------------------------------------------------------------- step


def _new_outcome(state: dict[str, Any], **kw: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "seq": state["seq"], "accepted": True, "matched": "action", "action_id": None, "label": None,
        "tool": None, "kind": None, "character": None, "intent": None, "outputs": [], "messages": [],
        "events": [], "revealed_facts": [], "problems_added": [], "problems_removed": [],
        "phase_before": state["phase"], "phase_after": state["phase"], "phase_changed": False,
        "score_deltas": {}, "classification": "neutral", "feedback": "", "hint": "", "time_cost": 0.0,
        "sim_minutes": state["minutes"], "ended": False, "end_reason": None, "variables_changed": [],
        "notices": [], "reason": None, "message": None,
    }
    base.update(kw)
    return base


def _rejected(state: dict[str, Any], reason: str, message: str, **kw: Any) -> StepResult:
    out = _new_outcome(state, accepted=False, reason=reason, message=message, **kw)
    return StepResult(state=state, outcome=out)


def step(
    definition: SimulationDefinition | dict[str, Any],
    state: dict[str, Any],
    action_id: str | None = None,
    input: Any = None,  # noqa: A002 - public API mirrors the spec
    *,
    tool: str | None = None,
    character: str | None = None,
) -> StepResult:
    """Apply one learner action. With ``action_id=None`` the free ``input`` text is resolved against
    ``tool`` (commands) or ``character`` (chat). Never mutates ``state``."""
    d = parse_definition(definition)
    st = copy.deepcopy(state)
    if st.get("ended"):
        raise SimulationEnded("the simulation has ended")
    inp = _norm_input(input)
    resolution: Resolution | None = None
    if action_id is None:
        resolution = resolve_input(d, st, text=str(inp.get("text", "")), tool=tool, character=character)
        if resolution.kind == "fact":
            return _fact_step(d, st, resolution, inp)
        if resolution.kind == "unknown":
            return _unknown_step(d, st, inp, tool=tool, character=character)
        action_id = resolution.action_id
        inp["args"] = resolution.args
        if resolution.named_args:
            inp["named"] = resolution.named_args
    action = d.action(action_id or "")
    if action is None:
        raise UnknownAction(f"unknown action '{action_id}'")
    return _action_step(d, st, action, inp, resolution)


def _action_step(
    d: SimulationDefinition, st: dict[str, Any], a: Action, inp: dict[str, Any], res: Resolution | None
) -> StepResult:
    who = a.character
    if not is_available(d, st, a):
        msgs = []
        if a.kind == "ask" and who:
            msgs = [_msg_out(d, who, a.precondition_message)]
        return _rejected(st, "precondition_failed", a.precondition_message, action_id=a.id, label=a.label,
                         tool=a.tool, kind=a.kind, messages=msgs)
    if a.input.type == "choice":
        valid = {c.id for c in a.input.choices}
        if inp.get("choice") not in valid:
            raise InvalidInput(f"choice must be one of: {', '.join(sorted(valid))}")
    if a.input.type in ("free_text", "command") and a.input.min_length:
        if len(str(inp.get("text", "")).strip()) < a.input.min_length:
            return _rejected(st, "invalid_input", f"Please enter at least {a.input.min_length} characters.",
                             action_id=a.id, label=a.label, tool=a.tool, kind=a.kind)

    count = st["action_counts"].get(a.id, 0)
    pre_ctx = _ctx(st, inp)
    spec: OutcomeSpec = a
    branch_id = None
    for idx, br in enumerate(a.branches):
        if truthy(br.when, pre_ctx):
            spec, branch_id = br, br.id or str(idx)
            break
    # Repeats are counted per outcome (action + branch): a validation run of the same command after the
    # fix is a different outcome than the diagnostic run before it.
    outcome_key = f"{a.id}#{branch_id}" if branch_id is not None else a.id
    repeats = st.setdefault("outcome_counts", {}).get(outcome_key, 0)
    time_cost = spec.time_cost if spec.time_cost is not None else (a.time_cost or 0.0)

    deltas = dict(spec.score)
    policy = _repeat_policy(d, a)
    notices: list[str] = []
    if repeats >= 1:
        if policy.mode in ("diminish", "penalize"):
            deltas = {k: v for k, v in deltas.items() if v < 0}
        if policy.mode == "penalize" or repeats > policy.free_repeats:
            for k, v in policy.penalty.items():
                deltas[k] = deltas.get(k, 0.0) + v
        if policy.message:
            notices.append(policy.message)

    st["seq"] += 1
    outcome = _new_outcome(st, action_id=a.id, label=a.label, tool=a.tool, kind=a.kind, character=who,
                           intent=res.intent if res else None, classification=spec.classification,
                           feedback=spec.feedback or "", hint=a.hint, branch=branch_id, notices=notices)
    _learner_entry(d, st, a, inp)
    before_vars = copy.deepcopy(st["variables"])
    _apply_effects(d, st, spec.effects, inp, outcome)
    _add_scores(d, st, deltas, outcome)
    _advance_time(d, st, time_cost)
    outcome["time_cost"] = time_cost
    st["action_counts"][a.id] = count + 1
    st["outcome_counts"][outcome_key] = repeats + 1
    if spec.classification == "critical" and a.id not in st["criticals"]:
        st["criticals"].append(a.id)

    post_ctx = _ctx(st, inp)
    tool = d.tool(a.tool)
    for o in spec.outputs:
        if truthy(o.when, post_ctx):
            entry = {"tool": a.tool, "panel": o.panel or (tool.panel if tool else None), "format": o.format,
                     "text": render(o.text, post_ctx)}
            outcome["outputs"].append(entry)
            st["transcript"].append({"seq": st["seq"], "minutes": st["minutes"], "from": "system", "name": None,
                                     "kind": "output", **entry})
            break
    for m in spec.messages:
        if truthy(m.when, post_ctx):
            out = _msg_out(d, m.character, render(m.text, post_ctx))
            outcome["messages"].append(out)
            st["transcript"].append(_message_entry(d, st, m.character, out["text"]))

    st["history"].append({
        "seq": st["seq"], "type": "action", "action_id": a.id, "label": a.label, "tool": a.tool, "kind": a.kind,
        "branch": branch_id, "input": _loggable_input(inp), "classification": spec.classification,
        "score_deltas": deltas, "minutes": st["minutes"], "time_cost": time_cost,
        "phase_before": outcome["phase_before"], "phase_after": None,
    })
    _post_step(d, st, outcome, a.id, before_vars)
    st["history"][-1]["phase_after"] = st["phase"]
    return StepResult(state=st, outcome=outcome)


def _fact_step(d: SimulationDefinition, st: dict[str, Any], res: Resolution, inp: dict[str, Any]) -> StepResult:
    char_fact = d.fact(res.fact_id or "")
    assert char_fact is not None
    char, fact = char_fact
    st["seq"] += 1
    before_vars = copy.deepcopy(st["variables"])
    outcome = _new_outcome(st, matched="fact", action_id=None, tool=None, kind="ask", character=char.id,
                           intent=res.intent, label="Question")
    st["transcript"].append(_learner_text_entry(st, str(inp.get("text", "")), "message", None, char.id))
    _reveal(d, st, [fact.id], outcome)
    ctx = _ctx(st, inp)
    out = _msg_out(d, char.id, render(fact.text, ctx))
    outcome["messages"].append(out)
    st["transcript"].append(_message_entry(d, st, char.id, out["text"]))
    time_cost = 1.0
    _advance_time(d, st, time_cost)
    outcome["time_cost"] = time_cost
    st["history"].append({"seq": st["seq"], "type": "fact", "action_id": None, "fact_id": fact.id,
                          "label": f"Asked {char.name}", "tool": None, "kind": "ask", "branch": None,
                          "input": _loggable_input(inp), "classification": "neutral", "score_deltas": {},
                          "minutes": st["minutes"], "time_cost": time_cost, "phase_before": outcome["phase_before"],
                          "phase_after": None})
    _post_step(d, st, outcome, None, before_vars)
    st["history"][-1]["phase_after"] = st["phase"]
    return StepResult(state=st, outcome=outcome)


def _unknown_step(
    d: SimulationDefinition, st: dict[str, Any], inp: dict[str, Any], *, tool: str | None, character: str | None
) -> StepResult:
    policy = d.settings.unknown_input
    st["seq"] += 1
    st["unknown_inputs"] = st.get("unknown_inputs", 0) + 1
    before_vars = copy.deepcopy(st["variables"])
    outcome = _new_outcome(st, matched="unknown", action_id=UNKNOWN_ACTION_ID, tool=tool, kind="unknown",
                           character=character, label="Unrecognised input")
    text = str(inp.get("text", ""))
    t = d.tool(tool) if tool else None
    st["transcript"].append(_learner_text_entry(st, text, "message" if character else "command", tool, character))
    ctx = _ctx(st, inp)
    deltas = dict(policy.penalty) if st["unknown_inputs"] <= policy.max_penalised else {}
    if character:
        char = d.character(character)
        out = _msg_out(d, character, render(char.fallback_reply if char else policy.reply, ctx))
        outcome["messages"].append(out)
        st["transcript"].append(_message_entry(d, st, character, out["text"]))
    else:
        deltas = {}  # an unknown terminal command is realistic noise, not a communication failure
        txt = render(t.unknown_input_output, ctx) if t and t.unknown_input_output else render(policy.reply, ctx)
        entry = {"tool": tool, "panel": t.panel if t else None, "format": "terminal" if t else "text", "text": txt}
        outcome["outputs"].append(entry)
        st["transcript"].append({"seq": st["seq"], "minutes": st["minutes"], "from": "system", "name": None,
                                 "kind": "output", **entry})
    _add_scores(d, st, deltas, outcome)
    _advance_time(d, st, policy.time_cost)
    outcome["time_cost"] = policy.time_cost
    st["history"].append({"seq": st["seq"], "type": "unknown", "action_id": UNKNOWN_ACTION_ID,
                          "label": "Unrecognised input", "tool": tool, "kind": "unknown", "branch": None,
                          "character": character, "input": _loggable_input(inp), "classification": "neutral",
                          "score_deltas": deltas, "minutes": st["minutes"], "time_cost": policy.time_cost,
                          "phase_before": outcome["phase_before"], "phase_after": None})
    _post_step(d, st, outcome, None, before_vars)
    st["history"][-1]["phase_after"] = st["phase"]
    return StepResult(state=st, outcome=outcome)


def _loggable_input(inp: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in inp.items() if k in ("text", "choice", "args")}


# ---------------------------------------------------------------------------------------------- transcript


def _msg_out(d: SimulationDefinition, character: str | None, text: str) -> dict[str, Any]:
    char = d.character(character) if character else None
    return {"from": character or "system", "name": char.name if char else None, "text": text}


def _message_entry(d: SimulationDefinition, st: dict[str, Any], character: str | None, text: str) -> dict[str, Any]:
    out = _msg_out(d, character, text)
    return {"seq": st["seq"], "minutes": st["minutes"], "kind": "message" if character else "notice",
            "tool": None, **out}


def _learner_text_entry(
    st: dict[str, Any], text: str, kind: str, tool: str | None, to: str | None
) -> dict[str, Any]:
    return {"seq": st["seq"], "minutes": st["minutes"], "from": "learner", "name": None, "kind": kind,
            "tool": tool, "to": to, "text": text}


def _learner_entry(d: SimulationDefinition, st: dict[str, Any], a: Action, inp: dict[str, Any]) -> None:
    if a.input.type in ("free_text", "command") and inp.get("text"):
        kind = "message" if a.kind == "ask" else ("command" if a.input.type == "command" else "note")
        st["transcript"].append(_learner_text_entry(st, str(inp["text"]), kind, a.tool, a.character))
    else:
        label = a.label
        if a.input.type == "choice":
            choice = next((c.label for c in a.input.choices if c.id == inp.get("choice")), "")
            label = f"{a.label}: {choice}" if choice else a.label
        st["transcript"].append(_learner_text_entry(st, label, "action", a.tool, a.character))


# ---------------------------------------------------------------------------------------------- effects


def _add_scores(d: SimulationDefinition, st: dict[str, Any], deltas: dict[str, float], outcome: dict) -> None:
    dims = set(d.dimension_ids())
    for k, v in deltas.items():
        if k in dims and v:
            st["score"][k] = round(st["score"].get(k, 0.0) + float(v), 4)
            outcome["score_deltas"][k] = round(outcome["score_deltas"].get(k, 0.0) + float(v), 4)


def _reveal(d: SimulationDefinition, st: dict[str, Any], fact_ids: list[str], outcome: dict | None) -> None:
    ctx = _ctx(st)
    for fid in fact_ids:
        found = d.fact(fid)
        if found is None or fid in st["revealed_facts"]:
            continue
        char, fact = found
        st["revealed_facts"].append(fid)
        if outcome is not None:
            outcome["revealed_facts"].append({"id": fid, "character": char.id, "character_name": char.name,
                                              "text": render(fact.text, ctx)})


def _set_phase(d: SimulationDefinition, st: dict[str, Any], phase: str) -> None:
    if phase == st["phase"] or d.phase(phase) is None:
        return
    st["phase"] = phase
    st["phase_history"].append({"phase": phase, "seq": st["seq"], "minutes": st["minutes"]})


def _apply_effects(
    d: SimulationDefinition, st: dict[str, Any], effects: list[Effect], inp: dict[str, Any], outcome: dict,
    depth: int = 0,
) -> None:
    for eff in effects:
        if eff.set:
            ctx = _ctx(st, inp)
            for name, value in eff.set.items():
                if isinstance(value, dict | list):
                    value = evaluate(value, ctx)
                elif isinstance(value, str):
                    value = render(value, ctx)
                st["variables"][name] = _clamp(d, name, value)
        if eff.inc:
            for name, amount in eff.inc.items():
                cur = st["variables"].get(name) or 0
                cur = cur if isinstance(cur, int | float) and not isinstance(cur, bool) else 0
                st["variables"][name] = _clamp(d, name, cur + amount)
        if eff.reveal:
            _reveal(d, st, eff.reveal, outcome)
        if eff.add_problem and all(p["id"] != eff.add_problem.id for p in st["problems"]):
            prob = eff.add_problem.model_dump()
            prob["text"] = render(prob["text"], _ctx(st, inp))
            st["problems"].append(prob)
            outcome["problems_added"].append(prob)
        if eff.remove_problem:
            before = len(st["problems"])
            st["problems"] = [p for p in st["problems"] if p["id"] != eff.remove_problem]
            if len(st["problems"]) != before:
                outcome["problems_removed"].append(eff.remove_problem)
        if eff.transition:
            _set_phase(d, st, eff.transition)
        if eff.trigger_event and depth < _MAX_CASCADE:
            ev = d.event(eff.trigger_event)
            if ev is not None and _event_eligible(ev, st):
                _fire_event(d, st, ev, outcome, depth + 1)
        if eff.complete and not st.get("pending_end"):
            st["pending_end"] = eff.complete


def _advance_time(d: SimulationDefinition, st: dict[str, Any], minutes: float) -> None:
    if minutes <= 0:
        return
    st["minutes"] = round(st["minutes"] + minutes, 4)
    for char in d.characters:
        if char.patience_var and char.patience_decay_per_minute:
            cur = st["variables"].get(char.patience_var)
            if isinstance(cur, int | float) and not isinstance(cur, bool):
                new = cur - char.patience_decay_per_minute * minutes
                st["variables"][char.patience_var] = _clamp(d, char.patience_var, round(new, 4))


# ---------------------------------------------------------------------------------------------- events


def _event_eligible(ev: Event, st: dict[str, Any]) -> bool:
    fired = st["fired_events"].get(ev.id, 0)
    if ev.once and fired >= 1:
        return False
    return not (ev.max_fires is not None and fired >= ev.max_fires)


def _event_triggered(ev: Event, st: dict[str, Any], last_action: str | None) -> bool:
    ctx = _ctx(st)
    t = ev.trigger
    if t.type == "time":
        return t.at_minutes is not None and st["minutes"] >= t.at_minutes and truthy(t.condition, ctx)
    if t.type == "after_action":
        return last_action is not None and last_action == t.action and truthy(t.condition, ctx)
    return t.condition is not None and truthy(t.condition, ctx)


def _fire_event(d: SimulationDefinition, st: dict[str, Any], ev: Event, outcome: dict, depth: int = 0) -> None:
    st["fired_events"][ev.id] = st["fired_events"].get(ev.id, 0) + 1
    _apply_effects(d, st, ev.effects, {}, outcome, depth)
    _add_scores(d, st, ev.score, outcome)
    ctx = _ctx(st)
    notify = render(ev.notify, ctx) if ev.notify else ""
    outcome["events"].append({"id": ev.id, "title": ev.title, "notify": notify})
    if notify:
        st["transcript"].append(_message_entry(d, st, None, notify))
    for m in ev.messages:
        if truthy(m.when, ctx):
            out = _msg_out(d, m.character, render(m.text, ctx))
            outcome["messages"].append(out)
            st["transcript"].append(_message_entry(d, st, m.character, out["text"]))
    if ev.time_cost:
        _advance_time(d, st, ev.time_cost)
    if ev.classification == "critical" and f"event:{ev.id}" not in st["criticals"]:
        st["criticals"].append(f"event:{ev.id}")
    st["history"].append({"seq": st["seq"], "type": "event", "action_id": None, "event_id": ev.id,
                          "label": ev.title or ev.id, "tool": None, "kind": "event", "branch": None, "input": {},
                          "classification": ev.classification, "score_deltas": dict(ev.score),
                          "minutes": st["minutes"], "time_cost": ev.time_cost or 0.0, "phase_before": st["phase"],
                          "phase_after": st["phase"]})


def _process_events(d: SimulationDefinition, st: dict[str, Any], outcome: dict, last_action: str | None) -> bool:
    fired = False
    for ev in d.events:
        if _event_eligible(ev, st) and _event_triggered(ev, st, last_action):
            _fire_event(d, st, ev, outcome)
            fired = True
    return fired


# ---------------------------------------------------------------------------------------------- post-step


def _auto_advance(d: SimulationDefinition, st: dict[str, Any]) -> None:
    for _ in range(len(d.phases) + 1):
        ph = d.phase(st["phase"])
        if ph is None:
            return
        ctx = _ctx(st)
        nxt = next((r.to for r in ph.auto_advance if r.to in ph.transitions and truthy(r.when, ctx)), None)
        if nxt is None or nxt == st["phase"]:
            return
        _set_phase(d, st, nxt)


def _auto_reveal(d: SimulationDefinition, st: dict[str, Any], outcome: dict | None) -> None:
    ctx = _ctx(st)
    ids = [f.id for c in d.characters for f in c.facts
           if f.auto_reveal and f.id not in st["revealed_facts"] and truthy(f.when, ctx)]
    if ids:
        _reveal(d, st, ids, outcome)


def _check_completion(d: SimulationDefinition, st: dict[str, Any]) -> None:
    if st.get("ended"):
        return
    ctx = _ctx(st)
    comp = d.completion
    reason = st.pop("pending_end", None)
    if reason is None and comp.failure is not None and truthy(comp.failure, ctx):
        reason = "failure"
    if reason is None and comp.success is not None and truthy(comp.success, ctx):
        reason = "success"
    if reason is None and comp.max_sim_minutes is not None and st["minutes"] >= comp.max_sim_minutes:
        reason = "timeout"
    if reason is None and comp.max_actions is not None and st["seq"] >= comp.max_actions:
        reason = "action_limit"
    if reason is None and comp.success is None:
        ph = d.phase(st["phase"])
        if ph is not None and ph.terminal:
            reason = "success"
    if reason:
        st["ended"] = True
        st["end_reason"] = reason


def _post_step(
    d: SimulationDefinition, st: dict[str, Any], outcome: dict, last_action: str | None, before_vars: dict
) -> None:
    for i in range(_MAX_CASCADE):
        _auto_advance(d, st)
        _auto_reveal(d, st, outcome)
        if not _process_events(d, st, outcome, last_action if i == 0 else None):
            break
    _auto_advance(d, st)
    _check_completion(d, st)
    outcome["phase_after"] = st["phase"]
    outcome["phase_changed"] = st["phase"] != outcome["phase_before"]
    outcome["sim_minutes"] = st["minutes"]
    outcome["ended"] = bool(st["ended"])
    outcome["end_reason"] = st["end_reason"]
    outcome["variables_changed"] = sorted(k for k in set(before_vars) | set(st["variables"])
                                          if before_vars.get(k) != st["variables"].get(k))


# ---------------------------------------------------------------------------------------------- projections


def available_actions(
    definition: SimulationDefinition | dict[str, Any], state: dict[str, Any], *, include_unlisted: bool = False
) -> list[dict[str, Any]]:
    """Learner-safe descriptions of the actions that can be taken now (no effects, scores or answers)."""
    d = parse_definition(definition)
    out = []
    for a in d.actions:
        if (not include_unlisted and not is_listed(a)) or not is_available(d, state, a):
            continue
        out.append({
            "id": a.id, "tool": a.tool, "label": a.label, "kind": a.kind, "description": a.description,
            "character": a.character,
            "input": {"type": a.input.type, "placeholder": a.input.placeholder, "min_length": a.input.min_length,
                      "choices": [{"id": c.id, "label": c.label} for c in a.input.choices]},
        })
    return out


def public_variables(d: SimulationDefinition, state: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in state["variables"].items()
            if (spec := d.variables.get(k)) is not None and spec.visibility == "public"}


def _phase_list(d: SimulationDefinition, state: dict[str, Any]) -> list[dict[str, Any]]:
    visited = {p["phase"] for p in state["phase_history"]}
    order = d.scoring.process.required_order if d.scoring.process else [p.id for p in d.phases]
    ids = [p for p in order if d.phase(p)]
    for p in d.phases:
        if p.id not in ids and (p.id in visited):
            ids.append(p.id)
    out = []
    for pid in ids:
        ph = d.phase(pid)
        assert ph is not None
        status = "current" if pid == state["phase"] else ("done" if pid in visited else "upcoming")
        out.append({"id": pid, "name": ph.name, "status": status})
    return out


def learner_view(definition: SimulationDefinition | dict[str, Any], state: dict[str, Any]) -> dict[str, Any]:
    """Everything the learner's UI needs, with secret/internal variables, unrevealed facts, action
    consequences, classifications and scoring rules stripped."""
    d = parse_definition(definition)
    ctx = _ctx(state)
    ph = d.phase(state["phase"])
    panels = []
    for p in d.environment.panels:
        if not truthy(p.visible_when, ctx):
            continue
        data = copy.deepcopy(p.data)
        for v in p.variants:
            if truthy(v.when, ctx):
                data.update(copy.deepcopy(v.data))
        panels.append({"id": p.id, "type": p.type, "title": p.title, "data": render_data(data, ctx)})
    tools = []
    for t in d.tools:
        if not truthy(t.visible_when, ctx):
            continue
        free = sorted({a.input.type for a in d.actions if a.tool == t.id and a.input.type in ("command", "free_text")})
        tools.append({"id": t.id, "name": t.name, "panel": t.panel, "description": t.description, "icon": t.icon,
                      "prompt": render(t.prompt, ctx), "accepts": free})
    revealed = []
    for fid in state["revealed_facts"]:
        found = d.fact(fid)
        if found:
            char, fact = found
            revealed.append({"id": fid, "character": char.id, "character_name": char.name,
                             "text": render(fact.text, ctx)})
    pub = public_variables(d, state)
    characters = []
    for c in d.characters:
        characters.append({"id": c.id, "name": c.name, "role": c.role, "avatar": c.avatar,
                           "patience": pub.get(c.patience_var) if c.patience_var else None})
    eff = d.scoring.efficiency
    return {
        "schema_version": d.schema_version,
        "meta": {k: getattr(d.meta, k) for k in ("title", "description", "industry", "environment_type",
                                                   "difficulty", "estimated_minutes", "briefing", "learner_role",
                                                   "objectives")},
        "phase": {"id": state["phase"], "name": ph.name if ph else state["phase"],
                  "description": ph.description if ph else ""},
        "phases": _phase_list(d, state),
        "panels": panels,
        "tools": tools,
        "characters": characters,
        "revealed_facts": revealed,
        "variables": pub,
        "problems": copy.deepcopy(state["problems"]),
        "transcript": copy.deepcopy(state["transcript"]),
        "available_actions": available_actions(d, state),
        "sim_minutes": state["minutes"],
        "target_minutes": eff.target_minutes if eff else None,
        "action_count": state["seq"],
        "ended": bool(state["ended"]),
        "end_reason": state["end_reason"],
    }


_PUBLIC_OUTCOME_KEYS = ("seq", "accepted", "matched", "action_id", "label", "tool", "kind", "character",
                        "outputs", "messages", "events", "revealed_facts", "problems_added", "problems_removed",
                        "phase_before", "phase_after", "phase_changed", "time_cost", "sim_minutes", "ended",
                        "end_reason", "notices", "reason", "message")


def public_outcome(
    definition: SimulationDefinition | dict[str, Any], outcome: dict[str, Any], *, include_feedback: bool = False
) -> dict[str, Any]:
    """Learner-safe projection of a step outcome. Classification, score deltas and feedback are only
    included when ``include_feedback`` (practice mode)."""
    d = parse_definition(definition)
    out = {k: copy.deepcopy(outcome.get(k)) for k in _PUBLIC_OUTCOME_KEYS}
    if out["action_id"] == UNKNOWN_ACTION_ID:
        out["action_id"] = None
    out["variables_changed"] = [v for v in outcome.get("variables_changed", [])
                                if (spec := d.variables.get(v)) is not None and spec.visibility == "public"]
    if include_feedback:
        out["classification"] = outcome.get("classification")
        out["feedback"] = outcome.get("feedback") or ""
        out["hint"] = outcome.get("hint") or ""
        out["score_deltas"] = copy.deepcopy(outcome.get("score_deltas") or {})
    return out


def sensitive_values(definition: SimulationDefinition | dict[str, Any], state: dict[str, Any]) -> list[str]:
    """Strings that must not appear in AI-generated text shown to the learner: values of secret variables,
    and values of internal variables the learner has not already been shown in the transcript."""
    d = parse_definition(definition)
    shown = " ".join(str(e.get("text", "")) for e in state.get("transcript", [])).lower()
    out: list[str] = []
    for name, spec in d.variables.items():
        if spec.visibility == "public":
            continue
        value = state["variables"].get(name)
        values = value if isinstance(value, list) else [value]
        for v in values:
            if isinstance(v, bool) or v is None:
                continue
            s = str(v).strip()
            if len(s) < 3:
                continue
            if spec.visibility == "secret" or s.lower() not in shown:
                out.append(s)
                if "_" in s:
                    out.append(s.replace("_", " "))
    return sorted(set(out))
