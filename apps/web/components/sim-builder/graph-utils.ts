/**
 * Pure helpers for the graph builder: derived edges, auto-layout, validation → node mapping,
 * connection rules, cascading deletes and human-readable condition summaries.
 *
 * Source of truth: node `data` (phase transitions/auto-advance, action phases, transition effects,
 * event triggers) + explicit branch links (action → branch ownership/order). Edges are always derived,
 * so what the canvas shows is exactly what `from_graph` will rebuild on the server.
 */
import type { Edge, Node } from "@xyflow/react";
import type {
  BuilderGraph,
  Condition,
  GraphEdgeJson,
  RefContext,
  SimAction,
  SimDefinition,
  SimEdgeKind,
  SimEffect,
  SimEvent,
  SimNodeType,
  SimPhase,
  ValidationIssue,
  ValidationOut,
} from "./types";

export type SimNode = Node<Record<string, unknown>, SimNodeType>;
export interface SimEdgeData extends Record<string, unknown> {
  kind: SimEdgeKind;
  auto?: boolean;
  when?: Condition;
  order?: number;
  triggerKind?: "after_action" | "effect";
}
export type SimEdge = Edge<SimEdgeData>;

export interface BranchLink {
  id: string;
  source: string; // action node id
  target: string; // branch node id
  order: number;
}

export const NODE_SIZE: Record<SimNodeType, { w: number; h: number }> = {
  phase: { w: 236, h: 104 },
  action: { w: 252, h: 112 },
  branch: { w: 212, h: 76 },
  event: { w: 240, h: 100 },
};

/* ------------------------------------------------------------------ entity helpers */

export const entityId = (n: Pick<SimNode, "id" | "data">): string => String((n.data as { id?: unknown }).id || n.id.split(":").slice(1).join(":"));

export function cleanEffects(effects: SimEffect[] | undefined | null): SimEffect[] {
  return (effects ?? []).filter(Boolean);
}

export const transitionsOf = (data: { effects?: SimEffect[] | null }): string[] =>
  Array.from(new Set(cleanEffects(data.effects).map((e) => e.transition).filter((t): t is string => !!t)));

export const triggeredEventsOf = (data: { effects?: SimEffect[] | null }): string[] =>
  Array.from(new Set(cleanEffects(data.effects).map((e) => e.trigger_event).filter((t): t is string => !!t)));

export function graphToState(graph: BuilderGraph): { nodes: SimNode[]; links: BranchLink[]; initial: string } {
  const nodes: SimNode[] = graph.nodes.map((n) => ({
    id: n.id,
    type: n.type,
    position: { x: Number(n.position?.x) || 0, y: Number(n.position?.y) || 0 },
    data: n.data ?? {},
  }));
  const links: BranchLink[] = graph.edges
    .filter((e) => e.type === "branch")
    .map((e) => ({ id: e.id, source: e.source, target: e.target, order: Number((e.data as { order?: number } | null)?.order ?? 0) }));
  return { nodes, links, initial: graph.initial_phase };
}

export function stateToGraph(nodes: SimNode[], edges: SimEdge[], initial: string): BuilderGraph {
  return {
    version: 1,
    initial_phase: initial,
    nodes: nodes.map((n) => ({ id: n.id, type: n.type as SimNodeType, position: { x: Math.round(n.position.x), y: Math.round(n.position.y) }, data: n.data })),
    edges: edges.map(
      (e): GraphEdgeJson => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: e.data!.kind,
        data:
          e.data!.kind === "transition"
            ? { auto: !!e.data!.auto, when: e.data!.auto ? (e.data!.when ?? null) : null }
            : e.data!.kind === "branch"
              ? { order: e.data!.order ?? 0 }
              : e.data!.kind === "triggers"
                ? { kind: e.data!.triggerKind ?? "effect" }
                : null,
      }),
    ),
  };
}

/* ------------------------------------------------------------------ derived edges */

