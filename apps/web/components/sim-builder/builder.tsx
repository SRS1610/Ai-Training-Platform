"use client";

import {
  Alert,
  Badge,
  Breadcrumbs,
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Sheet,
  SheetContent,
  SheetTitle,
  Skeleton,
  StatusPill,
  Tabs,
  TabsList,
  TabsTrigger,
  Tooltip,
  toast,
} from "@praxis/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ReactFlowProvider, applyNodeChanges, type Connection, type NodeChange } from "@xyflow/react";
import {
  BarChart3,
  Braces,
  CheckCircle2,
  ClipboardList,
  History,
  Loader2,
  MessageSquare,
  PanelsTopLeft,
  PanelRightOpen,
  Play,
  Rocket,
  RotateCcw,
  Save,
  Scale,
  ShieldCheck,
  Sparkles,
  Users,
  Variable,
  Workflow,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import * as React from "react";
import { ErrorState } from "@/components/common/error-state";
import { ApiError, api, errorMessage } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import { JsonTab, ProblemsSheet, TAB_LABEL, ValidationPill, VersionsSheet } from "./builder-panels";
import { CharactersTab, EnvironmentTab, FeedbackTab, ScenarioTab, ScoringTab, VariablesTab, type SimSettingsForm } from "./def-tabs";
import { FieldRow, MiniInput, MiniSelect } from "./fields";
import { FlowCanvas } from "./flow-canvas";
import {
  autoLayout,
  buildRefContext,
  connect,
  deleteNodes,
  deriveEdges,
  entityId,
  graphToState,
  hasOverlaps,
  mapIssues,
  newNodeData,
  phaseOrder,
  removeEdge,
  slugId,
  stateToGraph,
  type BranchLink,
  type BuilderTab,
  type MappedIssue,
  type SimNode,
} from "./graph-utils";
import { Inspector, InspectorEmpty } from "./inspector";
import type { BuilderCtx } from "./nodes";
import { ACTION_KIND } from "./theme";
import { sk, type BuilderGraph, type DraftOut, type GraphOut, type PublishOut, type SimDefinition, type SimulationOut, type ValidationOut } from "./types";
import { useUnsavedGuard } from "./use-unsaved-guard";

interface Snapshot {
  nodes: SimNode[];
  links: BranchLink[];
  initial: string;
}

const TABS: { id: BuilderTab; icon: typeof Workflow }[] = [
  { id: "flow", icon: Workflow },
  { id: "scenario", icon: ClipboardList },
  { id: "environment", icon: PanelsTopLeft },
  { id: "characters", icon: Users },
  { id: "variables", icon: Variable },
  { id: "scoring", icon: Scale },
  { id: "feedback", icon: MessageSquare },
  { id: "json", icon: Braces },
];

function simFormFrom(s: SimulationOut): SimSettingsForm {
  return {
    title: s.title,
    description: s.description ?? "",
    industry: s.industry,
    environment_type: s.environment_type,
    difficulty: s.difficulty,
    estimated_minutes: s.estimated_minutes,
    is_graded: s.is_graded,
    max_attempts: s.max_attempts ?? null,
  };
}

function BuilderSkeleton() {
  return (
    <div className="space-y-4" aria-busy aria-label="Loading builder">
      <Skeleton className="h-5 w-64" />
      <div className="flex items-center justify-between">
        <Skeleton className="h-9 w-80" />
        <Skeleton className="h-10 w-72 rounded-xl" />
      </div>
      <Skeleton className="h-10 w-full rounded-xl" />
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <Skeleton className="h-[640px] rounded-3xl" />
        <Skeleton className="hidden h-[640px] rounded-3xl xl:block" />
      </div>
    </div>
  );
}

type AddType = "phase" | "action" | "event";

function AddNodeDialog({
  type,
  onClose,
  onCreate,
  taken,
  tools,
}: {
  type: AddType | null;
  onClose: () => void;
  onCreate: (type: AddType, id: string, name: string, extra: Record<string, unknown>) => void;
  taken: Set<string>;
  tools: { id: string; name: string }[];
}) {
  const [name, setName] = React.useState("");
  const [id, setId] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const [tool, setTool] = React.useState("");
  const [kind, setKind] = React.useState("inspect");
  React.useEffect(() => {
    if (type) {
      setName("");
      setId("");
      setTouched(false);
      setTool(tools[0]?.id ?? "");
      setKind("inspect");
    }
  }, [type, tools]);
  if (!type) return null;
  const upper = type === "phase";
  const finalId = touched ? id : slugId(name, upper);
  const fullId = `${type}:${finalId}`;
  const clash = !!finalId && taken.has(fullId);
  const valid = !!finalId && /^[A-Za-z0-9_.-]+$/.test(finalId) && !clash && !!name.trim();
  const label = type === "phase" ? "Phase" : type === "action" ? "Action" : "Event";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New {label.toLowerCase()}</DialogTitle>
          <DialogDescription>
            {type === "phase" && "A stage of the scenario's state machine, e.g. Diagnosis."}
            {type === "action" && "Something the learner can do: ask, run a command, inspect, choose, submit or escalate."}
            {type === "event" && "Something that happens on a timer, when a condition holds, or after an action."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            onCreate(type, finalId, name.trim(), type === "action" ? { tool, kind } : {});
          }}
        >
          <FieldRow label={type === "action" ? "Label" : type === "event" ? "Title" : "Name"} htmlFor="new-node-name">
            <MiniInput id="new-node-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={type === "phase" ? "Diagnosis" : type === "action" ? "Check the DNS settings" : "Customer escalates"} className="h-10 text-sm" />
          </FieldRow>
          <FieldRow label="Id" htmlFor="new-node-id" hint="Referenced by conditions; can't be changed later." error={clash ? "That id is already used." : null}>
            <MiniInput
              id="new-node-id"
              mono
              value={finalId}
              aria-invalid={clash}
              onChange={(e) => {
                setTouched(true);
                setId(e.target.value.replace(/\s+/g, "_"));
              }}
              className="h-10"
            />
          </FieldRow>
          {type === "action" && (
            <div className="grid grid-cols-2 gap-3">
              <FieldRow label="Tool" htmlFor="new-node-tool">
                <MiniSelect id="new-node-tool" value={tool} onChange={setTool} options={tools.map((t) => ({ value: t.id, label: t.name }))} placeholder="Choose tool" className="[&_select]:h-10" />
              </FieldRow>
              <FieldRow label="Kind" htmlFor="new-node-kind">
                <MiniSelect id="new-node-kind" value={kind} onChange={setKind} options={Object.entries(ACTION_KIND).map(([k, m]) => ({ value: k, label: m.label }))} className="[&_select]:h-10" />
              </FieldRow>
            </div>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid}>
              Add {label.toLowerCase()}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function BuilderInner({ id }: { id: string }) {
  const qc = useQueryClient();
  const pathname = usePathname();
  const params = useSearchParams();
  const urlTab = (TABS.some((t) => t.id === params.get("tab")) ? params.get("tab") : "flow") as BuilderTab;
  // Local state for instant switching; the URL is kept in sync with a shallow history update.
  const [tab, setTabState] = React.useState<BuilderTab>(urlTab);
  React.useEffect(() => setTabState(urlTab), [urlTab]);
  const setTab = (t: BuilderTab) => {
    setTabState(t);
    window.history.replaceState(null, "", t === "flow" ? pathname : `${pathname}?tab=${t}`);
  };

  const simQ = useQuery({ queryKey: sk.detail(id), queryFn: ({ signal }) => api.get<SimulationOut>(`/simulations/${id}`, { signal }) });
  const graphQ = useQuery({ queryKey: sk.graph(id), queryFn: ({ signal }) => api.get<GraphOut>(`/simulations/${id}/graph`, { signal }), staleTime: Infinity, refetchOnWindowFocus: false });
  const draftQ = useQuery({ queryKey: sk.draft(id), queryFn: ({ signal }) => api.get<DraftOut>(`/simulations/${id}/draft`, { signal }), staleTime: Infinity, refetchOnWindowFocus: false });

  const [nodes, setNodes] = React.useState<SimNode[]>([]);
  const [links, setLinks] = React.useState<BranchLink[]>([]);
  const [initial, setInitial] = React.useState("");
  const [rev, setRev] = React.useState(0);
  const [graphDirty, setGraphDirty] = React.useState(false);
  const [def, setDef] = React.useState<SimDefinition | null>(null);
  const [defDirty, setDefDirty] = React.useState(false);
  const [simForm, setSimForm] = React.useState<SimSettingsForm | null>(null);
  const [simDirty, setSimDirty] = React.useState(false);
  const [validation, setValidation] = React.useState<ValidationOut | null>(null);
  const [stale, setStale] = React.useState(false);
  const [selectedEdge, setSelectedEdge] = React.useState<string | null>(null);
  const [focusNode, setFocusNode] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState<{ type: AddType; at: { x: number; y: number } } | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState<string[] | null>(null);
  const [problemsOpen, setProblemsOpen] = React.useState(false);
  const [versionsOpen, setVersionsOpen] = React.useState(false);
  const [publishOpen, setPublishOpen] = React.useState(false);
  const [discardOpen, setDiscardOpen] = React.useState(false);
  const [mobileInspector, setMobileInspector] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [validating, setValidating] = React.useState(false);
  const [savedAt, setSavedAt] = React.useState<Date | null>(null);
  const loaded = React.useRef({ graph: false, draft: false, sim: false });
  const history = React.useRef<{ past: Snapshot[]; future: Snapshot[]; lastKey: string; lastT: number }>({ past: [], future: [], lastKey: "", lastT: 0 });
  const [, forceHistory] = React.useState(0);

  const dirty = graphDirty || defDirty || simDirty;
  const guard = useUnsavedGuard(dirty);

  const loadGraph = React.useCallback((g: BuilderGraph, arrange = false) => {
    const st = graphToState(g);
    // Graphs that were never arranged (e.g. AI-built or seeded) come back with stacked default positions.
    const placed = arrange && hasOverlaps(st.nodes) ? autoLayout(st.nodes, st.links, st.initial) : st.nodes;
    setNodes((prev) => {
      const sel = new Set(prev.filter((n) => n.selected).map((n) => n.id));
      return placed.map((n) => (sel.has(n.id) ? { ...n, selected: true } : n));
    });
    setLinks(st.links);
    setInitial(st.initial);
    setRev((r) => r + 1);
    setGraphDirty(false);
  }, []);

  React.useEffect(() => {
    if (graphQ.data && !loaded.current.graph) {
      loaded.current.graph = true;
      loadGraph(graphQ.data.graph as unknown as BuilderGraph, true);
      setValidation(graphQ.data.validation);
    }
  }, [graphQ.data, loadGraph]);
  React.useEffect(() => {
    if (draftQ.data && !loaded.current.draft) {
      loaded.current.draft = true;
      setDef(draftQ.data.definition as unknown as SimDefinition);
      setValidation((v) => v ?? draftQ.data.validation);
    }
  }, [draftQ.data]);
  React.useEffect(() => {
    if (simQ.data && !loaded.current.sim) {
      loaded.current.sim = true;
      setSimForm(simFormFrom(simQ.data));
    }
  }, [simQ.data]);

  /* ---------------- history */
  const snapshot = React.useCallback((): Snapshot => ({ nodes, links, initial }), [nodes, links, initial]);
  const push = React.useCallback(
    (key = "") => {
      const h = history.current;
      const now = Date.now();
      if (key && key === h.lastKey && now - h.lastT < 900) {
        h.lastT = now;
        return;
      }
      h.past.push(snapshot());
      if (h.past.length > 100) h.past.shift();
      h.future = [];
      h.lastKey = key;
      h.lastT = now;
      forceHistory((x) => x + 1);
    },
    [snapshot],
  );
  const restore = (s: Snapshot) => {
    setNodes(s.nodes);
    setLinks(s.links);
    setInitial(s.initial);
    setRev((r) => r + 1);
    setGraphDirty(true);
    setStale(true);
  };
  const undo = () => {
    const h = history.current;
    const prev = h.past.pop();
    if (!prev) return;
    h.future.push(snapshot());
    h.lastKey = "";
    restore(prev);
    forceHistory((x) => x + 1);
  };
  const redo = () => {
    const h = history.current;
    const next = h.future.pop();
    if (!next) return;
    h.past.push(snapshot());
    h.lastKey = "";
    restore(next);
    forceHistory((x) => x + 1);
  };

  const touchGraph = () => {
    setGraphDirty(true);
    setStale(true);
    setRev((r) => r + 1);
  };

  /* ---------------- derived */
  // Edges depend on node data + links only (not positions): `rev` bumps on every data change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const edges = React.useMemo(() => deriveEdges(nodes, links), [rev, links]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ctx = React.useMemo(() => buildRefContext(def, nodes), [def, rev]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const issues = React.useMemo(() => mapIssues(validation, nodes, links), [validation, rev, links]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const order = React.useMemo(() => phaseOrder(nodes, initial), [rev, initial]);

  const builderCtx = React.useMemo<BuilderCtx>(() => {
    const byNode = new Map<string, { errors: number; warnings: number; messages: string[] }>();
    for (const i of issues) {
      if (!i.nodeId) continue;
      const cur = byNode.get(i.nodeId) ?? { errors: 0, warnings: 0, messages: [] };
      if (i.severity === "error") cur.errors++;
      else cur.warnings++;
      cur.messages.push(i.message);
      byNode.set(i.nodeId, cur);
    }
    const dims = def?.scoring?.dimensions ?? [];
    return {
      initial,
      issues: byNode,
      dimIndex: new Map(dims.map((d, i) => [d.id, i])),
      dimName: new Map(dims.map((d) => [d.id, d.name])),
      phaseIndex: new Map(order.map((p, i) => [p, i])),
      toolName: new Map((def?.tools ?? []).map((t) => [t.id, t.name])),
      characterName: new Map((def?.characters ?? []).map((c) => [c.id, c.name])),
    };
  }, [issues, def, initial, order]);

  const selectedNode = nodes.find((n) => n.selected) ?? null;
  const counts = React.useMemo(() => {
    const c: Record<string, number> = { phase: 0, action: 0, branch: 0, event: 0 };
    nodes.forEach((n) => (c[n.type ?? "action"] = (c[n.type ?? "action"] ?? 0) + 1));
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rev]);
  const tabIssues = (t: BuilderTab) => issues.filter((i) => i.tab === t);

  /* ---------------- graph operations */
  const selectNode = (nodeId: string | null, focus = true) => {
    setNodes((ns) => ns.map((n) => (n.selected === (n.id === nodeId) ? n : { ...n, selected: n.id === nodeId })));
    setSelectedEdge(null);
    if (nodeId && focus) setFocusNode(`${nodeId}#${Date.now()}`);
  };

  const onNodesChange = (changes: NodeChange<SimNode>[]) => {
    const relevant = changes.filter((c) => c.type !== "remove");
    setNodes((ns) => applyNodeChanges(relevant, ns));
    if (relevant.some((c) => c.type === "position" && c.dragging === false)) {
      setGraphDirty(true);
    }
    if (relevant.some((c) => c.type === "select" && c.selected)) setSelectedEdge(null);
  };

  const onData = (nodeId: string, data: Record<string, unknown>) => {
    push(`data:${nodeId}`);
    setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data } : n)));
    touchGraph();
  };

  const onConnect = (c: Connection) => {
    const r = connect(nodes, links, c.source, c.target);
    if ("error" in r) return toast.error(r.error);
    push();
    setNodes(r.nodes);
    setLinks(r.links);
    touchGraph();
    toast.success(r.message);
  };

  const requestDelete = () => {
    if (selectedEdge) {
      const e = edges.find((x) => x.id === selectedEdge);
      if (!e) return;
      const next = removeEdge(nodes, e);
      if (!next) return toast.info("This connection comes from another setting — edit it in the inspector (e.g. a branch or a trigger_event effect).");
      push();
      setNodes(next);
      setSelectedEdge(null);
      touchGraph();
      toast.success("Connection removed");
      return;
    }
    const ids = nodes.filter((n) => n.selected).map((n) => n.id);
    if (ids.length) setConfirmDelete(ids);
  };

  const doDelete = (ids: string[]) => {
    push();
    const r = deleteNodes(nodes, links, ids, initial);
    setNodes(r.nodes);
    setLinks(r.links);
    setInitial(r.initial);
    touchGraph();
    toast.success(ids.length === 1 ? "Deleted" : `Deleted ${ids.length} nodes`);
  };

  const addNode = (type: AddType, eid: string, name: string, extra: Record<string, unknown>) => {
    const at = adding?.at ?? { x: 0, y: 0 };
    const nodeId = `${type}:${eid}`;
    const data = newNodeData(type, eid, type === "phase" ? { name } : type === "action" ? { label: name, ...extra } : { title: name });
    push();
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), { id: nodeId, type, position: at, data, selected: true }]);
    if (type === "phase" && !initial) setInitial(eid);
    touchGraph();
    setAdding(null);
    setFocusNode(`${nodeId}#${Date.now()}`);
    toast.success(`${type === "phase" ? "Phase" : type === "action" ? "Action" : "Event"} added — connect it on the canvas`);
  };

  const addBranch = (actionNodeId: string) => {
    const a = nodes.find((n) => n.id === actionNodeId);
    if (!a) return;
    const aid = entityId(a);
    const mine = links.filter((l) => l.source === actionNodeId);
    let k = mine.length;
    let bid = `branch:${aid}:${k}`;
    while (nodes.some((n) => n.id === bid)) bid = `branch:${aid}:${++k}`;
    push();
    setNodes((ns) => [
      ...ns.map((n) => ({ ...n, selected: false })),
      { id: bid, type: "branch", position: { x: a.position.x + 300, y: a.position.y + mine.length * 90 }, data: newNodeData("branch", `b${mine.length + 1}`), selected: true },
    ]);
    setLinks((ls) => [...ls, { id: `b:${aid}:${bid}`, source: actionNodeId, target: bid, order: mine.length }]);
    touchGraph();
    setFocusNode(`${bid}#${Date.now()}`);
  };

  const reorderBranch = (branchNodeId: string, dir: -1 | 1) => {
    const l = links.find((x) => x.target === branchNodeId);
    if (!l) return;
    const sibs = links.filter((x) => x.source === l.source).sort((a, b) => a.order - b.order);
    const i = sibs.findIndex((x) => x.target === branchNodeId);
    const j = i + dir;
    if (j < 0 || j >= sibs.length) return;
    push();
    const swapped = new Map([
      [sibs[i]!.target, sibs[j]!.order],
      [sibs[j]!.target, sibs[i]!.order],
    ]);
    setLinks((ls) => ls.map((x) => (swapped.has(x.target) && x.source === l.source ? { ...x, order: swapped.get(x.target)! } : x)));
    touchGraph();
  };

  const moveBranch = (branchNodeId: string, actionNodeId: string) => {
    const r = connect(nodes, links, actionNodeId, branchNodeId);
    if ("error" in r) return toast.error(r.error);
    push();
    setLinks(r.links);
    touchGraph();
  };

  const layout = () => {
    push();
    setNodes((ns) => autoLayout(ns, links, initial));
    setGraphDirty(true);
  };

  /* ---------------- definition edits */
  const onDef = (d: SimDefinition) => {
    setDef(d);
    setDefDirty(true);
    setStale(true);
  };
  const onSim = (s: SimSettingsForm) => {
    setSimForm(s);
    setSimDirty(true);
  };

  /* ---------------- persistence */
  const reloadFromServer = async () => {
    const [g, d, s] = await Promise.all([
      api.get<GraphOut>(`/simulations/${id}/graph`),
      api.get<DraftOut>(`/simulations/${id}/draft`),
      api.get<SimulationOut>(`/simulations/${id}`),
    ]);
    loadGraph(g.graph as unknown as BuilderGraph);
    setDef(d.definition as unknown as SimDefinition);
    setSimForm(simFormFrom(s));
    setValidation(d.validation);
    setDefDirty(false);
    setSimDirty(false);
    setStale(false);
    qc.setQueryData(sk.graph(id), g);
    qc.setQueryData(sk.draft(id), d);
    qc.setQueryData(sk.detail(id), s);
    history.current = { past: [], future: [], lastKey: "", lastT: 0 };
    forceHistory((x) => x + 1);
  };

  const save = async (): Promise<ValidationOut | null> => {
    if (saving) return null;
    setSaving(true);
    let v: ValidationOut | null = null;
    try {
      if (simDirty && simForm) {
        const s = await api.patch<SimulationOut>(`/simulations/${id}`, { ...simForm, max_attempts: simForm.max_attempts });
        qc.setQueryData(sk.detail(id), s);
        setSimDirty(false);
      }
      if (defDirty && def) {
        const r = await api.put<DraftOut>(`/simulations/${id}/draft`, { definition: def });
        v = r.validation;
        setDefDirty(false);
        if (!graphDirty) setDef(r.definition as unknown as SimDefinition);
      }
      if (graphDirty) {
        const g = await api.put<GraphOut>(`/simulations/${id}/graph`, { graph: stateToGraph(nodes, edges, initial) });
        loadGraph(g.graph as unknown as BuilderGraph);
        v = g.validation;
        const d = await api.get<DraftOut>(`/simulations/${id}/draft`);
        setDef(d.definition as unknown as SimDefinition);
        qc.setQueryData(sk.draft(id), d);
      }
      if (!v) v = await api.post<ValidationOut>(`/simulations/${id}/validate`);
      setValidation(v);
      setStale(false);
      setSavedAt(new Date());
      qc.invalidateQueries({ queryKey: ["simulations", "list"] });
      toast.success(v.valid ? "Saved — the draft is valid" : `Saved with ${v.errors.length} validation error${v.errors.length === 1 ? "" : "s"}`);
      return v;
    } catch (e) {
      if (e instanceof ApiError && e.code === "invalid_definition") {
        const d = e.details as ValidationOut | undefined;
        if (d?.errors) {
          setValidation({ valid: false, errors: d.errors, warnings: d.warnings ?? [], stats: d.stats ?? {} });
          setProblemsOpen(true);
        }
        toast.error("Not saved: the definition has structural errors");
      } else toast.error(`Not saved: ${errorMessage(e)}`);
      return null;
    } finally {
      setSaving(false);
    }
  };

  const validate = async () => {
    if (dirty) {
      const v = await save();
      if (v) setProblemsOpen(true);
      return;
    }
    setValidating(true);
    try {
      const v = await api.post<ValidationOut>(`/simulations/${id}/validate`);
      setValidation(v);
      setStale(false);
      setProblemsOpen(true);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setValidating(false);
    }
  };

  const publish = async () => {
    if (dirty) {
      const v = await save();
      if (!v) return;
    }
    try {
      const r = await api.post<PublishOut>(`/simulations/${id}/publish`);
      qc.setQueryData(sk.detail(id), r.simulation);
      setValidation(r.validation);
      qc.invalidateQueries({ queryKey: sk.versions(id) });
      qc.invalidateQueries({ queryKey: ["simulations", "list"] });
      toast.success(`Published version ${r.published.version} — a new draft is open for further edits`);
    } catch (e) {
      if (e instanceof ApiError && e.code === "validation_failed") {
        const d = e.details as ValidationOut | undefined;
        if (d) setValidation({ valid: false, errors: d.errors ?? [], warnings: d.warnings ?? [], stats: d.stats ?? {} });
        setProblemsOpen(true);
        toast.error("Fix the validation errors before publishing");
      } else toast.error(errorMessage(e));
    }
  };

  const goToIssue = (i: MappedIssue) => {
    setProblemsOpen(false);
    if (i.nodeId) {
      setTab("flow");
      setTimeout(() => {
        selectNode(i.nodeId!);
        setMobileInspector(true);
      }, 60);
    } else setTab(i.tab);
  };

  /* ---------------- keyboard shortcuts */
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (dirty) void save();
        return;
      }
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable=true]")) return;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /* ---------------- render */
  if (simQ.isError || graphQ.isError || draftQ.isError) {
    const err = simQ.error ?? graphQ.error ?? draftQ.error;
    return (
      <div className="space-y-4">
        <Breadcrumbs linkComponent={Link} items={[{ label: "Simulation builder", href: "/app/instructor/simulations" }, { label: "Simulation" }]} />
        <ErrorState error={err} onRetry={() => { simQ.refetch(); graphQ.refetch(); draftQ.refetch(); }} size="lg" title={err instanceof ApiError && err.status === 422 ? "This draft can't be opened in the graph builder" : undefined} />
        {err instanceof ApiError && err.status === 422 && (
          <div className="text-center">
            <Button variant="secondary" onClick={() => setTab("json")}>
              Open the JSON editor
            </Button>
          </div>
        )}
      </div>
    );
  }
  if (!simQ.data || !def || !simForm || !loaded.current.graph) return <BuilderSkeleton />;

  const sim = simQ.data;
  const published = sim.published_version;
  const jsonBlocked = graphDirty ? "You have unsaved flow changes. Save them first so the JSON reflects the latest graph." : simDirty ? "Save your scenario settings first." : null;
  const errorsFor = (t: BuilderTab) => tabIssues(t).filter((i) => i.severity === "error").length;

  return (
    <div className="space-y-4">
      {guard.dialog}
      <Breadcrumbs linkComponent={Link} items={[{ label: "Simulation builder", href: "/app/instructor/simulations" }, { label: sim.title }]} />

      <header className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-brand-gradient text-white shadow-glow">
            <Workflow className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h1 className="truncate font-display text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">{simForm.title || sim.title}</h1>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
              <StatusPill status={sim.status} size="sm" />
              {sim.draft_version && <Badge tone="info" size="sm">Draft v{sim.draft_version}</Badge>}
              {published ? <Badge tone="success" size="sm">Live v{published}</Badge> : <Badge tone="neutral" size="sm">Never published</Badge>}
              {sim.ai_generated && (
                <Badge tone="gradient" size="sm">
                  <Sparkles aria-hidden /> AI draft
                </Badge>
              )}
              <ValidationPill validation={validation} stale={stale} onClick={() => setProblemsOpen(true)} />
              <span aria-live="polite" className="ml-1">
                {saving ? (
                  <span className="inline-flex items-center gap-1 text-brand-700">
                    <Loader2 className="size-3 animate-spin" aria-hidden /> Saving…
                  </span>
                ) : dirty ? (
                  <span className="font-semibold text-amber-700">● Unsaved changes</span>
                ) : savedAt ? (
                  <span className="inline-flex items-center gap-1 text-emerald-700">
                    <CheckCircle2 className="size-3" aria-hidden /> Saved {formatRelative(savedAt)}
                  </span>
                ) : null}
              </span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {dirty && (
            <Button variant="ghost" size="sm" leftIcon={<RotateCcw />} onClick={() => setDiscardOpen(true)}>
              Discard
            </Button>
          )}
          <Button variant="secondary" size="sm" leftIcon={<ShieldCheck />} onClick={validate} loading={validating}>
            Validate
          </Button>
          <Button variant="secondary" size="sm" leftIcon={<History />} onClick={() => setVersionsOpen(true)}>
            Versions
          </Button>
          <Button variant="ghost" size="sm" leftIcon={<BarChart3 />} asChild>
            <Link href={`/app/instructor/simulations/${id}/analytics`}>Analytics</Link>
          </Button>
          {published ? (
            <Button variant="secondary" size="sm" leftIcon={<Play />} asChild>
              <a href={`/app/simulations/${id}`} target="_blank" rel="noopener noreferrer" title={`Opens the learner player on published v${published} in a new tab`}>
                Play test
              </a>
            </Button>
          ) : (
            <Tooltip content="Play testing runs the latest published version — publish first.">
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<Play />}
                aria-disabled
                className="opacity-60"
                onClick={() => toast.info("Publish the simulation first — play testing runs the latest published version in the learner player.")}
              >
                Play test
              </Button>
            </Tooltip>
          )}
          <Button size="sm" leftIcon={<Save />} onClick={() => void save()} loading={saving} disabled={!dirty}>
            Save
          </Button>
          <Button variant="gradient" size="sm" leftIcon={<Rocket />} onClick={() => setPublishOpen(true)}>
            Publish
          </Button>
        </div>
      </header>

      {sim.ai_generated && sim.status === "draft" && (
        <Alert tone="brand" icon={<Sparkles aria-hidden />} title="AI-generated draft — needs review">
          Check every action&apos;s consequences, scores and feedback before publishing. The engine (not the AI) decides outcomes at runtime.
        </Alert>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as BuilderTab)}>
        <TabsList variant="underline" aria-label="Builder sections">
          {TABS.map((t) => {
            const n = t.id === "flow" ? issues.filter((i) => i.tab === "flow" && i.severity === "error").length : errorsFor(t.id);
            return (
              <TabsTrigger key={t.id} value={t.id}>
                <t.icon aria-hidden />
                {TAB_LABEL[t.id]}
                {n > 0 && <span className="rounded-full bg-rose-600 px-1.5 text-2xs font-bold text-white">{n}</span>}
                {t.id === "flow" && graphDirty && <span className="size-1.5 rounded-full bg-amber-500" aria-label="unsaved" />}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>

      {tab === "flow" && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="relative h-[calc(100dvh-17rem)] min-h-[560px] overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-soft">
            <FlowCanvas
              nodes={nodes}
              edges={edges}
              ctx={builderCtx}
              selectedEdgeId={selectedEdge}
              onNodesChange={onNodesChange}
              onSelectEdge={setSelectedEdge}
              onConnect={onConnect}
              onDeleteSelection={requestDelete}
              onAdd={(type, at) => setAdding({ type, at })}
              onAutoLayout={layout}
              onUndo={undo}
              onRedo={redo}
              canUndo={history.current.past.length > 0}
              canRedo={history.current.future.length > 0}
              onDragStart={() => push()}
              focusKey={focusNode}
            />
            {selectedNode && (
              <div className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 xl:hidden">
                <Button variant="primary" size="sm" leftIcon={<PanelRightOpen />} onClick={() => setMobileInspector(true)} className="shadow-lift">
                  Edit {selectedNode.type}
                </Button>
              </div>
            )}
          </div>
          <aside className="hidden h-[calc(100dvh-17rem)] min-h-[560px] overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-soft xl:block" aria-label="Inspector">
            {selectedNode ? (
              <Inspector
                node={selectedNode}
                nodes={nodes}
                links={links}
                ctx={ctx}
                initial={initial}
                issues={issues.filter((i) => i.nodeId === selectedNode.id)}
                onData={onData}
                onDelete={(nid) => setConfirmDelete([nid])}
                onSelect={(nid) => selectNode(nid)}
                onSetInitial={(p) => {
                  push();
                  setInitial(p);
                  touchGraph();
                }}
                onAddBranch={addBranch}
                onReorderBranch={reorderBranch}
                onMoveBranch={moveBranch}
              />
            ) : (
              <InspectorEmpty counts={counts} onAdd={(t) => setAdding({ type: t, at: { x: 0, y: 360 } })} />
            )}
          </aside>
          <Sheet open={mobileInspector && !!selectedNode} onOpenChange={setMobileInspector}>
            <SheetContent side="right" className="w-[96%] max-w-md p-0 xl:hidden">
              <SheetTitle className="sr-only">Inspector</SheetTitle>
              {selectedNode && (
                <Inspector
                  node={selectedNode}
                  nodes={nodes}
                  links={links}
                  ctx={ctx}
                  initial={initial}
                  issues={issues.filter((i) => i.nodeId === selectedNode.id)}
                  onData={onData}
                  onDelete={(nid) => setConfirmDelete([nid])}
                  onSelect={(nid) => selectNode(nid)}
                  onSetInitial={(p) => {
                    push();
                    setInitial(p);
                    touchGraph();
                  }}
                  onAddBranch={addBranch}
                  onReorderBranch={reorderBranch}
                  onMoveBranch={moveBranch}
                />
              )}
            </SheetContent>
          </Sheet>
        </div>
      )}
      {tab === "scenario" && <ScenarioTab def={def} onChange={onDef} ctx={ctx} issues={tabIssues("scenario")} sim={simForm} onSim={onSim} />}
      {tab === "environment" && <EnvironmentTab def={def} onChange={onDef} ctx={ctx} issues={tabIssues("environment")} />}
      {tab === "characters" && <CharactersTab def={def} onChange={onDef} ctx={ctx} issues={tabIssues("characters")} />}
      {tab === "variables" && <VariablesTab def={def} onChange={onDef} ctx={ctx} issues={tabIssues("variables")} />}
      {tab === "scoring" && <ScoringTab def={def} onChange={onDef} ctx={ctx} issues={tabIssues("scoring")} />}
      {tab === "feedback" && <FeedbackTab def={def} onChange={onDef} ctx={ctx} issues={tabIssues("feedback")} />}
      {tab === "json" && (
        <JsonTab
          simId={id}
          definition={def}
          blocked={jsonBlocked}
          onValidation={(v) => {
            setValidation(v);
            setStale(false);
          }}
          onSaved={() => void reloadFromServer()}
        />
      )}

      <AddNodeDialog type={adding?.type ?? null} onClose={() => setAdding(null)} onCreate={addNode} taken={new Set(nodes.map((n) => n.id))} tools={ctx.tools} />
      <ConfirmDialog
        open={!!confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
        destructive
        title={confirmDelete && confirmDelete.length > 1 ? `Delete ${confirmDelete.length} nodes?` : "Delete this node?"}
        description="Actions delete their branches too. References elsewhere (conditions, events) will show as validation errors. You can undo with Ctrl+Z before saving."
        confirmLabel="Delete"
        onConfirm={() => {
          if (confirmDelete) doDelete(confirmDelete);
          setConfirmDelete(null);
        }}
      />
      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        destructive
        title="Discard unsaved changes?"
        description="Reloads the last saved draft. This can't be undone."
        confirmLabel="Discard"
        onConfirm={async () => {
          await reloadFromServer();
          toast.success("Changes discarded");
        }}
      />
      <ConfirmDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        title={`Publish version ${sim.draft_version ?? ""}?`}
        description={
          <>
            {dirty && "Your unsaved changes are saved first. "}
            Publishing freezes this draft as an immutable version for learners
            {published ? ` (replacing v${published} for new sessions)` : ""}. Running sessions stay on their version. A new draft opens for further edits.
            {validation && !validation.valid && <span className="mt-2 block font-semibold text-rose-700">The last validation found {validation.errors.length} error(s) — publishing will be refused until they are fixed.</span>}
          </>
        }
        confirmLabel="Publish"
        onConfirm={publish}
      />
      <ProblemsSheet open={problemsOpen} onOpenChange={setProblemsOpen} issues={issues} stats={validation?.stats} onGo={goToIssue} />
      <VersionsSheet open={versionsOpen} onOpenChange={setVersionsOpen} simId={id} />
    </div>
  );
}

export function SimulationBuilder({ id }: { id: string }) {
  return (
    <ReactFlowProvider>
      <BuilderInner id={id} />
    </ReactFlowProvider>
  );
}
