"""Converters between a definition and a node/edge graph for a React Flow style builder.

Nodes: ``phase:<id>``, ``action:<id>``, ``branch:<action_id>:<index>``, ``event:<id>``; each node's
``data`` is the full JSON of the entity (so the builder's side panel can edit any field).
Edges (``type``): ``transition`` (phase → phase, ``data.auto`` + ``data.when`` for auto-advance rules),
``contains`` (phase → action: phases where the action is available), ``branch`` (action → branch,
``data.order``), ``effect_transition`` (action/branch/event → phase: forced transition effect),
``triggers`` (action → event, ``data.kind`` = ``after_action`` | ``effect``).

``from_graph(graph, base)`` rebuilds phases, actions and events from the graph and keeps every other
section (meta, environment, characters, variables, scoring, …) from ``base``. Positions are layout only.
"""

from __future__ import annotations

import copy
from typing import Any

from simulation_engine.schema import SimulationDefinition, parse_definition

GRAPH_VERSION = 1
_COL, _ROW = 360, 120


def _phase_order(d: SimulationDefinition) -> list[str]:
    order: list[str] = []
    todo = [d.initial_phase]
    while todo:
        cur = todo.pop(0)
        if cur in order or d.phase(cur) is None:
            continue
        order.append(cur)
        todo.extend(d.phase(cur).transitions)  # type: ignore[union-attr]
    order += [p.id for p in d.phases if p.id not in order]
    return order


def _transition_targets(spec: Any) -> list[str]:
    return [e.transition for e in spec.effects if e.transition]


def to_graph(definition: SimulationDefinition | dict[str, Any]) -> dict[str, Any]:
    d = parse_definition(definition)
    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    order = _phase_order(d)
    col = {pid: i for i, pid in enumerate(order)}
    for p in d.phases:
        nodes.append({"id": f"phase:{p.id}", "type": "phase", "position": {"x": col[p.id] * _COL, "y": 0},
                      "data": p.model_dump(mode="json")})
        auto_targets = {aa.to for aa in p.auto_advance}
        for t in p.transitions:
            if t not in auto_targets:
                edges.append({"id": f"t:{p.id}->{t}", "source": f"phase:{p.id}", "target": f"phase:{t}",
                              "type": "transition", "data": {"auto": False, "when": None}})
        for i, aa in enumerate(p.auto_advance):
            edges.append({"id": f"t:{p.id}->{aa.to}:auto:{i}", "source": f"phase:{p.id}",
                          "target": f"phase:{aa.to}", "type": "transition", "data": {"auto": True, "when": aa.when}})
    slots: dict[int, int] = {}
    for a in d.actions:
        c = min((col.get(p, 0) for p in a.phases), default=-1)
        row = slots.get(c, 0)
        slots[c] = row + 1
        x, y = c * _COL, 160 + row * _ROW
        nodes.append({"id": f"action:{a.id}", "type": "action", "position": {"x": x, "y": y},
                      "data": a.model_dump(mode="json", exclude={"branches"})})
        for p in a.phases:
            edges.append({"id": f"c:{p}:{a.id}", "source": f"phase:{p}", "target": f"action:{a.id}",
                          "type": "contains"})
        for t in _transition_targets(a):
            edges.append({"id": f"x:action:{a.id}->{t}", "source": f"action:{a.id}", "target": f"phase:{t}",
                          "type": "effect_transition"})
        for i, br in enumerate(a.branches):
            bid = f"branch:{a.id}:{i}"
            nodes.append({"id": bid, "type": "branch", "position": {"x": x + 180, "y": y + 40 * (i + 1)},
                          "data": br.model_dump(mode="json")})
            edges.append({"id": f"b:{a.id}:{i}", "source": f"action:{a.id}", "target": bid, "type": "branch",
                          "data": {"order": i}})
            for t in _transition_targets(br):
                edges.append({"id": f"x:{bid}->{t}", "source": bid, "target": f"phase:{t}",
                              "type": "effect_transition"})
        for spec in [a, *a.branches]:
            for e in spec.effects:
                if e.trigger_event:
                    edges.append({"id": f"tr:{a.id}->{e.trigger_event}", "source": f"action:{a.id}",
                                  "target": f"event:{e.trigger_event}", "type": "triggers",
                                  "data": {"kind": "effect"}})
    for i, ev in enumerate(d.events):
        nodes.append({"id": f"event:{ev.id}", "type": "event", "position": {"x": i * 260, "y": -220},
                      "data": ev.model_dump(mode="json")})
        if ev.trigger.type == "after_action" and ev.trigger.action:
            edges.append({"id": f"tr:{ev.trigger.action}->{ev.id}:after", "source": f"action:{ev.trigger.action}",
                          "target": f"event:{ev.id}", "type": "triggers", "data": {"kind": "after_action"}})
        for t in _transition_targets(ev):
            edges.append({"id": f"x:event:{ev.id}->{t}", "source": f"event:{ev.id}", "target": f"phase:{t}",
                          "type": "effect_transition"})
    # de-duplicate edge ids (an action may trigger the same event from several branches)
    seen: set[str] = set()
    unique = []
    for e in edges:
        if e["id"] not in seen:
            seen.add(e["id"])
            unique.append(e)
    return {"version": GRAPH_VERSION, "initial_phase": d.initial_phase, "nodes": nodes, "edges": unique}


