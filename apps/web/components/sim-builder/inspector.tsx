"use client";

import { Button, cn } from "@praxis/ui";
import { AlertCircle, AlertTriangle, ArrowDown, ArrowUp, Copy, Flag, GitBranch, MousePointerClick, Play, Plus, Trash2, Workflow, Zap } from "lucide-react";
import * as React from "react";
import { ConditionEditor } from "./condition-editor";
import { ChipPicker, FieldRow, ListEditor, MiniInput, MiniSelect, MiniTextarea, NumberInput, Section, ToggleRow, useFieldId } from "./fields";
import { entityId, type BranchLink, type MappedIssue, type SimNode } from "./graph-utils";
import { ClassificationPicker, EffectsEditor, InputSpecEditor, ListEditorStrings, MessagesEditor, OutputsEditor, ScoreEditor } from "./outcome-editors";
import { ACTION_KIND } from "./theme";
import type { AutoAdvance, Classification, RefContext, RepeatPolicy, SimAction, SimBranch, SimEvent, SimPhase } from "./types";

export interface InspectorProps {
  node: SimNode;
  nodes: SimNode[];
  links: BranchLink[];
  ctx: RefContext;
  initial: string;
  issues: MappedIssue[];
  onData: (nodeId: string, data: Record<string, unknown>) => void;
  onDelete: (nodeId: string) => void;
  onSelect: (nodeId: string) => void;
  onSetInitial: (phaseId: string) => void;
  onAddBranch: (actionNodeId: string) => void;
  onReorderBranch: (branchNodeId: string, dir: -1 | 1) => void;
  onMoveBranch: (branchNodeId: string, actionNodeId: string) => void;
}

const TYPE_META = {
  phase: { label: "Phase", icon: Flag, chip: "bg-gradient-to-br from-indigo-500 to-violet-500" },
  action: { label: "Action", icon: MousePointerClick, chip: "bg-gradient-to-br from-sky-500 to-indigo-500" },
  branch: { label: "Branch", icon: GitBranch, chip: "bg-gradient-to-br from-teal-400 to-emerald-500" },
  event: { label: "Event", icon: Zap, chip: "bg-gradient-to-br from-amber-400 to-rose-500" },
} as const;

