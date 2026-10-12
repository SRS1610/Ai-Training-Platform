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
import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  FormField,
  Input,
  Progress,
  SimpleSelect,
  Skeleton,
  Spinner,
  cn,
  colorClasses,
  colorFor,
} from "@praxis/ui";
import { useQueries, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, Eye, GripVertical, Library, ListPlus, Pencil, Plus, Search, Shuffle, Trash2 } from "lucide-react";
import * as React from "react";
import { api } from "@/lib/api";
import { uid, useDebounced } from "../hooks";
import { ak } from "../keys";
import { QUESTION_DIFFICULTY, QUESTION_TYPES, questionMeta, type QuestionTypeKey } from "../meta";
import { QuestionEditorDialog } from "../questions/question-editor";
import { QuestionPreview } from "../questions/question-preview";
import { DifficultyDots, NumberInput, TagInput, TypeChip } from "../shared";
import type { Bank, ItemFilters, ItemIn, ItemOut, Page, Question } from "../types";

/* ------------------------------------------------------------------ local model */

export interface LocalItem extends ItemIn {
  key: string;
}

export function toLocal(items: ItemOut[]): LocalItem[] {
  return [...items]
    .sort((a, b) => a.position - b.position)
    .map((i) => ({
      key: i.id,
      question_id: i.question_id ?? null,
      bank_id: i.question_id ? null : (i.bank_id ?? null),
      draw_count: i.draw_count,
      filters: i.filters ?? {},
      weight: i.weight,
    }));
}

export function toItemsIn(items: LocalItem[]): ItemIn[] {
  return items.map((i) => {
    const filters: ItemFilters = {};
    if (i.filters.difficulty?.length) filters.difficulty = i.filters.difficulty;
    if (i.filters.tags?.length) filters.tags = i.filters.tags;
    if (i.filters.question_types?.length) filters.question_types = i.filters.question_types;
    return i.question_id
      ? { question_id: i.question_id, bank_id: null, draw_count: 1, filters: {}, weight: i.weight }
      : { question_id: null, bank_id: i.bank_id, draw_count: i.draw_count, filters, weight: i.weight };
  });
}