def _entity_id(node: dict[str, Any]) -> str:
    data = node.get("data") or {}
    if data.get("id"):
        return str(data["id"])
    return str(node["id"]).split(":", 1)[-1]


def _apply_transitions(spec: dict[str, Any], targets: list[str]) -> None:
    effects = spec.get("effects") or []
    current = [e.get("transition") for e in effects if e.get("transition")]
    if sorted(current) == sorted(targets):
        return
    cleaned = []
    for e in effects:
        e = {k: v for k, v in e.items() if k != "transition"}
        if any(v not in (None, [], {}) for v in e.values()):
            cleaned.append(e)
    cleaned += [{"transition": t} for t in targets]
    spec["effects"] = cleaned


def from_graph(graph: dict[str, Any], base: SimulationDefinition | dict[str, Any]) -> dict[str, Any]:
    """Rebuild a definition dict from builder graph + base definition (validate the result separately)."""
    base_d = parse_definition(base)
    out = base_d.model_dump(mode="json")
    nodes = [n for n in graph.get("nodes", []) if isinstance(n, dict) and n.get("id")]
    edges = [e for e in graph.get("edges", []) if isinstance(e, dict)]
    by_node = {n["id"]: n for n in nodes}
    ent = {n["id"]: _entity_id(n) for n in nodes}

    def out_edges(node_id: str, etype: str) -> list[dict[str, Any]]:
        return [e for e in edges if e.get("source") == node_id and e.get("type") == etype]

    def target_entity(e: dict[str, Any]) -> str | None:
        t = e.get("target")
        return ent.get(t) if t in by_node else None

    phases = []
    phase_nodes = [n for n in nodes if n.get("type") == "phase"]
    for n in phase_nodes:
        data = copy.deepcopy(n.get("data") or {})
        data["id"] = ent[n["id"]]
        trans = out_edges(n["id"], "transition")
        targets = [target_entity(e) for e in trans]
        existing = [t for t in data.get("transitions", []) if t in targets]
        data["transitions"] = existing + [t for t in dict.fromkeys(targets) if t and t not in existing]
        data["auto_advance"] = [{"to": target_entity(e), "when": (e.get("data") or {}).get("when")}
                                for e in trans if (e.get("data") or {}).get("auto") and target_entity(e)]
        phases.append(data)
    if phases:
        out["phases"] = phases
    out["initial_phase"] = graph.get("initial_phase") or out["initial_phase"]
    phase_rank = {p["id"]: i for i, p in enumerate(out["phases"])}

    actions = []
    for n in nodes:
        if n.get("type") != "action":
            continue
        data = copy.deepcopy(n.get("data") or {})
        data["id"] = ent[n["id"]]
        containing = [ent[e["source"]] for e in edges
                      if e.get("type") == "contains" and e.get("target") == n["id"] and e.get("source") in ent]
        kept = [p for p in data.get("phases", []) if p in containing]
        added = sorted((p for p in dict.fromkeys(containing) if p not in kept), key=lambda p: phase_rank.get(p, 999))
        data["phases"] = kept + added
        _apply_transitions(data, [t for e in out_edges(n["id"], "effect_transition") if (t := target_entity(e))])
        branch_edges = sorted(out_edges(n["id"], "branch"), key=lambda e: (e.get("data") or {}).get("order", 0))
        branches = []
        for be in branch_edges:
            bn = by_node.get(be.get("target"))
            if bn is None:
                continue
            bdata = copy.deepcopy(bn.get("data") or {})
            _apply_transitions(bdata, [t for e in out_edges(bn["id"], "effect_transition")
                                       if (t := target_entity(e))])
            branches.append(bdata)
        data["branches"] = branches
        actions.append(data)
    out["actions"] = actions

    events = []
    for n in nodes:
        if n.get("type") != "event":
            continue
        data = copy.deepcopy(n.get("data") or {})
        data["id"] = ent[n["id"]]
        after = [ent[e["source"]] for e in edges if e.get("type") == "triggers" and e.get("target") == n["id"]
                 and (e.get("data") or {}).get("kind") == "after_action" and e.get("source") in ent]
        if after:
            data.setdefault("trigger", {})["type"] = "after_action"
            data["trigger"]["action"] = after[0]
        _apply_transitions(data, [t for e in out_edges(n["id"], "effect_transition") if (t := target_entity(e))])
        events.append(data)
    out["events"] = events
    return out


def merge_positions(graph: dict[str, Any], saved: dict[str, Any] | None) -> dict[str, Any]:
    """Copy node positions from a previously saved builder graph onto a freshly generated one."""
    if not saved:
        return graph
    pos = {n.get("id"): n.get("position") for n in saved.get("nodes", []) if isinstance(n, dict)}
    for n in graph["nodes"]:
        if isinstance(pos.get(n["id"]), dict):
            n["position"] = pos[n["id"]]
    return graph
