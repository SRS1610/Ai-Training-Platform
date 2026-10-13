"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Alert, Button, CATEGORY_COLORS, FormField, Input, Textarea, Tooltip, cn, colorClasses, toast, type CategoryColor } from "@praxis/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, GripVertical, Plus, Save, Scale, SplitSquareHorizontal, Trash2, Wand2, X } from "lucide-react";
import * as React from "react";
import { ApiError, api } from "@/lib/api";
import { problemsFrom, problemsMessage, uid } from "../hooks";
import { ak } from "../keys";
import { NumberInput } from "../shared";
import type { Rubric, RubricCriterion, RubricLevel } from "../types";

/* ------------------------------------------------------------------ model */

export interface LocalCriterion {
  key: string;
  id: string | null;
  name: string;
  description: string;
  weight: number;
  levels: (RubricLevel & { key: string })[];
}

const LEVEL_COLORS: CategoryColor[] = ["rose", "amber", "sky", "violet", "emerald"];

/** Colour for level i of n (lowest = rose … highest = emerald). */
export function levelColor(i: number, n: number): CategoryColor {
  if (n <= 1) return "emerald";
  return LEVEL_COLORS[Math.round((i / (n - 1)) * (LEVEL_COLORS.length - 1))]!;
}

export function criterionColor(i: number): CategoryColor {
  return CATEGORY_COLORS[i % CATEGORY_COLORS.length]!;
}

const DEFAULT_LEVELS: Omit<RubricLevel, "description">[] = [
  { score: 0, label: "Missing" },
  { score: 1, label: "Developing" },
  { score: 2, label: "Proficient" },
  { score: 3, label: "Exemplary" },
];

function levelsFrom(list: RubricLevel[] | undefined) {
  return [...(list ?? [])].sort((a, b) => a.score - b.score).map((l) => ({ ...l, description: l.description ?? "", key: uid("lv") }));
}

function starterLevels(): LocalCriterion["levels"] {
  const descs = ["Not demonstrated.", "Partially demonstrated with gaps.", "Demonstrated clearly and correctly.", "Demonstrated thoroughly, with insight."];
  return DEFAULT_LEVELS.map((l, i) => ({ ...l, description: descs[i]!, key: uid("lv") }));
}

export function toLocalCriteria(c: RubricCriterion[] | undefined): LocalCriterion[] {
  return (c ?? []).map((x) => ({
    key: uid("cr"),
    id: x.id ?? null,
    name: x.name ?? "",
    description: x.description ?? "",
    weight: Number(x.weight) || 0,
    levels: levelsFrom(x.levels),
  }));
}

export function starterCriteria(): LocalCriterion[] {
  return [
    { name: "Accuracy & correctness", description: "The work is technically correct and addresses the actual problem.", weight: 40 },
    { name: "Process & reasoning", description: "Follows a sound method and explains why each step was taken.", weight: 35 },
    { name: "Communication", description: "Clear, well-structured and appropriate for the audience.", weight: 25 },
  ].map((c) => ({ ...c, key: uid("cr"), id: null, levels: starterLevels() }));
}

const total = (cs: LocalCriterion[]) => Math.round(cs.reduce((s, c) => s + (Number(c.weight) || 0), 0) * 100) / 100;

/** Rescale weights proportionally so they sum to exactly 100. */
export function balance(cs: LocalCriterion[]): LocalCriterion[] {
  const t = total(cs);
  if (!cs.length) return cs;
  if (t <= 0) return evenly(cs);
  const scaled = cs.map((c) => Math.round(((Number(c.weight) || 0) / t) * 1000) / 10);
  const drift = Math.round((100 - scaled.reduce((s, w) => s + w, 0)) * 10) / 10;
  scaled[scaled.length - 1] = Math.round((scaled[scaled.length - 1]! + drift) * 10) / 10;
  return cs.map((c, i) => ({ ...c, weight: scaled[i]! }));
}

function evenly(cs: LocalCriterion[]): LocalCriterion[] {
  if (!cs.length) return cs;
  const base = Math.floor((100 / cs.length) * 10) / 10;
  return cs.map((c, i) => ({ ...c, weight: i === cs.length - 1 ? Math.round((100 - base * (cs.length - 1)) * 10) / 10 : base }));
}

