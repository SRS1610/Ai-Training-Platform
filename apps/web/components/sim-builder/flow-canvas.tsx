"use client";

import "@xyflow/react/dist/style.css";
import { Button, Tooltip, cn } from "@praxis/ui";
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from "@xyflow/react";
import { Flag, LayoutGrid, Map as MapIcon, Maximize2, MousePointerClick, Redo2, Undo2, Zap } from "lucide-react";
import * as React from "react";
import { canConnect, type SimEdge, type SimNode } from "./graph-utils";
import { BuilderContext, edgeTypes, nodeTypes, type BuilderCtx } from "./nodes";
import { EDGE_STYLE, NODE_MINIMAP } from "./theme";

const FOCUS_CLASSES = String.raw`[&_.react-flow\_\_node:focus-visible]:rounded-2xl [&_.react-flow\_\_node:focus-visible]:!outline [&_.react-flow\_\_node:focus-visible]:!outline-[3px] [&_.react-flow\_\_node:focus-visible]:!outline-offset-4 [&_.react-flow\_\_node:focus-visible]:!outline-brand-500 [&_.react-flow\_\_edge:focus-visible_.react-flow\_\_edge-path]:!stroke-[4px]`;

export interface FlowCanvasProps {
  nodes: SimNode[];
  edges: SimEdge[];
  ctx: BuilderCtx;
  selectedEdgeId: string | null;
  onNodesChange: (changes: NodeChange<SimNode>[]) => void;
  onSelectEdge: (id: string | null) => void;
  onConnect: (c: Connection) => void;
  onDeleteSelection: () => void;
  onAdd: (type: "phase" | "action" | "event", at: { x: number; y: number }) => void;
  onAutoLayout: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onDragStart: () => void;
  /** `nodeId#nonce` — changes whenever the canvas should centre on a node. */
  focusKey: string | null;
}

