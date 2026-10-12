"""Scoring and feedback: weighted dimensions → total (0–100) → band → pass/fail, plus rule-based feedback."""

from __future__ import annotations

from typing import Any

from simulation_engine.conditions import EvalContext, truthy
from simulation_engine.schema import SimulationDefinition, parse_definition, resolve_outcome


def _efficiency_factor(d: SimulationDefinition, state: dict[str, Any]) -> float:
    eff = d.scoring.efficiency
    if eff is None:
        return 1.0
    if eff.require_success and state.get("end_reason") != "success":
        return 0.0
    minutes = float(state.get("minutes", 0.0))
    if minutes <= eff.target_minutes:
        return 1.0
    if minutes >= eff.max_minutes or eff.max_minutes <= eff.target_minutes:
        return 0.0
    return 1.0 - (minutes - eff.target_minutes) / (eff.max_minutes - eff.target_minutes)


def process_adherence(d: SimulationDefinition, state: dict[str, Any]) -> dict[str, Any]:
    """Required phases skipped before the furthest required phase reached."""
    proc = d.scoring.process
    if proc is None:
        return {"skipped": [], "penalty": 0.0, "order": []}
    visited = []
    for entry in state.get("phase_history", []):
        if entry["phase"] not in visited:
            visited.append(entry["phase"])
    reached = [proc.required_order.index(p) for p in visited if p in proc.required_order]
    furthest = max(reached) if reached else -1
    skipped = [p for p in proc.required_order[: furthest + 1] if p not in visited]
    return {"skipped": skipped, "penalty": proc.skip_penalty * len(skipped), "order": visited}


def compute_scores(definition: SimulationDefinition | dict[str, Any], state: dict[str, Any]) -> dict[str, Any]:
    d = parse_definition(definition)
    sc = d.scoring
    process = process_adherence(d, state)
    eff_factor = _efficiency_factor(d, state)
    dims = []
    total = 0.0
    for dim in sc.dimensions:
        delta = float(state.get("score", {}).get(dim.id, 0.0))
        raw = (dim.max_points if dim.baseline == "full" else 0.0) + delta
        if sc.efficiency and dim.id == sc.efficiency.dimension:
            raw = dim.max_points * eff_factor + delta
        if sc.process and dim.id == sc.process.dimension:
            raw -= process["penalty"]
        raw = max(0.0, min(dim.max_points, raw))
        pct = raw / dim.max_points if dim.max_points > 0 else 0.0
        weighted = pct * dim.weight
        total += weighted
        dims.append({"id": dim.id, "name": dim.name, "weight": dim.weight, "raw": round(raw, 2),
                     "max_points": dim.max_points, "percent": round(pct * 100, 1), "score": round(weighted, 2)})
    total = round(total, 1)
    critical = bool(state.get("criticals"))
    if critical and sc.critical_cap is not None:
        total = min(total, sc.critical_cap)
    band = band_for(d, total)
    completed = state.get("end_reason") == "success"
    passed = total >= sc.pass_mark and not critical and (completed or not sc.require_completion)
    return {"total_score": total, "band": band, "passed": passed, "dimensions": dims,
            "critical_failure": critical, "completed": completed, "process": process,
            "efficiency_factor": round(eff_factor, 3)}


def band_for(definition: SimulationDefinition | dict[str, Any], total: float) -> str:
    d = parse_definition(definition)
    for b in sorted(d.scoring.bands, key=lambda b: -b.min):
        if total >= b.min:
            return b.name
    return d.scoring.bands[-1].name if d.scoring.bands else "Fail"


def _label(d: SimulationDefinition, action_id: str) -> str:
    if action_id.startswith("event:"):
        ev = d.event(action_id[6:])
        return ev.title if ev and ev.title else action_id[6:]
    a = d.action(action_id)
    return a.label if a else action_id