export function rubricProblems(title: string, cs: LocalCriterion[]): string[] {
  const p: string[] = [];
  if (!title.trim()) p.push("Give the rubric a title");
  if (!cs.length) p.push("Add at least one criterion");
  cs.forEach((c, i) => {
    const n = c.name.trim() || `Criterion ${i + 1}`;
    if (!c.name.trim()) p.push(`Criterion ${i + 1} needs a name`);
    if (!(c.weight > 0)) p.push(`${n}: weight must be above 0`);
    if (!c.levels.length) p.push(`${n}: add at least one level`);
    else if (Math.max(...c.levels.map((l) => Number(l.score) || 0)) <= 0) p.push(`${n}: the top level needs a score above 0`);
    if (c.levels.some((l) => !l.label.trim())) p.push(`${n}: every level needs a label`);
  });
  if (cs.length && Math.abs(total(cs) - 100) > 0.01) p.push(`Weights must add up to 100% (now ${total(cs)}%)`);
  return p;
}

export function toCriteriaIn(cs: LocalCriterion[]): RubricCriterion[] {
  return cs.map((c) => ({
    ...(c.id ? { id: c.id } : {}),
    name: c.name.trim(),
    description: c.description.trim() || null,
    weight: Number(c.weight),
    levels: [...c.levels]
      .sort((a, b) => a.score - b.score)
      .map((l) => ({ score: Number(l.score) || 0, label: l.label.trim(), description: (l.description ?? "").trim() || null })),
  }));
}

/* ------------------------------------------------------------------ weight bar */

