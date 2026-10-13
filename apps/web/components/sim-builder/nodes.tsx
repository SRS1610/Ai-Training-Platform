"use client";

import { cn, colorClasses } from "@praxis/ui";
import {
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  Position,
  getBezierPath,
  getSmoothStepPath,
  type EdgeProps,
  type NodeProps,
} from "@xyflow/react";
import { AlertCircle, AlertTriangle, Clock, Flag, GitBranch, Globe2, Hourglass, Play, Repeat, Square, Timer, Zap } from "lucide-react";
import * as React from "react";
import type { SimEdge, SimNode } from "./graph-utils";
import { summarizeCondition, transitionsOf, truncate } from "./graph-utils";
import { ACTION_KIND, CLASS_STYLE, EDGE_STYLE, dimColor, phaseColor } from "./theme";
import type { SimAction, SimBranch, SimEvent, SimPhase } from "./types";

export interface BuilderCtx {
  initial: string;
  issues: Map<string, { errors: number; warnings: number; messages: string[] }>;
  dimIndex: Map<string, number>;
  dimName: Map<string, string>;
  phaseIndex: Map<string, number>;
  toolName: Map<string, string>;
  characterName: Map<string, string>;
}

export const BuilderContext = React.createContext<BuilderCtx>({
  initial: "",
  issues: new Map(),
  dimIndex: new Map(),
  dimName: new Map(),
  phaseIndex: new Map(),
  toolName: new Map(),
  characterName: new Map(),
});

const initials = (s: string) =>
  s
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .join("")
    .slice(0, 3);

function ScoreChips({ score, max = 3 }: { score: Record<string, number> | null | undefined; max?: number }) {
  const ctx = React.useContext(BuilderContext);
  const entries = Object.entries(score ?? {}).filter(([, v]) => v);
  if (!entries.length) return null;
  return (
    <>
      {entries.slice(0, max).map(([k, v]) => {
        const c = dimColor(ctx.dimIndex.get(k) ?? 0);
        const name = ctx.dimName.get(k) ?? k;
        return (
          <span key={k} title={`${name}: ${v > 0 ? "+" : ""}${v}`} className={cn("inline-flex items-center gap-0.5 rounded-md px-1.5 py-px text-2xs font-bold tabular-nums ring-1 ring-inset", c.chip)}>
            {v > 0 ? "+" : ""}
            {v}
            <span className="font-semibold opacity-80">{initials(name)}</span>
          </span>
        );
      })}
      {entries.length > max && <span className="text-2xs font-semibold text-slate-500">+{entries.length - max}</span>}
    </>
  );
}

function IssueBadge({ id }: { id: string }) {
  const ctx = React.useContext(BuilderContext);
  const i = ctx.issues.get(id);
  if (!i || (!i.errors && !i.warnings)) return null;
  const err = i.errors > 0;
  return (
    <span
      className={cn("absolute -right-2 -top-2 z-10 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-2xs font-bold text-white shadow-md", err ? "bg-rose-600" : "bg-amber-500")}
      title={i.messages.join("\n")}
    >
      {err ? <AlertCircle className="size-3" aria-hidden /> : <AlertTriangle className="size-3" aria-hidden />}
      {err ? i.errors : i.warnings}
      <span className="sr-only">{err ? "errors" : "warnings"}</span>
    </span>
  );
}

function issueRing(ctx: BuilderCtx, id: string) {
  const i = ctx.issues.get(id);
  if (i?.errors) return "ring-2 ring-rose-400";
  if (i?.warnings) return "ring-2 ring-amber-300";
  return "";
}

const handleCls = "!size-3 !border-2 !border-white !shadow";

/* ------------------------------------------------------------------ phase */