def build_feedback(d: SimulationDefinition, state: dict[str, Any], scores: dict[str, Any]) -> dict[str, Any]:
    ctx = EvalContext.from_state(state)
    buckets: dict[str, list[dict[str, Any]]] = {"strength": [], "improvement": [], "missed_step": [], "tip": []}
    for rule in sorted(d.feedback_rules, key=lambda r: -r.priority):
        if truthy(rule.when, ctx):
            buckets[rule.type].append({"id": rule.id, "text": rule.text})
    critical, incorrect = [], []
    seen: set[tuple[str, str]] = set()
    for h in state.get("history", []):
        if h.get("type") != "action" or h["classification"] not in ("critical", "incorrect"):
            continue
        a = d.action(h["action_id"])
        spec = None
        if a is not None:
            br = next((b for i, b in enumerate(a.branches) if (b.id or str(i)) == h.get("branch")), None)
            spec = resolve_outcome(a, br)
        key = (h["action_id"], h.get("branch") or "")
        if key in seen:
            continue
        seen.add(key)
        item = {"action_id": h["action_id"], "label": h["label"], "feedback": spec.feedback if spec else "",
                "minutes": h["minutes"]}
        (critical if h["classification"] == "critical" else incorrect).append(item)
    for ev_id in [c for c in state.get("criticals", []) if c.startswith("event:")]:
        ev = d.event(ev_id[6:])
        critical.append({"action_id": ev_id, "label": _label(d, ev_id), "feedback": ev.feedback if ev else "",
                         "minutes": None})
    for skipped in scores["process"]["skipped"]:
        ph = d.phase(skipped)
        buckets["improvement"].append({
            "id": f"process_skipped_{skipped}",
            "text": f"You skipped the {ph.name if ph else skipped} phase. Follow the full troubleshooting "
                    "process instead of jumping ahead.",
        })
    weakest = sorted(scores["dimensions"], key=lambda x: x["percent"])
    if weakest and weakest[0]["percent"] < 60:
        buckets["tip"].append({"id": f"focus_{weakest[0]['id']}",
                               "text": f"Focus area: {weakest[0]['name']} ({weakest[0]['percent']}%)."})
    timeline = [{"seq": h["seq"], "minutes": h["minutes"], "type": h["type"], "label": h["label"],
                 "classification": h["classification"], "phase": h.get("phase_after") or h.get("phase_before")}
                for h in state.get("history", [])]
    reason = state.get("end_reason")
    reason_text = {"success": "resolved the scenario", "failure": "ended the scenario unsuccessfully",
                   "escalated": "escalated the scenario", "timeout": "ran out of time",
                   "action_limit": "reached the action limit"}.get(reason or "", "did not finish the scenario")
    summary = (f"You {reason_text} in {state.get('minutes', 0):g} simulated minutes and scored "
               f"{scores['total_score']:g}/100 ({scores['band']}). "
               + ("Passed." if scores["passed"] else "Not yet passed."))
    if critical:
        summary += " A critical error capped your score."
    return {
        "summary": summary,
        "strengths": buckets["strength"],
        "improvements": buckets["improvement"],
        "missed_steps": buckets["missed_step"],
        "tips": buckets["tip"],
        "critical_actions": critical,
        "incorrect_actions": incorrect,
        "timeline": timeline,
    }


def finish(definition: SimulationDefinition | dict[str, Any], state: dict[str, Any]) -> dict[str, Any]:
    """Score a (finished or abandoned) run. Does not mutate ``state``; unfinished runs are scored as-is
    with ``end_reason`` = ``state['end_reason']`` or ``"incomplete"``."""
    d = parse_definition(definition)
    st = dict(state)
    if not st.get("end_reason"):
        st["end_reason"] = "incomplete"
    scores = compute_scores(d, st)
    feedback = build_feedback(d, st, scores)
    eff = d.scoring.efficiency
    return {
        **{k: scores[k] for k in ("total_score", "band", "passed", "dimensions", "critical_failure", "completed")},
        "end_reason": st["end_reason"],
        "sim_minutes": st.get("minutes", 0.0),
        "target_minutes": eff.target_minutes if eff else None,
        "actions_taken": st.get("seq", 0),
        "process": scores["process"],
        "feedback": feedback,
    }