export function WeightBar({ criteria, className }: { criteria: { name: string; weight: number }[]; className?: string }) {
  const t = criteria.reduce((s, c) => s + (Number(c.weight) || 0), 0);
  const ok = Math.abs(t - 100) <= 0.01;
  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-slate-800">Weight distribution</p>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums ring-1 ring-inset",
            ok ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-amber-50 text-amber-800 ring-amber-200",
          )}
          aria-live="polite"
        >
          {ok && <CheckCircle2 className="size-3.5" aria-hidden />}
          Total {Math.round(t * 100) / 100}%
        </span>
      </div>
      <div className="mt-2 flex h-3 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`Weights: ${criteria.map((c) => `${c.name || "Untitled"} ${c.weight}%`).join(", ")}`}>
        {criteria.map((c, i) => (
          <span
            key={`${c.name}-${i}`}
            className={cn("h-full border-r-2 border-white last:border-r-0", colorClasses(criterionColor(i)).solid)}
            style={{ width: `${Math.max(0, Math.min(100, ((Number(c.weight) || 0) / Math.max(100, t)) * 100))}%` }}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {criteria.map((c, i) => (
          <span key={`${c.name}-${i}`} className="inline-flex items-center gap-1.5 text-2xs font-medium text-slate-600">
            <span className={cn("size-2 rounded-full", colorClasses(criterionColor(i)).solid)} aria-hidden />
            {c.name || `Criterion ${i + 1}`} <span className="tabular-nums text-slate-500">{c.weight}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ read-only grid */

/** Criteria × levels matrix (read-only), used in previews and pickers. */
export function RubricGrid({ criteria, className }: { criteria: RubricCriterion[]; className?: string }) {
  return (
    <div className={cn("space-y-3", className)}>
      {criteria.map((c, i) => {
        const levels = [...(c.levels ?? [])].sort((a, b) => a.score - b.score);
        const cc = colorClasses(criterionColor(i));
        return (
          <div key={c.id ?? i} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className={cn("flex items-start justify-between gap-3 border-b border-slate-100 bg-gradient-to-r px-4 py-2.5", cc.tint)}>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">{c.name}</p>
                {c.description && <p className="text-xs text-slate-600">{c.description}</p>}
              </div>
              <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-2xs font-bold tabular-nums ring-1 ring-inset", cc.soft, cc.text, cc.ring)}>{c.weight}%</span>
            </div>
            <div
              className="grid grid-cols-2 gap-px bg-slate-100 max-sm:[&>*:last-child:nth-child(odd)]:col-span-2 sm:[grid-template-columns:var(--rubric-cols)]"
              style={{ "--rubric-cols": `repeat(${Math.max(1, levels.length)}, minmax(0, 1fr))` } as React.CSSProperties}
            >
              {levels.map((l, j) => {
                const lc = colorClasses(levelColor(j, levels.length));
                return (
                  <div key={j} className="bg-white p-2.5">
                    <p className={cn("flex items-center justify-between gap-1 text-2xs font-bold uppercase tracking-wider", lc.text)}>
                      <span className="truncate">{l.label}</span>
                      <span className="tabular-nums">{l.score}</span>
                    </p>
                    {l.description && <p className="mt-1 text-xs leading-snug text-slate-600">{l.description}</p>}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ criterion editor */

function CriterionCard({
  c,
  index,
  onChange,
  onRemove,
  canRemove,
}: {
  c: LocalCriterion;
  index: number;
  onChange: (c: LocalCriterion) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const sortable = useSortable({ id: c.key });
  const cc = colorClasses(criterionColor(index));
  const levels = c.levels;
  const setLevel = (key: string, patch: Partial<RubricLevel>) => onChange({ ...c, levels: levels.map((l) => (l.key === key ? { ...l, ...patch } : l)) });
  const addLevel = () => {
    const top = levels.length ? Math.max(...levels.map((l) => Number(l.score) || 0)) : -1;
    onChange({ ...c, levels: [...levels, { key: uid("lv"), score: top + 1, label: "", description: "" }] });
  };
  return (
    <li
      ref={sortable.setNodeRef}
      style={{ transform: CSS.Translate.toString(sortable.transform), transition: sortable.transition }}
      className={cn("overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm", sortable.isDragging && "z-10 shadow-lift ring-2 ring-brand-400")}
    >
      <div className={cn("flex flex-col gap-3 border-b border-slate-100 bg-gradient-to-r p-3 sm:flex-row sm:items-start", cc.tint)}>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="grid size-8 shrink-0 cursor-grab touch-none place-items-center rounded-lg text-slate-400 hover:bg-white hover:text-slate-700 focus-visible:focus-ring active:cursor-grabbing"
            aria-label={`Reorder criterion ${index + 1}: ${c.name || "untitled"}`}
            {...sortable.attributes}
            {...sortable.listeners}
          >
            <GripVertical className="size-4" aria-hidden />
          </button>
          <span className={cn("grid size-8 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-sm font-bold text-white shadow-sm", cc.gradient)} aria-hidden>
            {index + 1}
          </span>
        </div>
        <div className="grid min-w-0 flex-1 gap-2">
          <Input inputSize="sm" value={c.name} placeholder="Criterion name, e.g. Root-cause analysis" aria-label={`Criterion ${index + 1} name`} onChange={(e) => onChange({ ...c, name: e.target.value })} maxLength={200} />
          <Textarea
            rows={2}
            className="min-h-[56px] bg-white"
            value={c.description}
            placeholder="What does good look like? Assessors and the AI grader read this."
            aria-label={`Criterion ${index + 1} description`}
            onChange={(e) => onChange({ ...c, description: e.target.value })}
          />
        </div>
        <div className="flex items-center gap-2 sm:flex-col sm:items-end">
          <div className="flex items-center gap-1.5">
            <NumberInput
              inputSize="sm"
              aria-label={`Criterion ${index + 1} weight`}
              value={c.weight}
              min={0}
              max={100}
              step={5}
              suffix="%"
              onChange={(v) => onChange({ ...c, weight: v ?? 0 })}
              className="h-9 w-24 text-right font-semibold tabular-nums"
            />
            <Button variant="ghost" size="icon-sm" aria-label={`Remove criterion ${index + 1}`} onClick={onRemove} disabled={!canRemove}>
              <Trash2 />
            </Button>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.min(100, c.weight)}
            onChange={(e) => onChange({ ...c, weight: Number(e.target.value) })}
            className="w-32 accent-brand-600"
            aria-label={`Criterion ${index + 1} weight slider`}
            aria-valuetext={`${c.weight}%`}
          />
        </div>
      </div>
      <div className="p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-2xs font-bold uppercase tracking-wider text-slate-500">Performance levels · lowest to highest</p>
          <Button variant="ghost" size="xs" leftIcon={<Plus />} onClick={addLevel} disabled={levels.length >= 20}>
            Add level
          </Button>
        </div>
        <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(11rem,1fr))]">
          {[...levels]
            .sort((a, b) => a.score - b.score)
            .map((l, j, arr) => {
              const lc = colorClasses(levelColor(j, arr.length));
              return (
                <div key={l.key} className={cn("relative flex flex-col gap-2 rounded-xl border bg-white p-2.5 pt-3", lc.border)}>
                  <span className={cn("absolute inset-x-0 top-0 h-1 rounded-t-xl", lc.solid)} aria-hidden />
                  <div className="flex items-center justify-between gap-1">
                    <span className={cn("text-2xs font-bold uppercase tracking-wider", lc.text)}>Level {j + 1}</span>
                    <div className="flex items-center gap-1">
                      <NumberInput
                        inputSize="sm"
                        aria-label={`Criterion ${index + 1} level ${j + 1} score`}
                        value={l.score}
                        min={0}
                        max={1000}
                        onChange={(v) => setLevel(l.key, { score: v ?? 0 })}
                        className="h-7 w-14 px-2 text-center text-xs tabular-nums"
                      />
                      <span className="text-2xs font-medium text-slate-500" aria-hidden>
                        pts
                      </span>
                      <Tooltip content="Remove level">
                        <button
                          type="button"
                          className="grid size-7 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-rose-600 focus-visible:focus-ring disabled:opacity-40"
                          aria-label={`Remove level ${j + 1} of criterion ${index + 1}`}
                          disabled={levels.length <= 1}
                          onClick={() => onChange({ ...c, levels: levels.filter((x) => x.key !== l.key) })}
                        >
                          <X className="size-3.5" aria-hidden />
                        </button>
                      </Tooltip>
                    </div>
                  </div>
                  <Input
                    inputSize="sm"
                    value={l.label}
                    placeholder="Label, e.g. Proficient"
                    aria-label={`Criterion ${index + 1} level ${j + 1} label`}
                    onChange={(e) => setLevel(l.key, { label: e.target.value })}
                    className={cn("h-8 font-semibold", lc.text)}
                    maxLength={120}
                  />
                  <Textarea
                    rows={3}
                    className="min-h-[76px] text-xs"
                    value={l.description ?? ""}
                    placeholder="Descriptor: what work at this level looks like"
                    aria-label={`Criterion ${index + 1} level ${j + 1} descriptor`}
                    onChange={(e) => setLevel(l.key, { description: e.target.value })}
                  />
                </div>
              );
            })}
        </div>
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ editor */

/**
 * Create / edit a rubric: weighted criteria (live total must equal 100%) and a level-descriptor grid.
 * POST /rubrics or PATCH /rubrics/{id}.
 */
export function RubricEditor({
  rubric,
  onSaved,
  onCancel,
  onDirtyChange,
  submitLabel,
  inDialog,
}: {
  inDialog?: boolean;
  rubric?: Rubric | null;
  onSaved?: (r: Rubric) => void;
  onCancel?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  submitLabel?: string;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = React.useState(rubric?.title ?? "");
  const [description, setDescription] = React.useState(rubric?.description ?? "");
  const [criteria, setCriteria] = React.useState<LocalCriterion[]>(() => (rubric ? toLocalCriteria(rubric.criteria) : starterCriteria()));
  const [touched, setTouched] = React.useState(false);
  const [serverErrors, setServerErrors] = React.useState<string[]>([]);
  const [live, setLive] = React.useState("");
  const initial = React.useRef(JSON.stringify([rubric?.title ?? "", rubric?.description ?? "", toCriteriaIn(rubric ? toLocalCriteria(rubric.criteria) : [])]));
  const dirty = !rubric || JSON.stringify([title, description, toCriteriaIn(criteria)]) !== initial.current;
  React.useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
  const problems = rubricProblems(title, criteria);
  const t = total(criteria);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const save = useMutation({
    mutationFn: () => {
      const body = { title: title.trim(), description: description.trim() || null, criteria: toCriteriaIn(criteria) };
      return rubric ? api.patch<Rubric>(`/rubrics/${rubric.id}`, body) : api.post<Rubric>("/rubrics", body);
    },
    onSuccess: (r) => {
      toast.success(rubric ? "Rubric saved" : `Rubric “${r.title}” created`);
      initial.current = JSON.stringify([r.title, r.description ?? "", toCriteriaIn(toLocalCriteria(r.criteria))]);
      setCriteria(toLocalCriteria(r.criteria));
      qc.setQueryData(ak.rubrics.detail(r.id), r);
      qc.invalidateQueries({ queryKey: ak.rubrics.all });
      onSaved?.(r);
    },
    onError: (e) => {
      const p = problemsFrom(e);
      setServerErrors(p.length ? p : [problemsMessage(e)]);
      if (!(e instanceof ApiError)) toast.error(problemsMessage(e));
    },
  });

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up criterion ${criteria.findIndex((c) => c.key === active.id) + 1}.`,
    onDragOver: ({ over }) => (over ? `Over position ${criteria.findIndex((c) => c.key === over.id) + 1}.` : "Not over a position."),
    onDragEnd: ({ over }) => (over ? `Dropped at position ${criteria.findIndex((c) => c.key === over.id) + 1}.` : "Dropped."),
    onDragCancel: () => "Reorder cancelled.",
  };
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const a = criteria.findIndex((c) => c.key === e.active.id);
    const b = criteria.findIndex((c) => c.key === e.over!.id);
    setCriteria(arrayMove(criteria, a, b));
  };

  return (
    <div className="space-y-5">
      <p className="sr-only" aria-live="polite">
        {live}
      </p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <FormField label="Title" required error={touched && !title.trim() ? "Give the rubric a title" : null}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={255} placeholder="e.g. Incident report rubric" />
        </FormField>
        <FormField label="Description" hint="Optional — when and how to use this rubric.">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={10000} />
        </FormField>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-4">
        <WeightBar criteria={criteria} />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={Math.abs(t - 100) > 0.01 ? "primary" : "secondary"}
            leftIcon={<Scale />}
            onClick={() => {
              setCriteria(balance(criteria));
              setLive("Weights rebalanced to 100%");
            }}
            disabled={!criteria.length || Math.abs(t - 100) <= 0.01}
          >
            Balance to 100%
          </Button>
          <Button
            size="sm"
            variant="ghost"
            leftIcon={<SplitSquareHorizontal />}
            onClick={() => {
              setCriteria(evenly(criteria));
              setLive("Weights split evenly");
            }}
            disabled={!criteria.length}
          >
            Split evenly
          </Button>
          {Math.abs(t - 100) > 0.01 && (
            <p className="text-xs font-medium text-amber-800">
              {t < 100 ? `${Math.round((100 - t) * 100) / 100}% left to assign` : `${Math.round((t - 100) * 100) / 100}% over`}
            </p>
          )}
        </div>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd} accessibility={{ announcements }}>
        <SortableContext items={criteria.map((c) => c.key)} strategy={verticalListSortingStrategy}>
          <ol className="space-y-3" aria-label="Criteria">
            {criteria.map((c, i) => (
              <CriterionCard
                key={c.key}
                c={c}
                index={i}
                canRemove={criteria.length > 1}
                onChange={(n) => setCriteria(criteria.map((x) => (x.key === c.key ? n : x)))}
                onRemove={() => {
                  setCriteria(criteria.filter((x) => x.key !== c.key));
                  setLive(`Criterion ${i + 1} removed`);
                }}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
      <Button
        variant="soft"
        leftIcon={<Plus />}
        disabled={criteria.length >= 50}
        onClick={() => {
          setCriteria([...criteria, { key: uid("cr"), id: null, name: "", description: "", weight: Math.max(0, Math.round((100 - t) * 10) / 10), levels: starterLevels() }]);
          setLive("Criterion added");
        }}
      >
        Add criterion
      </Button>

      {serverErrors.length > 0 && (
        <Alert tone="danger" title="The rubric couldn't be saved">
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {serverErrors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </Alert>
      )}
      {touched && problems.length > 0 && (
        <Alert tone="warning" title="A few things to fix">
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {problems.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </Alert>
      )}

      <div
        className={cn(
          "sticky z-10 flex flex-col-reverse gap-2 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-lift backdrop-blur sm:flex-row sm:items-center sm:justify-between",
          inDialog ? "-bottom-6" : "bottom-20 lg:bottom-4",
        )}
      >
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Wand2 className="size-4 text-fuchsia-600" aria-hidden />
          The AI grader scores each criterion against these descriptors; assessors confirm or override.
        </p>
        <div className="flex shrink-0 gap-2">
          {onCancel && (
            <Button variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button
            variant="primary"
            leftIcon={<Save />}
            loading={save.isPending}
            disabled={!dirty && !!rubric}
            onClick={() => {
              setTouched(true);
              setServerErrors([]);
              if (problems.length) return;
              save.mutate();
            }}
          >
            {submitLabel ?? (rubric ? "Save rubric" : "Create rubric")}
          </Button>
        </div>
      </div>
    </div>
  );
}