function Legend() {
  const rows: [string, string, string | undefined][] = [
    [EDGE_STYLE.transition.label, EDGE_STYLE.transition.color, undefined],
    [EDGE_STYLE.auto.label, EDGE_STYLE.auto.color, "7 5"],
    [EDGE_STYLE.contains.label, EDGE_STYLE.contains.color, "3 5"],
    [EDGE_STYLE.branch.label, EDGE_STYLE.branch.color, undefined],
    [EDGE_STYLE.effect_transition.label, EDGE_STYLE.effect_transition.color, "6 4"],
    [EDGE_STYLE.triggers.label, EDGE_STYLE.triggers.color, "6 4"],
  ];
  return (
    <div className="rounded-xl border border-slate-200 bg-white/95 p-2.5 text-2xs shadow-lift backdrop-blur">
      <p className="mb-1.5 font-bold uppercase tracking-wider text-slate-500">Connections</p>
      <ul className="space-y-1">
        {rows.map(([label, color, dash]) => (
          <li key={label} className="flex items-center gap-2 font-medium text-slate-700">
            <svg width="28" height="6" aria-hidden>
              <line x1="0" y1="3" x2="28" y2="3" stroke={color} strokeWidth="2.5" strokeDasharray={dash} />
            </svg>
            {label}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function FlowCanvas(props: FlowCanvasProps) {
  const { nodes, edges, ctx, selectedEdgeId, onNodesChange, onSelectEdge, onConnect, onDeleteSelection, onAdd, onAutoLayout, onUndo, onRedo, canUndo, canRedo, onDragStart, focusKey } = props;
  const rf = useReactFlow<SimNode, SimEdge>();
  const wrapper = React.useRef<HTMLDivElement>(null);
  const [legend, setLegend] = React.useState(false);
  // The canvas mounts after data loads (client-only), so reading the viewport here is hydration-safe.
  const [minimap, setMinimap] = React.useState(() => typeof window === "undefined" || window.matchMedia("(min-width: 768px)").matches);

  React.useEffect(() => {
    if (!focusKey) return;
    const n = rf.getNode(focusKey.split("#")[0]!);
    if (n) rf.setCenter(n.position.x + 120, n.position.y + 50, { zoom: Math.max(rf.getZoom(), 0.9), duration: 400 });
  }, [focusKey, rf]);

  const styled = React.useMemo(
    () =>
      edges.map((e) => {
        const kind = e.data?.kind ?? "transition";
        const style = kind === "transition" && e.data?.auto ? EDGE_STYLE.auto : EDGE_STYLE[kind];
        return {
          ...e,
          selected: e.id === selectedEdgeId,
          animated: !!e.data?.auto,
          zIndex: kind === "contains" ? 0 : 1,
          markerEnd: kind === "contains" ? undefined : { type: MarkerType.ArrowClosed, color: style.color, width: 16, height: 16 },
          ariaLabel: `${style.label} from ${e.source} to ${e.target}`,
        };
      }),
    [edges, selectedEdgeId],
  );

  const center = () => {
    const r = wrapper.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  };

  const deleteRef = React.useRef(onDeleteSelection);
  deleteRef.current = onDeleteSelection;
  React.useEffect(() => {
    const el = wrapper.current;
    if (!el) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable=true]")) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteRef.current();
      }
    };
    el.addEventListener("keydown", onKeyDown);
    return () => el.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div ref={wrapper} className="relative h-full w-full" role="application" aria-label="Simulation flow canvas. Use Tab to move between nodes, Enter to select, arrow keys to move a selected node, Delete to remove.">
      <BuilderContext.Provider value={ctx}>
        <ReactFlow<SimNode, SimEdge>
          nodes={nodes}
          edges={styled}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={(changes: EdgeChange<SimEdge>[]) => {
            for (const c of changes) if (c.type === "select") onSelectEdge(c.selected ? c.id : null);
          }}
          onConnect={onConnect}
          isValidConnection={(c) => !canConnect(nodes.find((n) => n.id === c.source), nodes.find((n) => n.id === c.target))}
          onNodeDragStart={onDragStart}
          onPaneClick={() => onSelectEdge(null)}
          deleteKeyCode={null}
          fitView
          fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
          onInit={(inst) => {
            // Large scenarios fit at an unreadable zoom (5–7px text): open at a readable zoom with the start
            // phase near the top-left instead (the mini map and "Fit to screen" still give the overview).
            requestAnimationFrame(() => {
              if (inst.getZoom() >= 0.75 || !inst.getNodes().length) return;
              const ns = inst.getNodes();
              const start = ns.find((n) => n.id === `phase:${ctx.initial}`) ?? ns.find((n) => n.type === "phase") ?? ns[0]!;
              const box = wrapper.current?.getBoundingClientRect();
              const w = box?.width ?? 1000;
              const zoom = w < 640 ? 0.8 : 0.9;
              // Leave room for the toolbar (top) and anything stacked above the phase row (events).
              const above = Math.max(0, start.position.y - Math.min(...ns.map((n) => n.position.y)));
              const top = Math.min(84 + above * zoom, (box?.height ?? 600) * 0.3);
              inst.setViewport({ x: (w < 640 ? 24 : 56) - start.position.x * zoom, y: top - start.position.y * zoom, zoom });
            });
          }}
          minZoom={0.15}
          maxZoom={1.75}
          proOptions={{ hideAttribution: true }}
          defaultEdgeOptions={{ type: "sim" }}
          connectionLineStyle={{ stroke: "#6366f1", strokeWidth: 2, strokeDasharray: "6 4" }}
          snapToGrid
          snapGrid={[8, 8]}
          className={cn(
            "bg-[radial-gradient(circle_at_20%_0%,rgba(99,102,241,0.06),transparent_40%),radial-gradient(circle_at_90%_90%,rgba(217,70,239,0.05),transparent_40%)]",
            // WCAG 2.4.7: keyboard focus on a node (Tab) or an edge is always visible. (String.raw keeps the
            // escaped underscores, which Tailwind would otherwise read as spaces.)
            FOCUS_CLASSES,
          )}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.4} color="#cbd5e1" />
          <Controls showInteractive={false} position="bottom-left" className="!rounded-xl !border !border-slate-200 !shadow-lift [&>button]:!border-slate-100" />
          {minimap && (
            <MiniMap<SimNode>
              position="bottom-right"
              pannable
              zoomable
              ariaLabel="Mini map"
              nodeColor={(n) => NODE_MINIMAP[n.type ?? "action"] ?? "#94a3b8"}
              nodeStrokeWidth={2}
              nodeBorderRadius={6}
              maskColor="rgba(241,245,249,0.7)"
              className="!rounded-xl !border !border-slate-200 !shadow-lift"
            />
          )}
          <Panel position="top-left" className="!m-3">
            <div className="flex items-center gap-1 rounded-2xl border border-slate-200 bg-white/95 p-1 shadow-lift backdrop-blur">
              <Tooltip content="Add a phase">
                <Button size="sm" variant="ghost" leftIcon={<Flag className="text-indigo-600" />} onClick={() => onAdd("phase", center())}>
                  <span className="hidden sm:inline">Phase</span>
                </Button>
              </Tooltip>
              <Tooltip content="Add an action">
                <Button size="sm" variant="ghost" leftIcon={<MousePointerClick className="text-sky-600" />} onClick={() => onAdd("action", center())}>
                  <span className="hidden sm:inline">Action</span>
                </Button>
              </Tooltip>
              <Tooltip content="Add an event">
                <Button size="sm" variant="ghost" leftIcon={<Zap className="text-amber-600" />} onClick={() => onAdd("event", center())}>
                  <span className="hidden sm:inline">Event</span>
                </Button>
              </Tooltip>
              <span className="mx-1 h-6 w-px bg-slate-200" aria-hidden />
              <Tooltip content="Undo (Ctrl+Z)">
                <Button size="icon-sm" variant="ghost" aria-label="Undo" onClick={onUndo} disabled={!canUndo}>
                  <Undo2 />
                </Button>
              </Tooltip>
              <Tooltip content="Redo (Ctrl+Shift+Z)">
                <Button size="icon-sm" variant="ghost" aria-label="Redo" onClick={onRedo} disabled={!canRedo}>
                  <Redo2 />
                </Button>
              </Tooltip>
              <span className="mx-1 h-6 w-px bg-slate-200" aria-hidden />
              <Tooltip content="Auto-layout">
                <Button size="icon-sm" variant="ghost" aria-label="Auto-layout" onClick={() => {
                  onAutoLayout();
                  setTimeout(() => rf.fitView({ padding: 0.15, duration: 400 }), 50);
                }}>
                  <LayoutGrid />
                </Button>
              </Tooltip>
              <Tooltip content="Fit to screen">
                <Button size="icon-sm" variant="ghost" aria-label="Fit to screen" onClick={() => rf.fitView({ padding: 0.15, duration: 400 })}>
                  <Maximize2 />
                </Button>
              </Tooltip>
              <Tooltip content={minimap ? "Hide mini map" : "Show mini map"}>
                <Button size="icon-sm" variant="ghost" aria-label="Toggle mini map" aria-pressed={minimap} onClick={() => setMinimap((m) => !m)} className={cn(minimap && "bg-slate-100")}>
                  <MapIcon />
                </Button>
              </Tooltip>
              <Button size="xs" variant="ghost" aria-pressed={legend} onClick={() => setLegend((l) => !l)} className={cn("hidden md:inline-flex", legend && "bg-slate-100")}>
                Legend
              </Button>
            </div>
          </Panel>
          {legend && (
            <Panel position="top-right" className="!m-3 hidden md:block">
              <Legend />
            </Panel>
          )}
        </ReactFlow>
      </BuilderContext.Provider>
    </div>
  );
}