function Header({ node, issues, onDelete }: { node: SimNode; issues: MappedIssue[]; onDelete: () => void }) {
  const meta = TYPE_META[node.type as keyof typeof TYPE_META];
  const id = entityId(node);
  const title = String((node.data as { label?: string; name?: string; title?: string }).label ?? (node.data as { name?: string }).name ?? (node.data as { title?: string }).title ?? id);
  return (
    <div className="border-b border-slate-100 px-4 pb-3 pt-4">
      <div className="flex items-start gap-3">
        <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl text-white shadow-sm", meta.chip)}>
          <meta.icon className="size-[18px]" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-2xs font-bold uppercase tracking-wider text-slate-500">{meta.label}</p>
          <h2 className="truncate font-display text-base font-semibold text-slate-900" title={title}>
            {title || "Untitled"}
          </h2>
          <button
            type="button"
            className="mt-0.5 inline-flex items-center gap-1 rounded font-mono text-2xs text-slate-500 hover:text-brand-700 focus-visible:focus-ring"
            onClick={() => navigator.clipboard?.writeText(id).catch(() => undefined)}
            title="Copy id (used in conditions and references)"
          >
            {id} <Copy className="size-3" aria-hidden />
            <span className="sr-only">Copy id</span>
          </button>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label={`Delete ${meta.label.toLowerCase()}`} onClick={onDelete} className="text-rose-600 hover:bg-rose-50 hover:text-rose-700">
          <Trash2 />
        </Button>
      </div>
      {issues.length > 0 && (
        <ul className="mt-3 space-y-1" aria-label="Validation issues for this node">
          {issues.map((i, k) => (
            <li key={k} className={cn("flex gap-1.5 rounded-lg px-2 py-1.5 text-2xs leading-snug", i.severity === "error" ? "bg-rose-50 text-rose-800" : "bg-amber-50 text-amber-900")}>
              {i.severity === "error" ? <AlertCircle className="mt-px size-3 shrink-0" aria-hidden /> : <AlertTriangle className="mt-px size-3 shrink-0" aria-hidden />}
              <span>
                <span className="font-mono font-semibold">{i.code}</span> · {i.message}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TextField({ label, value, onChange, multiline, mono, hint, rows }: { label: string; value: string | null | undefined; onChange: (v: string) => void; multiline?: boolean; mono?: boolean; hint?: string; rows?: number }) {
  const id = useFieldId();
  return (
    <FieldRow label={label} htmlFor={id} hint={hint}>
      {multiline ? (
        <MiniTextarea id={id} mono={mono} rows={rows ?? 3} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <MiniInput id={id} mono={mono} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
      )}
    </FieldRow>
  );
}

/* ------------------------------------------------------------------ phase */

function PhaseInspector({ node, ctx, initial, nodes, onData, onSetInitial, onSelect }: InspectorProps) {
  const d = node.data as unknown as SimPhase;
  const id = entityId(node);
  const set = (patch: Partial<SimPhase>) => onData(node.id, { ...node.data, ...patch });
  const others = ctx.phases.filter((p) => p.id !== id);
  const autos = d.auto_advance ?? [];
  const here = nodes.filter((n) => n.type === "action" && ((n.data as unknown as SimAction).phases ?? []).includes(id));
  return (
    <>
      <Section title="Basics" color="bg-indigo-500">
        <TextField label="Name" value={d.name} onChange={(v) => set({ name: v })} />
        <TextField label="Description" value={d.description} onChange={(v) => set({ description: v })} multiline rows={2} />
        <div className="flex flex-wrap items-center gap-2">
          {initial === id ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
              <Play className="size-3" aria-hidden /> Start phase
            </span>
          ) : (
            <Button size="xs" variant="soft" leftIcon={<Play />} onClick={() => onSetInitial(id)}>
              Make start phase
            </Button>
          )}
        </div>
        <ToggleRow label="Terminal phase" hint="Reaching it ends the run (unless a success condition is set)." checked={!!d.terminal} onChange={(v) => set({ terminal: v })} />
      </Section>
      <Section title="Transitions" color="bg-indigo-400" count={(d.transitions ?? []).length}>
        <FieldRow label="Can move to" hint="Allowed next phases (drawn as solid arrows). Drag from the right handle to another phase to add one.">
          <ChipPicker
            aria-label="Allowed next phases"
            options={others.map((p) => ({ value: p.id, label: p.name }))}
            value={d.transitions ?? []}
            onChange={(v) => set({ transitions: v, auto_advance: autos.filter((a) => v.includes(a.to)) })}
            emptyLabel="Add another phase first."
          />
        </FieldRow>
      </Section>
      <Section title="Auto-advance rules" color="bg-violet-500" count={autos.length}>
        <p className="text-2xs text-slate-500">Checked after every step, in order. The first rule whose condition holds moves the session on.</p>
        <ListEditor<AutoAdvance>
          items={autos}
          onChange={(v) => set({ auto_advance: v, transitions: Array.from(new Set([...(d.transitions ?? []), ...v.map((a) => a.to).filter(Boolean)])) })}
          make={() => ({ to: (d.transitions ?? [])[0] ?? others[0]?.id ?? "", when: true })}
          addLabel="Add rule"
          itemLabel={(a, i) => `rule ${i + 1} to ${a.to}`}
          render={(a, update, i) => (
            <div className="space-y-2">
              <div className="flex items-center gap-2 pr-20">
                <span className="text-2xs font-semibold text-slate-500">Move to</span>
                <MiniSelect aria-label={`Rule ${i + 1} target`} className="flex-1" value={a.to} onChange={(to) => update({ ...a, to })} options={others.map((p) => ({ value: p.id, label: p.name }))} />
              </div>
              <ConditionEditor value={a.when} onChange={(w) => update({ ...a, when: w })} ctx={ctx} allowNull={false} label={`Rule ${i + 1} condition`} />
            </div>
          )}
        />
      </Section>
      <Section title="Actions in this phase" color="bg-sky-500" count={here.length} defaultOpen={false}>
        {here.length ? (
          <ul className="flex flex-wrap gap-1.5">
            {here.map((n) => (
              <li key={n.id}>
                <button type="button" onClick={() => onSelect(n.id)} className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-800 ring-1 ring-inset ring-sky-200 hover:bg-sky-100 focus-visible:focus-ring">
                  {String((n.data as { label?: string }).label ?? entityId(n))}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-2xs italic text-slate-500">No phase-specific actions. Actions without phases are available everywhere.</p>
        )}
      </Section>
    </>
  );
}

/* ------------------------------------------------------------------ outcome sections (action / branch / event) */

function OutcomeSections({ d, set, ctx, inherit }: { d: SimAction | SimBranch | SimEvent; set: (p: Record<string, unknown>) => void; ctx: RefContext; inherit?: boolean }) {
  const fbId = useFieldId();
  const tcId = useFieldId();
  return (
    <>
      <Section title="Classification & score" color="bg-emerald-500">
        <FieldRow label="Classification" hint="Feeds feedback and analytics. Any critical outcome caps the total score.">
          <ClassificationPicker inherit={inherit} value={d.classification as Classification | null} onChange={(v) => set({ classification: v })} />
        </FieldRow>
        <FieldRow label="Score deltas per dimension">
          <ScoreEditor value={d.score} onChange={(v) => set({ score: v })} ctx={ctx} nullable={inherit} />
        </FieldRow>
        <FieldRow label="Simulated time cost (minutes)" htmlFor={tcId} hint={inherit ? "Leave empty to inherit from the action." : "Empty uses the engine default."}>
          <NumberInput id={tcId} nullable step={0.5} min={0} value={d.time_cost ?? null} onChange={(v) => set({ time_cost: v })} placeholder={inherit ? "inherit" : "default"} />
        </FieldRow>
      </Section>
      <Section title="Feedback" color="bg-sky-500" defaultOpen={!!d.feedback}>
        {inherit && d.feedback === null ? (
          <div className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Inherits the action&apos;s feedback
            <Button size="xs" variant="secondary" onClick={() => set({ feedback: "" })}>
              Override
            </Button>
          </div>
        ) : (
          <FieldRow label="Why this outcome is right or wrong" htmlFor={fbId} action={inherit ? <button type="button" className="text-2xs font-semibold text-brand-700 hover:underline" onClick={() => set({ feedback: null })}>Inherit</button> : undefined}>
            <MiniTextarea id={fbId} rows={3} value={d.feedback ?? ""} onChange={(e) => set({ feedback: e.target.value })} placeholder="Explain the consequence so the learner understands why." />
          </FieldRow>
        )}
      </Section>
      <Section title="Effects (state changes)" color="bg-indigo-500" count={(d.effects ?? []).length}>
        <EffectsEditor value={d.effects} onChange={(v) => set({ effects: v })} ctx={ctx} />
      </Section>
      <Section title="Outputs" color="bg-slate-500" count={(d.outputs ?? []).length} defaultOpen={false}>
        <OutputsEditor value={d.outputs} onChange={(v) => set({ outputs: v })} ctx={ctx} nullable={inherit} />
      </Section>
      <Section title="Messages" color="bg-teal-500" count={(d.messages ?? []).length} defaultOpen={false}>
        <MessagesEditor value={d.messages} onChange={(v) => set({ messages: v })} ctx={ctx} />
      </Section>
    </>
  );
}

/* ------------------------------------------------------------------ action */

function ActionInspector(props: InspectorProps) {
  const { node, ctx, links, nodes, onData, onSelect, onAddBranch, onReorderBranch } = props;
  const d = node.data as unknown as SimAction;
  const set = (patch: Record<string, unknown>) => onData(node.id, { ...node.data, ...patch });
  const branches = links
    .filter((l) => l.source === node.id)
    .sort((a, b) => a.order - b.order)
    .map((l) => nodes.find((n) => n.id === l.target))
    .filter((n): n is SimNode => !!n);
  const repeat: RepeatPolicy | null = d.repeat ?? null;
  const listedId = useFieldId();
  const kindId = useFieldId();
  const toolId = useFieldId();
  const charId = useFieldId();
  return (
    <>
      <Section title="Basics" color="bg-sky-500">
        <TextField label="Label" value={d.label} onChange={(v) => set({ label: v })} />
        <div className="grid grid-cols-2 gap-2">
          <FieldRow label="Kind" htmlFor={kindId}>
            <MiniSelect id={kindId} value={d.kind ?? "inspect"} onChange={(v) => set({ kind: v })} options={Object.entries(ACTION_KIND).map(([k, m]) => ({ value: k, label: m.label }))} />
          </FieldRow>
          <FieldRow label="Tool" htmlFor={toolId}>
            <MiniSelect id={toolId} value={d.tool} placeholder="Choose tool" onChange={(v) => set({ tool: v })} options={ctx.tools.map((t) => ({ value: t.id, label: t.name }))} />
          </FieldRow>
        </div>
        <FieldRow label="Character" htmlFor={charId} hint={d.kind === "ask" ? "Required for ask actions." : "Optional — who this action involves."}>
          <MiniSelect id={charId} value={d.character ?? ""} placeholder="None" onChange={(v) => set({ character: v || null })} options={ctx.characters.map((c) => ({ value: c.id, label: c.name }))} />
        </FieldRow>
        <TextField label="Description" value={d.description} onChange={(v) => set({ description: v })} multiline rows={2} />
        <FieldRow label="Shown as a button" htmlFor={listedId} hint="By default commands and questions must be typed; other kinds are listed.">
          <MiniSelect
            id={listedId}
            value={d.listed === null || d.listed === undefined ? "default" : d.listed ? "yes" : "no"}
            onChange={(v) => set({ listed: v === "default" ? null : v === "yes" })}
            options={[
              { value: "default", label: "Default for this kind" },
              { value: "yes", label: "Yes — listed" },
              { value: "no", label: "No — typed only" },
            ]}
          />
        </FieldRow>
        <TextField label="Practice hint" value={d.hint} onChange={(v) => set({ hint: v })} hint="Shown in practice mode only." />
      </Section>
      <Section title="Availability" color="bg-violet-500">
        <FieldRow label="Phases" hint="None selected = available in every phase.">
          <ChipPicker aria-label="Available in phases" options={ctx.phases.map((p) => ({ value: p.id, label: p.name }))} value={d.phases ?? []} onChange={(v) => set({ phases: v })} />
        </FieldRow>
        <FieldRow label="Preconditions">
          <ConditionEditor value={d.preconditions} onChange={(v) => set({ preconditions: v })} ctx={ctx} label="Preconditions" alwaysLabel="No preconditions" />
        </FieldRow>
        <TextField label="Message when not possible" value={d.precondition_message} onChange={(v) => set({ precondition_message: v })} />
      </Section>
      <Section title="Learner input" color="bg-fuchsia-500">
        <InputSpecEditor value={d.input} onChange={(v) => set({ input: v })} ctx={ctx} />
      </Section>
      <OutcomeSections d={d} set={set} ctx={ctx} />
      <Section title="Branches" color="bg-teal-500" count={branches.length} action={<Button size="xs" variant="soft" leftIcon={<Plus />} onClick={() => onAddBranch(node.id)}>Branch</Button>}>
        <p className="text-2xs text-slate-500">The first branch whose condition holds (before effects) replaces the default outcome. Shared effects and messages above always apply first.</p>
        {branches.length ? (
          <ol className="space-y-1.5">
            {branches.map((b, i) => {
              const bd = b.data as unknown as SimBranch;
              return (
                <li key={b.id} className="flex items-center gap-1.5 rounded-lg border border-teal-200 bg-teal-50/60 px-2 py-1.5">
                  <span className="grid size-5 place-items-center rounded-md bg-teal-500 text-2xs font-bold text-white">{i + 1}</span>
                  <button type="button" className="min-w-0 flex-1 truncate text-left text-xs font-medium text-slate-800 hover:text-brand-700 focus-visible:focus-ring" onClick={() => onSelect(b.id)}>
                    {bd.id || `branch ${i + 1}`}
                  </button>
                  <button type="button" aria-label={`Move branch ${i + 1} up`} disabled={i === 0} onClick={() => onReorderBranch(b.id, -1)} className="grid size-6 place-items-center rounded-md text-slate-500 hover:bg-white disabled:opacity-30 focus-visible:focus-ring">
                    <ArrowUp className="size-3.5" aria-hidden />
                  </button>
                  <button type="button" aria-label={`Move branch ${i + 1} down`} disabled={i === branches.length - 1} onClick={() => onReorderBranch(b.id, 1)} className="grid size-6 place-items-center rounded-md text-slate-500 hover:bg-white disabled:opacity-30 focus-visible:focus-ring">
                    <ArrowDown className="size-3.5" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="text-2xs italic text-slate-500">No branches — the default outcome always applies.</p>
        )}
      </Section>
      <Section title="Repeat policy" color="bg-orange-500" defaultOpen={false}>
        <FieldRow label="When taken again">
          <MiniSelect
            aria-label="Repeat mode"
            value={repeat?.mode ?? "inherit"}
            onChange={(v) => set({ repeat: v === "inherit" ? null : { mode: v, free_repeats: repeat?.free_repeats ?? 1, penalty: repeat?.penalty ?? {}, message: repeat?.message ?? "" } })}
            options={[
              { value: "inherit", label: "Use the scenario default" },
              { value: "diminish", label: "Diminish — score only once" },
              { value: "allow", label: "Allow — score every time" },
              { value: "penalize", label: "Penalize repeats" },
              { value: "block", label: "Block after first time" },
            ]}
          />
        </FieldRow>
        {repeat && (
          <>
            <FieldRow label="Free repeats">
              <NumberInput aria-label="Free repeats" min={0} value={repeat.free_repeats ?? 1} onChange={(n) => set({ repeat: { ...repeat, free_repeats: n ?? 0 } })} />
            </FieldRow>
            <FieldRow label="Penalty per extra repeat">
              <ScoreEditor value={repeat.penalty ?? {}} onChange={(v) => set({ repeat: { ...repeat, penalty: v ?? {} } })} ctx={ctx} />
            </FieldRow>
            <TextField label="Message" value={repeat.message} onChange={(v) => set({ repeat: { ...repeat, message: v } })} />
          </>
        )}
      </Section>
      <Section title="Tags" color="bg-slate-400" defaultOpen={false} count={(d.tags ?? []).length}>
        <ListEditorStrings value={d.tags ?? []} onChange={(v) => set({ tags: v })} placeholder="tag" />
      </Section>
    </>
  );
}

/* ------------------------------------------------------------------ branch */

function BranchInspector(props: InspectorProps) {
  const { node, ctx, links, nodes, onData, onMoveBranch, onSelect } = props;
  const d = node.data as unknown as SimBranch;
  const set = (patch: Record<string, unknown>) => onData(node.id, { ...node.data, ...patch });
  const owner = links.find((l) => l.target === node.id);
  const ownerId = useFieldId();
  return (
    <>
      <Section title="Branch" color="bg-teal-500">
        <TextField label="Branch id" value={d.id ?? ""} onChange={(v) => set({ id: v || null })} mono hint="Shown in analytics and replays." />
        <FieldRow
          label="Belongs to action"
          htmlFor={ownerId}
          action={owner ? <button type="button" className="text-2xs font-semibold text-brand-700 hover:underline" onClick={() => onSelect(owner.source)}>Open action</button> : undefined}
          hint={owner ? `Evaluated as branch #${owner.order + 1}.` : "Detached branches are dropped on save — attach it to an action."}
        >
          <MiniSelect
            id={ownerId}
            value={owner?.source ?? ""}
            placeholder="Not attached"
            onChange={(v) => v && onMoveBranch(node.id, v)}
            options={nodes.filter((n) => n.type === "action").map((n) => ({ value: n.id, label: String((n.data as { label?: string }).label ?? entityId(n)) }))}
          />
        </FieldRow>
        <FieldRow label="Applies when" hint="Evaluated before the action's effects.">
          <ConditionEditor value={d.when} onChange={(v) => set({ when: v })} ctx={ctx} allowNull={false} label="Branch condition" />
        </FieldRow>
      </Section>
      <OutcomeSections d={d} set={set} ctx={ctx} inherit />
    </>
  );
}

/* ------------------------------------------------------------------ event */

function EventInspector({ node, ctx, onData }: InspectorProps) {
  const d = node.data as unknown as SimEvent;
  const set = (patch: Record<string, unknown>) => onData(node.id, { ...node.data, ...patch });
  const t = d.trigger ?? { type: "condition" };
  const setT = (patch: Partial<SimEvent["trigger"]>) => set({ trigger: { ...t, ...patch } });
  const typeId = useFieldId();
  const atId = useFieldId();
  const actId = useFieldId();
  return (
    <>
      <Section title="Basics" color="bg-amber-500">
        <TextField label="Title" value={d.title} onChange={(v) => set({ title: v })} />
        <TextField label="Description" value={d.description} onChange={(v) => set({ description: v })} multiline rows={2} />
        <TextField label="Notification to the learner" value={d.notify} onChange={(v) => set({ notify: v })} hint="Added to the transcript as a system notice." />
      </Section>
      <Section title="Trigger" color="bg-orange-500">
        <FieldRow label="Fires" htmlFor={typeId}>
          <MiniSelect
            id={typeId}
            value={t.type}
            onChange={(v) => setT({ type: v as SimEvent["trigger"]["type"] })}
            options={[
              { value: "time", label: "At a simulated time" },
              { value: "condition", label: "When a condition holds" },
              { value: "after_action", label: "After a specific action" },
            ]}
          />
        </FieldRow>
        {t.type === "time" && (
          <FieldRow label="At minute" htmlFor={atId}>
            <NumberInput id={atId} min={0} step={0.5} value={t.at_minutes ?? null} nullable onChange={(n) => setT({ at_minutes: n })} />
          </FieldRow>
        )}
        {t.type === "after_action" && (
          <FieldRow label="After action" htmlFor={actId} hint="Or drag from an action's right handle onto this event.">
            <MiniSelect id={actId} value={t.action ?? ""} placeholder="Choose action" onChange={(v) => setT({ action: v || null })} options={ctx.actions.map((a) => ({ value: a.id, label: a.label }))} />
          </FieldRow>
        )}
        <FieldRow label={t.type === "condition" ? "Condition" : "Only if (optional)"}>
          <ConditionEditor value={t.condition} onChange={(v) => setT({ condition: v })} ctx={ctx} label="Trigger condition" alwaysLabel={t.type === "condition" ? "Always" : "No extra condition"} />
        </FieldRow>
        <ToggleRow label="Fire only once" checked={d.once !== false} onChange={(v) => set({ once: v, max_fires: v ? null : (d.max_fires ?? 3) })} />
        {d.once === false && (
          <FieldRow label="Max fires">
            <NumberInput aria-label="Maximum fires" min={1} value={d.max_fires ?? 3} onChange={(n) => set({ max_fires: n })} />
          </FieldRow>
        )}
      </Section>
      <OutcomeSections d={d} set={set} ctx={ctx} />
    </>
  );
}

export function Inspector(props: InspectorProps) {
  const { node, issues, onDelete } = props;
  return (
    <div className="flex h-full flex-col">
      <Header node={node} issues={issues} onDelete={() => onDelete(node.id)} />
      <div className="flex-1 overflow-y-auto scrollbar-thin" key={node.id}>
        {node.type === "phase" && <PhaseInspector {...props} />}
        {node.type === "action" && <ActionInspector {...props} />}
        {node.type === "branch" && <BranchInspector {...props} />}
        {node.type === "event" && <EventInspector {...props} />}
      </div>
    </div>
  );
}

export function InspectorEmpty({ counts, onAdd }: { counts: Record<string, number>; onAdd: (t: "phase" | "action" | "event") => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <span className="grid size-14 place-items-center rounded-2xl bg-brand-gradient text-white shadow-glow">
        <Workflow className="size-7" aria-hidden />
      </span>
      <div>
        <h2 className="font-display text-base font-semibold text-slate-900">Select something to edit</h2>
        <p className="mt-1 text-sm text-muted-foreground">Click a node on the canvas to edit its fields. Drag between handles to connect phases, actions, branches and events.</p>
      </div>
      <dl className="grid w-full grid-cols-2 gap-2 text-left">
        {[
          ["Phases", counts.phase, "bg-indigo-50 text-indigo-700"],
          ["Actions", counts.action, "bg-sky-50 text-sky-700"],
          ["Branches", counts.branch, "bg-teal-50 text-teal-700"],
          ["Events", counts.event, "bg-amber-50 text-amber-800"],
        ].map(([l, n, c]) => (
          <div key={String(l)} className={cn("rounded-xl px-3 py-2", String(c))}>
            <dt className="text-2xs font-semibold uppercase tracking-wider opacity-80">{l}</dt>
            <dd className="font-display text-xl font-bold tabular-nums">{n ?? 0}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap justify-center gap-2">
        <Button size="sm" variant="secondary" leftIcon={<Flag />} onClick={() => onAdd("phase")}>
          Phase
        </Button>
        <Button size="sm" variant="secondary" leftIcon={<MousePointerClick />} onClick={() => onAdd("action")}>
          Action
        </Button>
        <Button size="sm" variant="secondary" leftIcon={<Zap />} onClick={() => onAdd("event")}>
          Event
        </Button>
      </div>
    </div>
  );
}