export const PhaseNode = React.memo(function PhaseNode({ id, data, selected }: NodeProps<SimNode>) {
  const ctx = React.useContext(BuilderContext);
  const d = data as unknown as SimPhase;
  const color = phaseColor(ctx.phaseIndex.get(d.id) ?? 0);
  const c = colorClasses(color);
  const isStart = ctx.initial === d.id;
  return (
    <div
      className={cn(
        "relative w-[236px] rounded-2xl bg-white shadow-soft transition-shadow",
        selected ? "shadow-lift ring-2 ring-brand-500 ring-offset-2" : "ring-1 ring-slate-200",
        !selected && issueRing(ctx, id),
      )}
    >
      <IssueBadge id={id} />
      <div className={cn("flex items-center gap-2 rounded-t-2xl bg-gradient-to-r px-3 py-2 text-white", c.gradient)}>
        <Flag className="size-3.5" aria-hidden />
        <span className="text-2xs font-bold uppercase tracking-wider">Phase</span>
        <span className="ml-auto flex gap-1">
          {isStart && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-white/25 px-1.5 py-px text-2xs font-bold">
              <Play className="size-2.5" aria-hidden /> Start
            </span>
          )}
          {d.terminal && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-white/25 px-1.5 py-px text-2xs font-bold">
              <Square className="size-2.5" aria-hidden /> End
            </span>
          )}
        </span>
      </div>
      <div className="px-3 pb-3 pt-2">
        <p className="truncate font-display text-[15px] font-bold text-slate-900">{d.name || d.id}</p>
        <p className="truncate font-mono text-2xs text-slate-500">{d.id}</p>
        <div className="mt-2 flex flex-wrap gap-1 text-2xs font-semibold">
          <span className={cn("rounded-md px-1.5 py-px ring-1 ring-inset", c.soft, c.text, c.ring)}>→ {(d.transitions ?? []).length} next</span>
          {(d.auto_advance ?? []).length > 0 && <span className="rounded-md bg-violet-50 px-1.5 py-px text-violet-700 ring-1 ring-inset ring-violet-200">⚡ {(d.auto_advance ?? []).length} auto</span>}
        </div>
      </div>
      <Handle type="target" position={Position.Left} id="in" className={cn(handleCls, "!bg-indigo-500")} />
      <Handle type="source" position={Position.Right} id="out" className={cn(handleCls, "!bg-indigo-500")} />
      <Handle type="source" position={Position.Bottom} id="contains" className={cn(handleCls, "!bg-slate-400")} title="Drag to an action to make it available in this phase" />
    </div>
  );
});

/* ------------------------------------------------------------------ action */

export const ActionNode = React.memo(function ActionNode({ id, data, selected }: NodeProps<SimNode>) {
  const ctx = React.useContext(BuilderContext);
  const d = data as unknown as SimAction;
  const kind = ACTION_KIND[d.kind ?? "inspect"] ?? ACTION_KIND.inspect!;
  const cls = CLASS_STYLE[d.classification ?? "neutral"] ?? CLASS_STYLE.neutral!;
  const Icon = kind.icon;
  const global = !(d.phases ?? []).length;
  const forces = transitionsOf(d);
  return (
    <div
      className={cn(
        "relative w-[252px] overflow-hidden rounded-xl bg-white shadow-soft transition-shadow",
        selected ? "shadow-lift ring-2 ring-brand-500 ring-offset-2" : "ring-1 ring-slate-200",
        !selected && issueRing(ctx, id),
      )}
    >
      <span className={cn("absolute inset-y-0 left-0 w-1.5", cls.stripe)} aria-hidden />
      <IssueBadge id={id} />
      <div className="py-2.5 pl-4 pr-3">
        <div className="flex items-start gap-2">
          <span className={cn("grid size-7 shrink-0 place-items-center rounded-lg", kind.chip)} title={kind.label}>
            <Icon className="size-3.5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-[13px] font-semibold leading-snug text-slate-900">{d.label || d.id}</p>
            <p className="mt-0.5 truncate font-mono text-2xs text-slate-500">
              {ctx.toolName.get(d.tool) ?? d.tool ?? "no tool"}
              {d.character ? ` · ${ctx.characterName.get(d.character) ?? d.character}` : ""}
            </p>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <ScoreChips score={d.score} />
          {d.time_cost ? (
            <span className="inline-flex items-center gap-0.5 rounded-md bg-slate-100 px-1.5 py-px text-2xs font-semibold text-slate-600">
              <Clock className="size-2.5" aria-hidden />
              {d.time_cost}m
            </span>
          ) : null}
          {global && (
            <span className="inline-flex items-center gap-0.5 rounded-md bg-sky-50 px-1.5 py-px text-2xs font-semibold text-sky-700 ring-1 ring-inset ring-sky-200" title="Available in every phase">
              <Globe2 className="size-2.5" aria-hidden /> All phases
            </span>
          )}
          {forces.length > 0 && <span className="rounded-md bg-fuchsia-50 px-1.5 py-px text-2xs font-semibold text-fuchsia-700 ring-1 ring-inset ring-fuchsia-200">→ {forces.join(", ")}</span>}
          {d.classification && d.classification !== "neutral" && (
            <span className={cn("rounded-md px-1.5 py-px text-2xs font-semibold ring-1 ring-inset", cls.soft)}>{cls.label}</span>
          )}
        </div>
      </div>
      <Handle type="target" position={Position.Top} id="in-top" className={cn(handleCls, "!bg-slate-400")} />
      <Handle type="source" position={Position.Right} id="out" className={cn(handleCls, "!bg-sky-500")} />
    </div>
  );
});