export function deriveEdges(nodes: SimNode[], links: BranchLink[]): SimEdge[] {
  const byType = (t: SimNodeType) => nodes.filter((n) => n.type === t);
  const phaseNode = new Map(byType("phase").map((n) => [entityId(n), n.id]));
  const actionNode = new Map(byType("action").map((n) => [entityId(n), n.id]));
  const eventNode = new Map(byType("event").map((n) => [entityId(n), n.id]));
  const nodeIds = new Set(nodes.map((n) => n.id));
  const out: SimEdge[] = [];
  const push = (e: SimEdge) => out.push(e);

  for (const p of byType("phase")) {
    const d = p.data as unknown as SimPhase;
    const pid = entityId(p);
    const auto = d.auto_advance ?? [];
    const autoTargets = new Set(auto.map((a) => a.to));
    for (const t of d.transitions ?? []) {
      const target = phaseNode.get(t);
      if (target && !autoTargets.has(t))
        push({ id: `t:${pid}->${t}`, source: p.id, target, sourceHandle: "out", targetHandle: "in", type: "sim", data: { kind: "transition", auto: false, when: null } });
    }
    auto.forEach((aa, i) => {
      const target = phaseNode.get(aa.to);
      if (target) push({ id: `t:${pid}->${aa.to}:auto:${i}`, source: p.id, target, sourceHandle: "out", targetHandle: "in", type: "sim", data: { kind: "transition", auto: true, when: aa.when } });
    });
  }

  const branchesOf = new Map<string, BranchLink[]>();
  for (const l of links) {
    if (!nodeIds.has(l.source) || !nodeIds.has(l.target)) continue;
    branchesOf.set(l.source, [...(branchesOf.get(l.source) ?? []), l]);
  }

  for (const a of byType("action")) {
    const d = a.data as unknown as SimAction;
    const aid = entityId(a);
    for (const p of d.phases ?? []) {
      const source = phaseNode.get(p);
      if (source) push({ id: `c:${p}:${aid}`, source, target: a.id, sourceHandle: "contains", targetHandle: "in-top", type: "sim", data: { kind: "contains" } });
    }
    for (const t of transitionsOf(d)) {
      const target = phaseNode.get(t);
      if (target) push({ id: `x:action:${aid}->${t}`, source: a.id, target, sourceHandle: "out", targetHandle: "in", type: "sim", data: { kind: "effect_transition" } });
    }
    const evs = new Set(triggeredEventsOf(d));
    for (const l of (branchesOf.get(a.id) ?? []).sort((x, y) => x.order - y.order)) {
      const bn = nodes.find((n) => n.id === l.target);
      if (!bn) continue;
      push({ id: l.id, source: a.id, target: bn.id, sourceHandle: "out", targetHandle: "in", type: "sim", data: { kind: "branch", order: l.order }, deletable: false });
      for (const t of transitionsOf(bn.data as SimEffectHolder)) {
        const target = phaseNode.get(t);
        if (target) push({ id: `x:${bn.id}->${t}`, source: bn.id, target, sourceHandle: "out", targetHandle: "in", type: "sim", data: { kind: "effect_transition" } });
      }
      triggeredEventsOf(bn.data as SimEffectHolder).forEach((e) => evs.add(e));
    }
    for (const e of evs) {
      const target = eventNode.get(e);
      if (target) push({ id: `tr:${aid}->${e}`, source: a.id, target, sourceHandle: "out", targetHandle: "in-top", type: "sim", data: { kind: "triggers", triggerKind: "effect" }, deletable: false });
    }
  }

  for (const ev of byType("event")) {
    const d = ev.data as unknown as SimEvent;
    const eid = entityId(ev);
    if (d.trigger?.type === "after_action" && d.trigger.action) {
      const source = actionNode.get(d.trigger.action);
      if (source) push({ id: `tr:${d.trigger.action}->${eid}:after`, source, target: ev.id, sourceHandle: "out", targetHandle: "in-top", type: "sim", data: { kind: "triggers", triggerKind: "after_action" } });
    }
    for (const t of transitionsOf(d)) {
      const target = phaseNode.get(t);
      if (target) push({ id: `x:event:${eid}->${t}`, source: ev.id, target, sourceHandle: "out", targetHandle: "in", type: "sim", data: { kind: "effect_transition" } });
    }
  }

  const seen = new Set<string>();
  return out.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
}

