"use client";

import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button, SimpleSelect, cn, colorClasses, CATEGORY_COLORS } from "@praxis/ui";
import { ArrowDown, ArrowUp, GripVertical, Link2, MousePointer2, X } from "lucide-react";
import * as React from "react";
import { type Choice, type InputProps, choices } from "./inputs";

/* ------------------------------------------------------------------ ordering */

function SortableRow({ item, index, total, onMove, disabled }: { item: Choice; index: number; total: number; onMove: (from: number, to: number) => void; disabled?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, disabled });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex items-center gap-3 rounded-2xl border bg-white p-3 text-sm shadow-sm transition-shadow",
        isDragging ? "z-10 border-brand-400 shadow-lift ring-2 ring-brand-500/30" : "border-slate-200",
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        disabled={disabled}
        aria-label={`Reorder “${item.text}”, position ${index + 1} of ${total}. Press Space to pick up, arrow keys to move, Space to drop.`}
        className="grid size-9 shrink-0 cursor-grab touch-none place-items-center rounded-xl bg-slate-100 text-slate-500 hover:bg-slate-200 focus-visible:focus-ring active:cursor-grabbing"
      >
        <GripVertical className="size-4" aria-hidden />
      </button>
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-50 font-display text-xs font-bold text-brand-700">{index + 1}</span>
      <span className="min-w-0 flex-1 text-slate-800">{item.text}</span>
      <span className="flex shrink-0 gap-1">
        <Button variant="ghost" size="icon-sm" aria-label={`Move “${item.text}” up`} disabled={disabled || index === 0} onClick={() => onMove(index, index - 1)}>
          <ArrowUp />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label={`Move “${item.text}” down`} disabled={disabled || index === total - 1} onClick={() => onMove(index, index + 1)}>
          <ArrowDown />
        </Button>
      </span>
    </li>
  );
}