/* ------------------------------------------------------------------ branch */

export const BranchNode = React.memo(function BranchNode({ id, data, selected }: NodeProps<SimNode>) {
  const ctx = React.useContext(BuilderContext);
  const d = data as unknown as SimBranch;
  const cls = d.classification ? CLASS_STYLE[d.classification] : undefined;
  const when = summarizeCondition(d.when);
  return (
    <div
      className={cn(
        "relative w-[212px] rounded-[20px] border-2 border-dashed bg-gradient-to-br from-teal-50 to-white px-3 py-2 shadow-sm transition-shadow",
        selected ? "border-brand-500 shadow-lift" : "border-teal-300",
        !selected && issueRing(ctx, id),
      )}
    >
      <IssueBadge id={id} />
      <div className="flex items-center gap-1.5">
        <span className="grid size-5 shrink-0 rotate-45 place-items-center rounded-[5px] bg-teal-500" aria-hidden>
          <GitBranch className="size-3 -rotate-45 text-white" />
        </span>
        <span className="truncate text-2xs font-bold uppercase tracking-wider text-teal-800">{d.id || "branch"}</span>
        {cls && <span className={cn("ml-auto size-2 shrink-0 rounded-full", cls.stripe)} title={cls.label} aria-label={cls.label} />}
      </div>
      <p className="mt-1 line-clamp-2 text-xs text-slate-700" title={when}>
        <span className="font-semibold text-teal-700">if</span> {truncate(when, 70)}
      </p>
      {(d.score && Object.keys(d.score).length > 0) || transitionsOf(d).length ? (
        <div className="mt-1 flex flex-wrap gap-1">
          <ScoreChips score={d.score} max={2} />
          {transitionsOf(d).map((t) => (
            <span key={t} className="rounded-md bg-fuchsia-50 px-1.5 py-px text-2xs font-semibold text-fuchsia-700">
              → {t}
            </span>
          ))}
        </div>
      ) : null}
      <Handle type="target" position={Position.Left} id="in" className={cn(handleCls, "!bg-teal-500")} />
      <Handle type="source" position={Position.Right} id="out" className={cn(handleCls, "!bg-teal-500")} />
    </div>
  );
});

/* ------------------------------------------------------------------ event */

function triggerText(t: SimEvent["trigger"] | undefined): { icon: typeof Zap; text: string } {
  if (!t) return { icon: Zap, text: "no trigger" };
  if (t.type === "time") return { icon: Timer, text: `at ${t.at_minutes ?? "?"} min${t.condition ? ` if ${summarizeCondition(t.condition)}` : ""}` };
  if (t.type === "after_action") return { icon: Hourglass, text: `after ${t.action ?? "?"}` };
  return { icon: Zap, text: `when ${summarizeCondition(t.condition)}` };
}