type SimEffectHolder = { effects?: SimEffect[] | null };

/* ------------------------------------------------------------------ layout */

export function phaseOrder(nodes: SimNode[], initial: string): string[] {
  const phases = nodes.filter((n) => n.type === "phase");
  const byId = new Map(phases.map((p) => [entityId(p), p.data as unknown as SimPhase]));
  const order: string[] = [];
  const todo = [initial];
  while (todo.length) {
    const cur = todo.shift()!;
    if (order.includes(cur) || !byId.has(cur)) continue;
    order.push(cur);
    todo.push(...(byId.get(cur)!.transitions ?? []), ...(byId.get(cur)!.auto_advance ?? []).map((a) => a.to));
  }
  for (const p of phases) if (!order.includes(entityId(p))) order.push(entityId(p));
  return order;
}

const COL = 560;

/** Deterministic layered layout: phases across the top, events above, phase-scoped actions (with branches) under
 * their earliest phase, and actions available in every phase in a grid band underneath. */
export function autoLayout(nodes: SimNode[], links: BranchLink[], initial: string): SimNode[] {
  const order = phaseOrder(nodes, initial);
  const col = new Map(order.map((p, i) => [p, i]));
  const pos = new Map<string, { x: number; y: number }>();
  nodes.filter((n) => n.type === "phase").forEach((p) => pos.set(p.id, { x: (col.get(entityId(p)) ?? 0) * COL, y: 0 }));
  nodes.filter((n) => n.type === "event").forEach((e, i) => pos.set(e.id, { x: i * 300, y: -250 }));

  const branchesOf = (aid: string) =>
    links
      .filter((l) => l.source === aid)
      .sort((a, b) => a.order - b.order)
      .map((l) => l.target)
      .filter((id) => nodes.some((n) => n.id === id));
  const blockH = (aid: string) => Math.max(NODE_SIZE.action.h, branchesOf(aid).length * (NODE_SIZE.branch.h + 14)) + 36;
  const place = (a: SimNode, x: number, y: number) => {
    pos.set(a.id, { x, y });
    branchesOf(a.id).forEach((b, i) => pos.set(b, { x: x + NODE_SIZE.action.w + 40, y: y + i * (NODE_SIZE.branch.h + 14) }));
  };

  const actions = nodes.filter((n) => n.type === "action");
  const scoped = new Map<number, SimNode[]>();
  const global: SimNode[] = [];
  for (const a of actions) {
    const phases = ((a.data as unknown as SimAction).phases ?? []).filter((p) => col.has(p));
    if (!phases.length) global.push(a);
    else {
      const c = Math.min(...phases.map((p) => col.get(p)!));
      scoped.set(c, [...(scoped.get(c) ?? []), a]);
    }
  }
  let bottom = 180;
  for (const [c, list] of scoped) {
    let y = 190;
    for (const a of list) {
      place(a, c * COL, y);
      y += blockH(a.id);
    }
    bottom = Math.max(bottom, y);
  }
  const cols = Math.max(3, order.length);
  let y = scoped.size ? bottom + 120 : 190;
  for (let i = 0; i < global.length; i += cols) {
    const row = global.slice(i, i + cols);
    row.forEach((a, j) => place(a, j * COL, y));
    y += Math.max(...row.map((a) => blockH(a.id)));
  }
  return nodes.map((n) => (pos.has(n.id) ? { ...n, position: pos.get(n.id)! } : n));
}

/** True when any two nodes' boxes intersect — e.g. a graph generated server-side with default positions
 * that were never arranged in the builder. Used to auto-arrange on first open. */
/**
 * True when (nearly) every node still sits where the engine's `to_graph` puts it by default (phases on a
 * 360px column grid at y=0, actions in 120px rows below, branches offset from their action, events in a row
 * at y=-220) — i.e. the graph was AI-built/seeded and never arranged by an instructor. Saved layouts are
 * kept as-is, even with some overlap; "Auto-layout" stays an explicit button.
 */