export function OrderingInput({ question, value, onChange, disabled, labelledBy }: InputProps) {
  const items = choices(question.options.items);
  const byId = new Map(items.map((i) => [i.id, i]));
  const saved = Array.isArray(value?.order) ? (value!.order as unknown[]).map(String).filter((id) => byId.has(id)) : [];
  const order = saved.length === items.length ? saved : items.map((i) => i.id);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const [live, setLive] = React.useState("");
  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length) return;
    const next = arrayMove(order, from, to);
    onChange({ order: next });
    setLive(`${byId.get(order[from]!)?.text} moved to position ${to + 1}`);
  };
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    move(order.indexOf(String(e.active.id)), order.indexOf(String(e.over.id)));
  };
  return (
    <div aria-labelledby={labelledBy} role="group">
      <p className="mb-3 text-xs font-medium text-slate-500">Drag the handles (or use the arrow buttons) to put the items in the correct order.</p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          <ol className="space-y-2">
            {order.map((id, i) => (
              <SortableRow key={id} item={byId.get(id)!} index={i} total={order.length} onMove={move} disabled={disabled} />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
      {saved.length !== items.length && !disabled && (
        <Button variant="ghost" size="sm" className="mt-2" onClick={() => onChange({ order })}>
          This order is my answer
        </Button>
      )}
      <p className="sr-only" aria-live="polite">
        {live}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ matching */

const PAIR_COLORS = CATEGORY_COLORS;

function DraggableAnswer({ item, disabled, used }: { item: Choice; disabled?: boolean; used?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `r:${item.id}`, disabled });
  return (
    <button
      type="button"
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={cn(
        "flex w-full touch-none items-center gap-2 rounded-xl border bg-white px-3 py-2 text-left text-sm font-medium shadow-sm transition focus-visible:focus-ring",
        isDragging ? "z-20 cursor-grabbing border-brand-400 shadow-lift" : "cursor-grab border-slate-200 hover:border-brand-300",
        used && !isDragging && "opacity-50",
      )}
    >
      <GripVertical className="size-4 shrink-0 text-slate-400" aria-hidden />
      {item.text}
    </button>
  );
}

function DropSlot({ id, children, active }: { id: string; children: React.ReactNode; active: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "min-h-11 flex-1 rounded-xl border-2 border-dashed p-1.5 transition",
        isOver ? "border-brand-500 bg-brand-50" : active ? "border-transparent bg-slate-50" : "border-slate-300 bg-white",
      )}
    >
      {children}
    </div>
  );
}

export function MatchingInput({ question, value, onChange, disabled, labelledBy }: InputProps) {
  const left = choices(question.options.left);
  const right = choices(question.options.right);
  const pairs: Record<string, string> = value?.pairs && typeof value.pairs === "object" ? (value.pairs as Record<string, string>) : {};
  const [mode, setMode] = React.useState<"select" | "drag">("select");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor));
  const set = (l: string, r: string | null) => {
    const next = { ...pairs };
    if (r === null) delete next[l];
    else {
      for (const k of Object.keys(next)) if (next[k] === r && k !== l && question.options.unique !== false) delete next[k];
      next[l] = r;
    }
    onChange({ pairs: next });
  };
  const rightText = (id: string) => right.find((r) => r.id === id)?.text ?? "";
  const used = new Set(Object.values(pairs));

  return (
    <div role="group" aria-labelledby={labelledBy}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-slate-500">Match each item on the left with the best answer.</p>
        <div className="inline-flex rounded-lg bg-slate-100 p-0.5" role="group" aria-label="Matching mode">
          {(["select", "drag"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={cn("inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition focus-visible:focus-ring", mode === m ? "bg-white text-slate-900 shadow-sm" : "text-slate-600")}
            >
              {m === "select" ? <Link2 className="size-3.5" aria-hidden /> : <MousePointer2 className="size-3.5" aria-hidden />}
              {m === "select" ? "Choose" : "Drag"}
            </button>
          ))}
        </div>
      </div>

      {mode === "select" ? (
        <ul className="space-y-2.5">
          {left.map((l, i) => {
            const c = colorClasses(PAIR_COLORS[i % PAIR_COLORS.length]!);
            return (
              <li key={l.id} className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-3 sm:flex-row sm:items-center">
                <span className="flex min-w-0 flex-1 items-center gap-2.5 text-sm font-medium text-slate-800">
                  <span className={cn("size-2.5 shrink-0 rounded-full", c.solid)} aria-hidden />
                  <span id={`m-${question.id}-${l.id}`}>{l.text}</span>
                </span>
                <SimpleSelect
                  className="h-10 sm:w-64"
                  aria-label={`Match for ${l.text}`}
                  value={pairs[l.id] ?? "__none"}
                  disabled={disabled}
                  onValueChange={(v) => set(l.id, v === "__none" ? null : v)}
                  options={[{ value: "__none", label: "Choose a match…" }, ...right.map((r) => ({ value: r.id, label: r.text }))]}
                />
              </li>
            );
          })}
        </ul>
      ) : (
        <DndContext
          sensors={sensors}
          onDragEnd={(e) => {
            if (!e.over) return;
            const r = String(e.active.id).replace(/^r:/, "");
            const l = String(e.over.id).replace(/^l:/, "");
            set(l, r);
          }}
        >
          <div className="grid gap-4 md:grid-cols-[1fr_16rem]">
            <ul className="space-y-2.5">
              {left.map((l, i) => {
                const c = colorClasses(PAIR_COLORS[i % PAIR_COLORS.length]!);
                const r = pairs[l.id];
                return (
                  <li key={l.id} className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-3 sm:flex-row sm:items-center">
                    <span className="flex min-w-0 flex-1 items-center gap-2.5 text-sm font-medium text-slate-800">
                      <span className={cn("size-2.5 shrink-0 rounded-full", c.solid)} aria-hidden />
                      {l.text}
                    </span>
                    <DropSlot id={`l:${l.id}`} active={!!r}>
                      {r ? (
                        <span className={cn("flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm font-medium ring-1 ring-inset", c.soft, c.text, c.ring)}>
                          <span className="flex-1">{rightText(r)}</span>
                          <button type="button" onClick={() => set(l.id, null)} aria-label={`Clear match for ${l.text}`} className="grid size-6 place-items-center rounded-md hover:bg-white/70 focus-visible:focus-ring" disabled={disabled}>
                            <X className="size-3.5" aria-hidden />
                          </button>
                        </span>
                      ) : (
                        <span className="block px-2 py-1.5 text-xs text-slate-400">Drop an answer here</span>
                      )}
                    </DropSlot>
                  </li>
                );
              })}
            </ul>
            <div className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Answers</p>
              <ul className="space-y-2">
                {right.map((r) => (
                  <li key={r.id}>
                    <DraggableAnswer item={r} disabled={disabled} used={used.has(r.id)} />
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </DndContext>
      )}
    </div>
  );
}