export const EventNode = React.memo(function EventNode({ id, data, selected }: NodeProps<SimNode>) {
  const ctx = React.useContext(BuilderContext);
  const d = data as unknown as SimEvent;
  const t = triggerText(d.trigger);
  const cls = CLASS_STYLE[d.classification ?? "neutral"];
  return (
    <div className={cn("relative w-[240px] rounded-2xl bg-gradient-to-br from-amber-400 via-orange-400 to-rose-500 p-[2px] shadow-soft", selected && "shadow-lift ring-2 ring-brand-500 ring-offset-2", !selected && issueRing(ctx, id))}>
      <IssueBadge id={id} />
      <div className="rounded-[14px] bg-white px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="grid size-6 place-items-center rounded-lg bg-gradient-to-br from-amber-400 to-rose-500 text-white">
            <Zap className="size-3.5" aria-hidden />
          </span>
          <span className="text-2xs font-bold uppercase tracking-wider text-orange-700">Event</span>
          {d.once === false && (
            <span className="ml-auto inline-flex items-center gap-0.5 text-2xs font-semibold text-slate-500" title="Can fire more than once">
              <Repeat className="size-3" aria-hidden /> ×{d.max_fires ?? "∞"}
            </span>
          )}
        </div>
        <p className="mt-1 truncate text-[13px] font-semibold text-slate-900">{d.title || d.id}</p>
        <p className="mt-0.5 flex items-center gap-1 truncate text-2xs text-slate-600" title={t.text}>
          <t.icon className="size-3 shrink-0 text-orange-500" aria-hidden />
          {truncate(t.text, 44)}
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1">
          <ScoreChips score={d.score} max={2} />
          {d.classification && d.classification !== "neutral" && cls && <span className={cn("rounded-md px-1.5 py-px text-2xs font-semibold ring-1 ring-inset", cls.soft)}>{cls.label}</span>}
        </div>
      </div>
      <Handle type="target" position={Position.Top} id="in-top" className={cn(handleCls, "!bg-amber-500")} />
      <Handle type="source" position={Position.Right} id="out" className={cn(handleCls, "!bg-amber-500")} />
    </div>
  );
});

export const nodeTypes = { phase: PhaseNode, action: ActionNode, branch: BranchNode, event: EventNode };

/* ------------------------------------------------------------------ edge */

export function SimEdgeView({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected, markerEnd }: EdgeProps<SimEdge>) {
  const kind = data?.kind ?? "transition";
  const smooth = kind === "contains" || kind === "branch";
  const [path, labelX, labelY] = smooth
    ? getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 14 })
    : getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const style = kind === "transition" && data?.auto ? EDGE_STYLE.auto : EDGE_STYLE[kind];
  const dashed = kind === "contains" ? "3 5" : kind === "effect_transition" || kind === "triggers" ? "6 4" : data?.auto ? "7 5" : undefined;
  const label =
    kind === "transition" && data?.auto
      ? `auto · ${truncate(summarizeCondition(data.when), 34)}`
      : kind === "branch"
        ? `#${(data?.order ?? 0) + 1}`
        : kind === "triggers"
          ? data?.triggerKind === "after_action"
            ? "after"
            : "triggers"
          : kind === "effect_transition"
            ? "forces"
            : null;
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        className={cn(data?.auto && "sim-edge-flow")}
        style={{
          stroke: style.color,
          strokeWidth: selected ? 3.5 : kind === "contains" ? 1.25 : 2,
          strokeDasharray: dashed,
          opacity: kind === "contains" && !selected ? 0.55 : 1,
          filter: selected ? `drop-shadow(0 0 4px ${style.color})` : undefined,
        }}
        interactionWidth={18}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-auto absolute rounded-full px-2 py-0.5 text-2xs font-bold shadow-sm ring-1"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              // Edges sit in their own z-indexed SVGs; lift the opaque label above every edge stroke.
              zIndex: 1000,
              background: "white",
              color: style.text,
              boxShadow: `0 0 0 1px ${style.color}33`,
            }}
            title={kind === "transition" && data?.auto ? summarizeCondition(data.when) : undefined}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const edgeTypes = { sim: SimEdgeView };