export function isUnarranged(nodes: SimNode[]): boolean {
  if (!nodes.length) return false;
  const COL = 360;
  const ROW = 120;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let defaults = 0;
  for (const n of nodes) {
    const { x, y } = n.position;
    let ok = false;
    if (n.type === "phase") ok = y === 0 && x % COL === 0;
    else if (n.type === "action") ok = x % COL === 0 && y >= 160 && (y - 160) % ROW === 0;
    else if (n.type === "event") ok = y === -220 && x % 260 === 0;
    else if (n.type === "branch") {
      const m = /^branch:(.+):(\d+)$/.exec(n.id);
      const parent = m ? byId.get(`action:${m[1]}`) : undefined;
      ok = !!parent && x === parent.position.x + 180 && y === parent.position.y + 40 * (Number(m![2]) + 1);
    }
    if (ok) defaults++;
  }
  return defaults / nodes.length >= 0.8;
}

export function hasOverlaps(nodes: SimNode[]): boolean {
  const boxes = nodes.map((n) => {
    const s = NODE_SIZE[(n.type ?? "action") as SimNodeType] ?? NODE_SIZE.action;
    return { x: n.position.x, y: n.position.y, w: s.w, h: s.h };
  });
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      if (a.x < b.x + b.w - 8 && b.x < a.x + a.w - 8 && a.y < b.y + b.h - 8 && b.y < a.y + a.h - 8) return true;
    }
  return false;
}

/* ------------------------------------------------------------------ validation mapping */

export type BuilderTab = "flow" | "scenario" | "environment" | "characters" | "variables" | "scoring" | "feedback" | "json";

export interface MappedIssue extends ValidationIssue {
  severity: "error" | "warning";
  nodeId?: string;
  tab: BuilderTab;
}