export function plainText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`[\]()!]/g, "")
    .replace(/\{\{\w+\}\}/g, "____")
    .replace(/\s+/g, " ")
    .trim();
}

/** All active questions in a bank (first 200) — used to size random pools client-side. */
export function useBankPool(bankId: string | null | undefined) {
  return useQuery({
    queryKey: ak.questions.list({ bank_id: bankId, pool: true }),
    enabled: !!bankId,
    queryFn: ({ signal }) => api.get<Page<Question>>("/questions", { signal, query: { bank_id: bankId!, status: "active", page_size: 200 } }),
    staleTime: 30_000,
  });
}

/** Mirrors assessments.service._pool_stmt: difficulty IN, tags has_any, type IN. */
export function matchPool(questions: Question[], f: ItemFilters): Question[] {
  return questions.filter(
    (q) =>
      (!f.difficulty?.length || f.difficulty.includes(q.difficulty)) &&
      (!f.tags?.length || f.tags.some((t) => q.tags.includes(t))) &&
      (!f.question_types?.length || f.question_types.includes(q.question_type)),
  );
}

/* ------------------------------------------------------------------ item cards */

function Handle({ label, ...props }: { label: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className="grid size-8 shrink-0 cursor-grab touch-none place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:focus-ring active:cursor-grabbing"
      aria-label={label}
      {...props}
    >
      <GripVertical className="size-4" aria-hidden />
    </button>
  );
}

function WeightInput({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-slate-500">
      <span aria-hidden>Weight</span>
      <NumberInput
        inputSize="sm"
        aria-label={label}
        value={value}
        min={0.1}
        max={100}
        step={0.5}
        onChange={(v) => onChange(v && v > 0 ? Math.min(100, v) : 1)}
        className="h-8 w-[4.5rem] text-sm tabular-nums"
      />
    </span>
  );
}

function FixedCard({
  item,
  index,
  question,
  loading,
  bankTitle,
  problem,
  onWeight,
  onRemove,
  onPreview,
}: {
  item: LocalItem;
  index: number;
  question?: Question;
  loading: boolean;
  bankTitle?: string;
  problem?: string;
  onWeight: (w: number) => void;
  onRemove: () => void;
  onPreview: () => void;
}) {
  const sortable = useSortable({ id: item.key });
  const meta = questionMeta(question?.question_type);
  const c = colorClasses(meta.color);
  return (
    <li
      ref={sortable.setNodeRef}
      style={{ transform: CSS.Translate.toString(sortable.transform), transition: sortable.transition }}
      className={cn(
        "group relative flex flex-col gap-3 rounded-2xl border bg-white p-3 shadow-sm transition-shadow sm:flex-row sm:items-center",
        problem ? "border-rose-300 ring-2 ring-rose-100" : "border-slate-200 hover:shadow-soft",
        sortable.isDragging && "z-10 shadow-lift ring-2 ring-brand-400",
      )}
    >
      <span className={cn("absolute inset-y-3 left-0 w-1 rounded-r-full", c.solid)} aria-hidden />
      <div className="flex min-w-0 flex-1 items-center gap-2.5 pl-1">
        <Handle label={`Reorder item ${index + 1}`} {...sortable.attributes} {...sortable.listeners} />
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-slate-100 text-xs font-bold tabular-nums text-slate-600" aria-hidden>
          {index + 1}
        </span>
        {loading ? (
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        ) : !question ? (
          <p className="flex-1 text-sm font-medium text-rose-700">This question was deleted — remove it before publishing.</p>
        ) : (
          <>
            <TypeChip meta={meta} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-sm font-medium text-slate-900">{plainText(question.prompt) || "Untitled question"}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-muted-foreground">
                <span className={cn("font-semibold", c.text)}>{meta.label}</span>
                <span>·</span>
                <span className="tabular-nums">
                  {question.points} pt{question.points === 1 ? "" : "s"}
                </span>
                <DifficultyDots value={question.difficulty} />
                {bankTitle && (
                  <span className="inline-flex items-center gap-1">
                    <Library className="size-3" aria-hidden /> {bankTitle}
                  </span>
                )}
                {question.status !== "active" && (
                  <Badge tone="warning" size="sm">
                    {question.status}
                  </Badge>
                )}
              </p>
            </div>
          </>
        )}
      </div>
      {problem && <p className="text-xs font-semibold text-rose-700 sm:hidden">{problem}</p>}
      <div className="flex shrink-0 items-center justify-end gap-1.5 pl-11 sm:pl-0">
        <WeightInput value={item.weight} onChange={onWeight} label={`Weight for item ${index + 1}`} />
        <Button variant="ghost" size="icon-sm" aria-label={`Preview item ${index + 1}`} onClick={onPreview} disabled={!question}>
          <Eye />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label={`Remove item ${index + 1}`} onClick={onRemove}>
          <Trash2 />
        </Button>
      </div>
    </li>
  );
}

function PoolCard({
  item,
  index,
  bank,
  problem,
  onWeight,
  onEdit,
  onRemove,
}: {
  item: LocalItem;
  index: number;
  bank?: Bank;
  problem?: string;
  onWeight: (w: number) => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const sortable = useSortable({ id: item.key });
  const pool = useBankPool(item.bank_id);
  const matching = pool.data ? matchPool(pool.data.items, item.filters).length : null;
  const short = matching !== null && matching < item.draw_count;
  const color = colorFor(bank?.title ?? "pool");
  const c = colorClasses(color);
  const f = item.filters;
  return (
    <li
      ref={sortable.setNodeRef}
      style={{ transform: CSS.Translate.toString(sortable.transform), transition: sortable.transition }}
      className={cn(
        "relative overflow-hidden rounded-2xl border bg-gradient-to-r p-3 shadow-sm",
        c.tint,
        short || problem ? "border-amber-300 ring-2 ring-amber-100" : "border-slate-200",
        sortable.isDragging && "z-10 shadow-lift ring-2 ring-brand-400",
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <Handle label={`Reorder item ${index + 1}`} {...sortable.attributes} {...sortable.listeners} />
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-white/80 text-xs font-bold tabular-nums text-slate-600 shadow-sm" aria-hidden>
            {index + 1}
          </span>
          <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-white shadow-sm", c.gradient)} aria-hidden>
            <Shuffle className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-900">
              Random pool · draw <span className="tabular-nums">{item.draw_count}</span> from{" "}
              <span className={c.text}>{bank?.title ?? "a bank"}</span>
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {f.difficulty?.length ? (
                <span className="rounded-full bg-white px-2 py-0.5 text-2xs font-semibold text-slate-700 ring-1 ring-inset ring-slate-200">
                  Difficulty {f.difficulty.join(", ")}
                </span>
              ) : null}
              {f.question_types?.slice(0, f.question_types.length > 3 ? 2 : 3).map((t) => (
                <span key={t} className="rounded-full bg-white px-2 py-0.5 text-2xs font-semibold text-slate-700 ring-1 ring-inset ring-slate-200">
                  {questionMeta(t).label}
                </span>
              ))}
              {f.question_types && f.question_types.length > 3 && (
                <span
                  className="rounded-full bg-white px-2 py-0.5 text-2xs font-semibold text-slate-700 ring-1 ring-inset ring-slate-200"
                  title={f.question_types.map((t) => questionMeta(t).label).join(", ")}
                >
                  +{f.question_types.length - 2} more types
                </span>
              )}
              {f.tags?.map((t) => (
                <span key={t} className="rounded-full bg-white px-2 py-0.5 text-2xs font-semibold text-brand-700 ring-1 ring-inset ring-brand-200">
                  #{t}
                </span>
              ))}
              {!f.difficulty?.length && !f.question_types?.length && !f.tags?.length && <span className="text-2xs text-muted-foreground">Any active question in the bank</span>}
              <span className={cn("text-2xs font-semibold", short ? "text-amber-800" : "text-slate-600")}>
                {matching === null ? "Counting…" : `· ${matching} eligible`}
              </span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-end gap-1.5">
          <WeightInput value={item.weight} onChange={onWeight} label={`Weight for item ${index + 1}`} />
          <Button variant="secondary" size="sm" leftIcon={<Pencil />} onClick={onEdit}>
            Edit pool
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label={`Remove item ${index + 1}`} onClick={onRemove}>
            <Trash2 />
          </Button>
        </div>
      </div>
      {(short || problem) && (
        <p className="mt-2 flex items-center gap-1.5 rounded-xl bg-white/80 px-3 py-1.5 text-xs font-medium text-amber-900">
          <AlertTriangle className="size-3.5 shrink-0 text-amber-600" aria-hidden />
          {problem ?? `Only ${matching} active question${matching === 1 ? "" : "s"} match — lower the draw count or widen the filters.`}
        </p>
      )}
    </li>
  );
}

/* ------------------------------------------------------------------ question picker */

function QuestionPicker({
  open,
  onOpenChange,
  banks,
  existing,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  banks: Bank[];
  existing: Set<string>;
  onAdd: (ids: string[]) => void;
}) {
  const [bankId, setBankId] = React.useState<string>("");
  const [q, setQ] = React.useState("");
  const [type, setType] = React.useState("all");
  const [picked, setPicked] = React.useState<string[]>([]);
  const [focus, setFocus] = React.useState<Question | null>(null);
  const [newOpen, setNewOpen] = React.useState(false);
  const query = useDebounced(q, 250);
  React.useEffect(() => {
    if (open) {
      setPicked([]);
      setFocus(null);
      setQ("");
      setType("all");
      setBankId((b) => b || banks[0]?.id || "");
    }
  }, [open, banks]);
  const list = useQuery({
    queryKey: ak.questions.list({ bank_id: bankId, q: query, type, picker: true }),
    enabled: open && !!bankId,
    queryFn: ({ signal }) =>
      api.get<Page<Question>>("/questions", {
        signal,
        query: { bank_id: bankId, q: query || undefined, question_type: type === "all" ? undefined : type, page_size: 100 },
      }),
    placeholderData: (p) => p,
  });
  const items = list.data?.items ?? [];
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl gap-0 p-0" aria-describedby={undefined}>
        <div className="h-1.5 rounded-t-3xl bg-gradient-to-r from-sky-400 via-indigo-500 to-violet-500" aria-hidden />
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex min-h-0 flex-col gap-4 p-5 sm:p-6">
            <DialogHeader>
              <DialogTitle>Add questions</DialogTitle>
              <DialogDescription>Pick fixed questions from a bank. Every learner gets these, in this order unless shuffling is on.</DialogDescription>
            </DialogHeader>
            {banks.length === 0 ? (
              <EmptyState bordered size="sm" illustration="inbox" title="No question banks yet" description="Create a bank and add questions first." />
            ) : (
              <>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_10rem]">
                  <SimpleSelect aria-label="Question bank" value={bankId} onValueChange={(v) => setBankId(v)} options={banks.map((b) => ({ value: b.id, label: `${b.title} (${b.question_count})` }))} />
                  <Input leftIcon={<Search />} placeholder="Search prompts…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search questions" />
                  <SimpleSelect
                    aria-label="Question type"
                    value={type}
                    onValueChange={setType}
                    options={[{ value: "all", label: "All types" }, ...(Object.keys(QUESTION_TYPES) as QuestionTypeKey[]).map((t) => ({ value: t, label: QUESTION_TYPES[t].label }))]}
                  />
                </div>
                <div className="max-h-[50vh] min-h-[16rem] overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50/60 p-1.5 scrollbar-thin" role="listbox" aria-multiselectable aria-label="Questions">
                  {list.isLoading ? (
                    <div className="grid h-48 place-items-center">
                      <Spinner />
                    </div>
                  ) : items.length === 0 ? (
                    <p className="px-3 py-10 text-center text-sm text-muted-foreground">No questions match.</p>
                  ) : (
                    items.map((qq) => {
                      const m = questionMeta(qq.question_type);
                      const added = existing.has(qq.id);
                      const on = picked.includes(qq.id);
                      return (
                        <button
                          key={qq.id}
                          type="button"
                          role="option"
                          aria-selected={on || added}
                          aria-disabled={added}
                          onClick={() => {
                            setFocus(qq);
                            if (!added) toggle(qq.id);
                          }}
                          onFocus={() => setFocus(qq)}
                          className={cn(
                            "mb-1 flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors focus-visible:focus-ring",
                            on ? "bg-white shadow-sm ring-1 ring-brand-300" : "hover:bg-white",
                            added && "opacity-60",
                          )}
                        >
                          <span
                            className={cn(
                              "mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border-2",
                              on || added ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white",
                            )}
                            aria-hidden
                          >
                            {(on || added) && <Check className="size-3" />}
                          </span>
                          <TypeChip meta={m} size="xs" />
                          <span className="min-w-0 flex-1">
                            <span className="line-clamp-2 block text-sm font-medium text-slate-900">{plainText(qq.prompt)}</span>
                            <span className="mt-0.5 flex items-center gap-2 text-2xs text-muted-foreground">
                              {m.label} · {qq.points} pt{qq.points === 1 ? "" : "s"} <DifficultyDots value={qq.difficulty} />
                              {qq.status !== "active" && <span className="font-semibold text-amber-700">{qq.status}</span>}
                              {added && <span className="font-semibold text-brand-700">Already added</span>}
                            </span>
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </>
            )}
            <DialogFooter className="items-center sm:justify-between">
              <Button variant="ghost" leftIcon={<Plus />} onClick={() => setNewOpen(true)} disabled={!bankId}>
                Write a new question
              </Button>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <Button variant="secondary" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button
                  leftIcon={<ListPlus />}
                  disabled={!picked.length}
                  onClick={() => {
                    onAdd(picked);
                    onOpenChange(false);
                  }}
                >
                  Add {picked.length || ""} question{picked.length === 1 ? "" : "s"}
                </Button>
              </div>
            </DialogFooter>
          </div>
          <aside className="hidden border-l border-slate-100 bg-gradient-to-b from-slate-50 to-white p-5 lg:block" aria-label="Question preview">
            <p className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-violet-100 px-2.5 py-1 text-2xs font-bold uppercase tracking-wider text-violet-700">
              <Eye className="size-3.5" aria-hidden /> Learner preview
            </p>
            {focus ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
                <QuestionPreview type={focus.question_type} prompt={focus.prompt} options={focus.options} points={focus.points} />
              </div>
            ) : (
              <p className="rounded-2xl border-2 border-dashed border-slate-200 p-6 text-center text-sm text-muted-foreground">Select a question to preview it as learners see it.</p>
            )}
          </aside>
        </div>
        {newOpen && (
          <QuestionEditorDialog
            open={newOpen}
            onOpenChange={setNewOpen}
            bankId={bankId}
            onSaved={(nq) => {
              onAdd([nq.id]);
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ pool dialog */

function PoolDialog({
  open,
  onOpenChange,
  banks,
  initial,
  onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  banks: Bank[];
  initial: LocalItem | null;
  onSave: (item: LocalItem) => void;
}) {
  const [bankId, setBankId] = React.useState("");
  const [draw, setDraw] = React.useState<number | null>(5);
  const [filters, setFilters] = React.useState<ItemFilters>({});
  React.useEffect(() => {
    if (open) {
      setBankId(initial?.bank_id ?? banks[0]?.id ?? "");
      setDraw(initial?.draw_count ?? 5);
      setFilters(initial?.filters ?? {});
    }
  }, [open, initial, banks]);
  const pool = useBankPool(bankId || null);
  const all = pool.data?.items ?? [];
  const matching = matchPool(all, filters);
  const typesInBank = [...new Set(all.map((q) => q.question_type))];
  const tagsInBank = [...new Set(all.flatMap((q) => q.tags))].sort();
  const n = draw ?? 0;
  const ok = !!bankId && n >= 1 && n <= 500;
  const short = pool.data && matching.length < n;
  const toggleNum = (key: "difficulty", v: number) => {
    const cur = filters[key] ?? [];
    setFilters({ ...filters, [key]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v].sort() });
  };
  const toggleType = (t: string) => {
    const cur = filters.question_types ?? [];
    setFilters({ ...filters, question_types: cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t] });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <span className="mb-1 grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-glow">
            <Shuffle className="size-5" aria-hidden />
          </span>
          <DialogTitle>{initial ? "Edit random pool" : "Add a random pool"}</DialogTitle>
          <DialogDescription>Each attempt draws a fresh random set from the bank — great for retakes and integrity.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_9rem]">
            <FormField label="Question bank" required>
              {(aria) => <SimpleSelect {...aria} value={bankId} onValueChange={setBankId} options={banks.map((b) => ({ value: b.id, label: `${b.title} (${b.question_count})` }))} placeholder="Choose a bank" />}
            </FormField>
            <FormField label="Draw" required error={draw !== null && (draw < 1 || draw > 500) ? "1–500" : null}>
              {(aria) => <NumberInput {...aria} value={draw} min={1} max={500} onChange={setDraw} suffix="questions" />}
            </FormField>
          </div>
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-slate-800">Difficulty</legend>
            <div className="flex flex-wrap gap-1.5">
              {QUESTION_DIFFICULTY.map((d, i) => {
                const on = filters.difficulty?.includes(i + 1) ?? false;
                const c = colorClasses(d.color);
                return (
                  <button
                    key={d.label}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => toggleNum("difficulty", i + 1)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset transition-colors focus-visible:focus-ring",
                      on ? cn(c.soft, c.text, c.ring) : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50",
                    )}
                  >
                    <span className={cn("size-2 rounded-full", on ? c.solid : "bg-slate-300")} aria-hidden />
                    {i + 1} · {d.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-2xs text-muted-foreground">None selected = any difficulty.</p>
          </fieldset>
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-slate-800">Question types</legend>
            {typesInBank.length === 0 ? (
              <p className="text-xs text-muted-foreground">{pool.isLoading ? "Loading…" : "This bank has no active questions yet."}</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {typesInBank.map((t) => {
                  const m = questionMeta(t);
                  const on = filters.question_types?.includes(t) ?? false;
                  const c = colorClasses(m.color);
                  return (
                    <button
                      key={t}
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      onClick={() => toggleType(t)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full py-1 pl-1 pr-2.5 text-xs font-semibold ring-1 ring-inset transition-colors focus-visible:focus-ring",
                        on ? cn(c.soft, c.text, c.ring) : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50",
                      )}
                    >
                      <TypeChip meta={m} size="xs" className="size-5 rounded-full" />
                      {m.label}
                    </button>
                  );
                })}
              </div>
            )}
          </fieldset>
          <FormField label="Tags" hint={tagsInBank.length ? `In this bank: ${tagsInBank.slice(0, 12).join(", ")}${tagsInBank.length > 12 ? "…" : ""}` : "Questions with any of these tags are eligible."}>
            {(aria) => <TagInput id={aria.id} aria-describedby={aria["aria-describedby"]} lowercase value={filters.tags ?? []} onChange={(tags) => setFilters({ ...filters, tags })} />}
          </FormField>
          <div className={cn("rounded-2xl border p-4", short ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50")} aria-live="polite">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className={cn("font-semibold", short ? "text-amber-900" : "text-emerald-900")}>
                {pool.isLoading ? "Counting eligible questions…" : `${matching.length} of ${all.length} active questions match`}
              </span>
              <span className={cn("text-xs font-medium", short ? "text-amber-800" : "text-emerald-800")}>{short ? `Need ${n}` : n ? `Drawing ${n}` : ""}</span>
            </div>
            <Progress className="mt-2 bg-white" size="sm" color={short ? "amber" : "emerald"} value={all.length ? (matching.length / all.length) * 100 : 0} aria-label="Matching questions" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!ok}
            leftIcon={initial ? <Check /> : <Plus />}
            onClick={() => {
              onSave({ key: initial?.key ?? uid("pool"), question_id: null, bank_id: bankId, draw_count: n, filters, weight: initial?.weight ?? 1 });
              onOpenChange(false);
            }}
          >
            {initial ? "Save pool" : "Add pool"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ preview dialog */

function PreviewDialog({ question, onOpenChange }: { question: Question | null; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={!!question} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Learner preview</DialogTitle>
          <DialogDescription>Exactly what learners see — answer keys are never sent to them.</DialogDescription>
        </DialogHeader>
        {question && (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
            <QuestionPreview type={question.question_type} prompt={question.prompt} options={question.options} points={question.points} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ editor */

export interface ItemsSummary {
  fixed: number;
  pooled: number;
  shortPools: number;
  points: number;
  typeMix: Map<string, number>;
}

/**
 * Ordered assessment items: fixed questions and random pools. Drag (pointer or keyboard) to reorder;
 * the parent saves the full list (PUT /assessments/{id}/items).
 */
export function ItemsEditor({
  items,
  onChange,
  banks,
  problems,
  onSummary,
}: {
  items: LocalItem[];
  onChange: (next: LocalItem[], announce?: string) => void;
  banks: Bank[];
  problems: Record<string, string>;
  onSummary?: (s: ItemsSummary) => void;
}) {
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [pool, setPool] = React.useState<{ item: LocalItem | null } | null>(null);
  const [preview, setPreview] = React.useState<Question | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const bankById = new Map(banks.map((b) => [b.id, b]));

  const fixedIds = items.filter((i) => i.question_id).map((i) => i.question_id!);
  const questionQs = useQueries({
    queries: fixedIds.map((id) => ({
      queryKey: ak.questions.detail(id),
      queryFn: ({ signal }: { signal: AbortSignal }) => api.get<Question>(`/questions/${id}`, { signal }),
      staleTime: 60_000,
      retry: false,
    })),
  });
  const qById = new Map<string, { data?: Question; loading: boolean }>();
  fixedIds.forEach((id, i) => qById.set(id, { data: questionQs[i]?.data, loading: !!questionQs[i]?.isLoading }));

  // Summary for the sidebar.
  const poolBanks = [...new Set(items.filter((i) => i.bank_id).map((i) => i.bank_id!))];
  const poolQs = useQueries({
    queries: poolBanks.map((b) => ({
      queryKey: ak.questions.list({ bank_id: b, pool: true }),
      queryFn: ({ signal }: { signal: AbortSignal }) => api.get<Page<Question>>("/questions", { signal, query: { bank_id: b, status: "active", page_size: 200 } }),
      staleTime: 30_000,
    })),
  });
  const poolByBank = new Map(poolBanks.map((b, i) => [b, poolQs[i]?.data?.items]));
  const summaryKey = JSON.stringify([items, questionQs.map((q) => q.dataUpdatedAt), poolQs.map((q) => q.dataUpdatedAt)]);
  React.useEffect(() => {
    if (!onSummary) return;
    const mix = new Map<string, number>();
    let points = 0;
    let pooled = 0;
    let shortPools = 0;
    for (const it of items) {
      if (it.question_id) {
        const q = qById.get(it.question_id)?.data;
        if (q) {
          mix.set(q.question_type, (mix.get(q.question_type) ?? 0) + 1);
          points += q.points * it.weight;
        }
      } else if (it.bank_id) {
        const all = poolByBank.get(it.bank_id);
        const m = all ? matchPool(all, it.filters) : [];
        const drawn = Math.min(it.draw_count, all ? m.length : it.draw_count);
        if (all && m.length < it.draw_count) shortPools++;
        pooled += drawn;
        const avg = m.length ? m.reduce((s, q) => s + q.points, 0) / m.length : 1;
        points += avg * drawn * it.weight;
        for (const q of m) mix.set(q.question_type, (mix.get(q.question_type) ?? 0) + drawn / Math.max(1, m.length));
      }
    }
    onSummary({ fixed: items.filter((i) => i.question_id).length, pooled, shortPools, points, typeMix: mix });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summaryKey]);

  const titleOf = (key: string | number) => {
    const idx = items.findIndex((i) => i.key === key);
    return `item ${idx + 1}`;
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${titleOf(active.id)}. Use the up and down arrow keys to move it, space to drop, escape to cancel.`,
    onDragOver: ({ active, over }) => (over ? `${titleOf(active.id)} is over position ${items.findIndex((i) => i.key === over.id) + 1}.` : `${titleOf(active.id)} is not over a position.`),
    onDragEnd: ({ active, over }) => (over ? `Dropped ${titleOf(active.id)} at position ${items.findIndex((i) => i.key === over.id) + 1}.` : `Dropped ${titleOf(active.id)}.`),
    onDragCancel: ({ active }) => `Moving ${titleOf(active.id)} was cancelled.`,
  };
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const a = items.findIndex((i) => i.key === e.active.id);
    const b = items.findIndex((i) => i.key === e.over!.id);
    onChange(arrayMove(items, a, b), `Moved to position ${b + 1}`);
  };
  const setWeight = (key: string, weight: number) => onChange(items.map((i) => (i.key === key ? { ...i, weight } : i)));
  const remove = (key: string) => onChange(items.filter((i) => i.key !== key), "Item removed");

  return (
    <div className="space-y-3">
      {items.length === 0 ? (
        <EmptyState
          bordered
          illustration="inbox"
          title="No questions yet"
          description="Add fixed questions from your banks, or random pools that draw a fresh set for every attempt."
          action={
            <Button leftIcon={<ListPlus />} onClick={() => setPickerOpen(true)}>
              Add questions
            </Button>
          }
          secondaryAction={
            <Button variant="soft" leftIcon={<Shuffle />} onClick={() => setPool({ item: null })}>
              Add random pool
            </Button>
          }
        />
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd} accessibility={{ announcements }}>
          <SortableContext items={items.map((i) => i.key)} strategy={verticalListSortingStrategy}>
            <ol className="space-y-2" aria-label="Assessment items">
              {items.map((it, i) =>
                it.question_id ? (
                  <FixedCard
                    key={it.key}
                    item={it}
                    index={i}
                    question={qById.get(it.question_id)?.data}
                    loading={!!qById.get(it.question_id)?.loading}
                    bankTitle={bankById.get(qById.get(it.question_id)?.data?.bank_id ?? "")?.title}
                    problem={problems[it.key]}
                    onWeight={(w) => setWeight(it.key, w)}
                    onRemove={() => remove(it.key)}
                    onPreview={() => setPreview(qById.get(it.question_id!)?.data ?? null)}
                  />
                ) : (
                  <PoolCard
                    key={it.key}
                    item={it}
                    index={i}
                    bank={bankById.get(it.bank_id ?? "")}
                    problem={problems[it.key]}
                    onWeight={(w) => setWeight(it.key, w)}
                    onEdit={() => setPool({ item: it })}
                    onRemove={() => remove(it.key)}
                  />
                ),
              )}
            </ol>
          </SortableContext>
        </DndContext>
      )}
      {items.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-sky-200 bg-sky-50/50 px-4 py-3 text-sm font-semibold text-sky-800 transition-colors hover:border-sky-300 hover:bg-sky-50 focus-visible:focus-ring"
          >
            <ListPlus className="size-4" aria-hidden /> Add questions
          </button>
          <button
            type="button"
            onClick={() => setPool({ item: null })}
            className="flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-amber-200 bg-amber-50/50 px-4 py-3 text-sm font-semibold text-amber-900 transition-colors hover:border-amber-300 hover:bg-amber-50 focus-visible:focus-ring"
          >
            <Shuffle className="size-4" aria-hidden /> Add random pool
          </button>
        </div>
      )}
      {Object.keys(problems).length > 0 && (
        <Alert tone="danger" title="Fix the highlighted items before publishing">
          {Object.values(problems).join(" · ")}
        </Alert>
      )}

      <QuestionPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        banks={banks}
        existing={new Set(fixedIds)}
        onAdd={(ids) =>
          onChange(
            [...items, ...ids.filter((id) => !fixedIds.includes(id)).map((id) => ({ key: uid("q"), question_id: id, bank_id: null, draw_count: 1, filters: {}, weight: 1 }))],
            `${ids.length} question${ids.length === 1 ? "" : "s"} added`,
          )
        }
      />
      <PoolDialog
        open={!!pool}
        onOpenChange={(o) => !o && setPool(null)}
        banks={banks}
        initial={pool?.item ?? null}
        onSave={(it) => onChange(pool?.item ? items.map((x) => (x.key === it.key ? it : x)) : [...items, it], pool?.item ? "Pool updated" : "Random pool added")}
      />
      <PreviewDialog question={preview} onOpenChange={(o) => !o && setPreview(null)} />
    </div>
  );
}