export function tabForPath(path: string): BuilderTab {
  const head = path.split(/[.[]/)[0] ?? "";
  if (["phases", "actions", "events", "initial_phase"].includes(head)) return "flow";
  if (head === "scoring") return "scoring";
  if (["environment", "tools"].includes(head)) return "environment";
  if (["characters", "intents", "synonyms"].includes(head)) return "characters";
  if (["variables", "variations"].includes(head)) return "variables";
  if (head === "feedback_rules") return "feedback";
  if (["meta", "completion", "settings", "opening_messages", "schema_version", "key"].includes(head)) return "scenario";
  return "json";
}

export function mapIssues(v: ValidationOut | null | undefined, nodes: SimNode[], links: BranchLink[]): MappedIssue[] {
  if (!v) return [];
  const ofType = (t: SimNodeType) => nodes.filter((n) => n.type === t);
  const target = (path: string): string | undefined => {
    const m = path.match(/^(phases|actions|events)(?:\[(\d+)\]|\.(\d+))(?:\.branches(?:\[(\d+)\]|\.(\d+)))?/);
    if (!m) return undefined;
    const type = m[1] === "phases" ? "phase" : m[1] === "actions" ? "action" : "event";
    const node = ofType(type)[Number(m[2] ?? m[3])];
    if (!node) return undefined;
    const bi = m[4] ?? m[5];
    if (bi !== undefined && type === "action") {
      const b = links.filter((l) => l.source === node.id).sort((x, y) => x.order - y.order)[Number(bi)];
      return b?.target ?? node.id;
    }
    return node.id;
  };
  return [
    ...v.errors.map((e) => ({ ...e, severity: "error" as const, nodeId: target(e.path), tab: tabForPath(e.path) })),
    ...v.warnings.map((e) => ({ ...e, severity: "warning" as const, nodeId: target(e.path), tab: tabForPath(e.path) })),
  ];
}

/* ------------------------------------------------------------------ references */

export function buildRefContext(def: SimDefinition | null, nodes: SimNode[]): RefContext {
  const phases = nodes.filter((n) => n.type === "phase").map((n) => ({ id: entityId(n), name: String((n.data as { name?: string }).name ?? entityId(n)) }));
  const actions = nodes.filter((n) => n.type === "action").map((n) => ({ id: entityId(n), label: String((n.data as { label?: string }).label ?? entityId(n)) }));
  const events = nodes.filter((n) => n.type === "event").map((n) => ({ id: entityId(n), title: String((n.data as { title?: string }).title || entityId(n)) }));
  const problems = new Set<string>();
  const scan = (effects?: SimEffect[] | null) => cleanEffects(effects).forEach((e) => e.add_problem?.id && problems.add(e.add_problem.id));
  nodes.forEach((n) => scan((n.data as SimEffectHolder).effects));
  return {
    variables: Object.entries(def?.variables ?? {}).map(([id, v]) => ({ id, type: v.type, visibility: v.visibility, label: v.label })),
    phases: phases.length ? phases : (def?.phases ?? []).map((p) => ({ id: p.id, name: p.name })),
    actions: actions.length ? actions : (def?.actions ?? []).map((a) => ({ id: a.id, label: a.label })),
    events: events.length ? events : (def?.events ?? []).map((e) => ({ id: e.id, title: e.title || e.id })),
    facts: (def?.characters ?? []).flatMap((c) => (c.facts ?? []).map((f) => ({ id: f.id, text: f.text, character: c.name }))),
    characters: (def?.characters ?? []).map((c) => ({ id: c.id, name: c.name })),
    tools: (def?.tools ?? []).map((t) => ({ id: t.id, name: t.name })),
    panels: (def?.environment?.panels ?? []).map((p) => ({ id: p.id, title: p.title })),
    dimensions: (def?.scoring?.dimensions ?? []).map((d) => ({ id: d.id, name: d.name })),
    intents: (def?.intents ?? []).map((i) => ({ id: i.id })),
    problems: Array.from(problems),
  };
}

/* ------------------------------------------------------------------ condition summary */

const OP_SYMBOL: Record<string, string> = { "==": "=", "!=": "≠", "<": "<", "<=": "≤", ">": ">", ">=": "≥" };

function operand(v: unknown): string {
  if (v && typeof v === "object" && !Array.isArray(v) && "var" in (v as object)) {
    const x = (v as { var: unknown }).var;
    return Array.isArray(x) ? String(x[0]) : String(x);
  }
  if (typeof v === "string") return `"${v}"`;
  if (Array.isArray(v)) return `[${v.map(operand).join(", ")}]`;
  return JSON.stringify(v);
}

export function summarizeCondition(c: Condition, depth = 0): string {
  if (c === null || c === undefined || c === true) return "always";
  if (c === false) return "never";
  if (typeof c !== "object" || Array.isArray(c)) return JSON.stringify(c);
  const [op, args] = Object.entries(c as Record<string, unknown>)[0] ?? ["", null];
  const list = Array.isArray(args) ? args : [args];
  const wrap = (s: string) => (depth > 0 ? `(${s})` : s);
  switch (op) {
    case "and":
      return wrap(list.map((x) => summarizeCondition(x, depth + 1)).join(" and "));
    case "or":
      return wrap(list.map((x) => summarizeCondition(x, depth + 1)).join(" or "));
    case "!":
    case "not":
      return `not ${summarizeCondition(list[0], depth + 1)}`;
    case "var":
      return operand(c);
    case "==":
    case "!=":
    case "<":
    case "<=":
    case ">":
    case ">=":
      return `${operand(list[0])} ${OP_SYMBOL[op]} ${operand(list[1])}`;
    case "in":
      return `${operand(list[0])} in ${operand(list[1])}`;
    case "contains":
      return `${operand(list[0])} contains ${operand(list[1])}`;
    case "action_taken":
      return `did ${Array.isArray(args) ? `${args[0]} ×${args[1]}` : String(args)}`;
    case "has_fact":
      return `knows ${String(args)}`;
    case "phase_is":
      return `in ${Array.isArray(args) ? args.join("/") : String(args)}`;
    case "visited_phase":
      return `visited ${String(args)}`;
    case "event_fired":
      return `${String(args)} fired`;
    case "has_problem":
      return `problem ${String(args)}`;
    case "count":
      return `count(${operand(args)})`;
    case "count_keywords":
      return `keywords in ${operand(list[0])}`;
    default:
      return JSON.stringify(c);
  }
}

export const truncate = (s: string, n = 64) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/* ------------------------------------------------------------------ new nodes */

export function newNodeData(type: SimNodeType, id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  switch (type) {
    case "phase":
      return { id, name: id.charAt(0) + id.slice(1).toLowerCase().replace(/_/g, " "), description: "", transitions: [], auto_advance: [], terminal: false, ...extra };
    case "action":
      return {
        id,
        tool: "",
        label: id.replace(/_/g, " "),
        kind: "inspect",
        description: "",
        character: null,
        input: { type: "none", intents: [], patterns: [], choices: [], placeholder: "", min_length: 0 },
        preconditions: null,
        precondition_message: "That isn't possible right now.",
        phases: [],
        repeat: null,
        listed: null,
        hint: "",
        tags: [],
        effects: [],
        score: {},
        classification: "neutral",
        feedback: "",
        outputs: [],
        messages: [],
        time_cost: 1,
        ...extra,
      };
    case "branch":
      return { id, when: true, effects: [], score: null, classification: null, feedback: null, outputs: null, messages: [], time_cost: null, ...extra };
    case "event":
      return {
        id,
        title: id.replace(/_/g, " "),
        description: "",
        trigger: { type: "condition", at_minutes: null, condition: null, action: null },
        once: true,
        max_fires: null,
        notify: "",
        effects: [],
        score: {},
        classification: "neutral",
        feedback: "",
        outputs: [],
        messages: [],
        time_cost: null,
        ...extra,
      };
  }
}

export const slugId = (s: string, upper = false) => {
  const v = s
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return upper ? v.toUpperCase() : v.toLowerCase();
};

/* ------------------------------------------------------------------ connections */

export type ConnectResult = { nodes: SimNode[]; links: BranchLink[]; message: string } | { error: string };

function patchData(nodes: SimNode[], id: string, fn: (d: Record<string, unknown>) => Record<string, unknown>): SimNode[] {
  return nodes.map((n) => (n.id === id ? { ...n, data: fn(n.data) } : n));
}

export function canConnect(src: SimNode | undefined, dst: SimNode | undefined): string | null {
  if (!src || !dst) return "Unknown node";
  if (src.id === dst.id) return "A node can't connect to itself";
  const pair = `${src.type}->${dst.type}`;
  const ok = ["phase->phase", "phase->action", "action->branch", "action->phase", "branch->phase", "event->phase", "action->event"];
  return ok.includes(pair) ? null : `Can't connect a ${src.type} to a ${dst.type}`;
}

export function connect(nodes: SimNode[], links: BranchLink[], sourceId: string, targetId: string): ConnectResult {
  const src = nodes.find((n) => n.id === sourceId);
  const dst = nodes.find((n) => n.id === targetId);
  const err = canConnect(src, dst);
  if (err || !src || !dst) return { error: err ?? "Unknown node" };
  const sid = entityId(src);
  const did = entityId(dst);
  const pair = `${src.type}->${dst.type}`;
  if (pair === "phase->phase") {
    const d = src.data as unknown as SimPhase;
    if ((d.transitions ?? []).includes(did)) return { error: `${sid} can already move to ${did}` };
    return { nodes: patchData(nodes, src.id, (x) => ({ ...x, transitions: [...((x.transitions as string[]) ?? []), did] })), links, message: `Transition ${sid} → ${did} added` };
  }
  if (pair === "phase->action") {
    const d = dst.data as unknown as SimAction;
    if ((d.phases ?? []).includes(sid)) return { error: `${did} is already available in ${sid}` };
    return { nodes: patchData(nodes, dst.id, (x) => ({ ...x, phases: [...((x.phases as string[]) ?? []), sid] })), links, message: `${did} now available in ${sid}` };
  }
  if (pair === "action->branch") {
    const rest = links.filter((l) => l.target !== dst.id);
    const order = rest.filter((l) => l.source === src.id).length;
    return { nodes, links: [...rest, { id: `b:${sid}:${order}`, source: src.id, target: dst.id, order }], message: `Branch attached to ${sid}` };
  }
  if (pair === "action->event") {
    return {
      nodes: patchData(nodes, dst.id, (x) => ({ ...x, trigger: { ...((x.trigger as object) ?? {}), type: "after_action", action: sid } })),
      links,
      message: `${did} now fires after ${sid}`,
    };
  }
  // action/branch/event -> phase: forced transition effect
  if (transitionsOf(src.data as SimEffectHolder).includes(did)) return { error: `${sid} already forces a move to ${did}` };
  return {
    nodes: patchData(nodes, src.id, (x) => ({ ...x, effects: [...cleanEffects(x.effects as SimEffect[]), { transition: did }] })),
    links,
    message: `${sid} now forces a transition to ${did}`,
  };
}

/** Translate deleting a derived edge into a data change. Returns null when the edge can't be removed. */
export function removeEdge(nodes: SimNode[], edge: SimEdge): SimNode[] | null {
  const d = edge.data!;
  const src = nodes.find((n) => n.id === edge.source);
  const dst = nodes.find((n) => n.id === edge.target);
  if (!src || !dst) return null;
  const did = entityId(dst);
  if (d.kind === "transition") {
    if (d.auto) {
      const idx = Number(edge.id.split(":auto:")[1]);
      return patchData(nodes, src.id, (x) => ({ ...x, auto_advance: ((x.auto_advance as unknown[]) ?? []).filter((_, i) => i !== idx) }));
    }
    return patchData(nodes, src.id, (x) => ({ ...x, transitions: ((x.transitions as string[]) ?? []).filter((t) => t !== did) }));
  }
  if (d.kind === "contains") return patchData(nodes, dst.id, (x) => ({ ...x, phases: ((x.phases as string[]) ?? []).filter((p) => p !== entityId(src)) }));
  if (d.kind === "effect_transition")
    return patchData(nodes, src.id, (x) => ({
      ...x,
      effects: cleanEffects(x.effects as SimEffect[])
        .map((e) => (e.transition === did ? { ...e, transition: null } : e))
        .filter((e) => Object.values(e).some((v) => v !== null && v !== undefined && !(Array.isArray(v) && !v.length))),
    }));
  if (d.kind === "triggers" && d.triggerKind === "after_action")
    return patchData(nodes, dst.id, (x) => ({ ...x, trigger: { ...((x.trigger as object) ?? {}), type: "condition", action: null } }));
  return null;
}

/** Delete nodes (cascading branches of deleted actions) and clean phase references. */
export function deleteNodes(nodes: SimNode[], links: BranchLink[], ids: string[], initial: string) {
  const drop = new Set(ids);
  for (const id of ids) {
    const n = nodes.find((x) => x.id === id);
    if (n?.type === "action") links.filter((l) => l.source === id).forEach((l) => drop.add(l.target));
  }
  const removedPhases = new Set(nodes.filter((n) => drop.has(n.id) && n.type === "phase").map(entityId));
  let next = nodes.filter((n) => !drop.has(n.id));
  if (removedPhases.size) {
    next = next.map((n) => {
      const d = { ...n.data };
      if (n.type === "phase") {
        d.transitions = ((d.transitions as string[]) ?? []).filter((t) => !removedPhases.has(t));
        d.auto_advance = ((d.auto_advance as { to: string }[]) ?? []).filter((a) => !removedPhases.has(a.to));
      }
      if (n.type === "action") d.phases = ((d.phases as string[]) ?? []).filter((p) => !removedPhases.has(p));
      if (Array.isArray(d.effects)) d.effects = (d.effects as SimEffect[]).filter((e) => !(e?.transition && removedPhases.has(e.transition)));
      return { ...n, data: d };
    });
  }
  let nextLinks = links.filter((l) => !drop.has(l.source) && !drop.has(l.target));
  // re-number branch orders per action
  const byAction = new Map<string, BranchLink[]>();
  nextLinks.forEach((l) => byAction.set(l.source, [...(byAction.get(l.source) ?? []), l]));
  nextLinks = Array.from(byAction.values()).flatMap((ls) => ls.sort((a, b) => a.order - b.order).map((l, i) => ({ ...l, order: i })));
  const phases = next.filter((n) => n.type === "phase").map(entityId);
  const nextInitial = removedPhases.has(initial) ? (phases[0] ?? initial) : initial;
  return { nodes: next, links: nextLinks, initial: nextInitial };
}
