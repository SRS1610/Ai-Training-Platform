"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Alert,
  Button,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  EmptyState,
  cn,
  toast,
} from "@praxis/ui";
import { useMutation } from "@tanstack/react-query";
import { Blocks, ChevronDown, GripVertical, Plus, Trash2 } from "lucide-react";
import * as React from "react";
import { api, errorMessage } from "@/lib/api";
import { useAutosave } from "../hooks";
import { ACTIVITY_TYPES, activityMeta, type ActivityTypeKey } from "../meta";
import { SaveIndicator, SectionCard, TypeChip } from "../shared";
import type { Activity } from "../types";
import { useBuilder } from "./builder-context";
import { ContentEditor, contentProblems, defaultContent } from "./content-editors";

type C = Record<string, unknown>;

function BlockCard({
  activity,
  index,
  onChange,
  onDelete,
}: {
  activity: Activity;
  index: number;
  onChange: (a: Activity) => void;
  onDelete: () => void;
}) {
  const { courseId, markDirty } = useBuilder();
  const meta = activityMeta(activity.activity_type);
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState({ title: activity.title ?? "", content: activity.content });
  const sortable = useSortable({ id: activity.id });
  const problems = contentProblems(activity.activity_type, draft.content);

  const save = useAutosave(async (d: { title: string; content: C }) => {
    const body: Record<string, unknown> = { title: d.title || null };
    if (!contentProblems(activity.activity_type, d.content).length) body.content = d.content;
    const out = await api.patch<Activity>(`/courses/${courseId}/activities/${activity.id}`, body);
    onChange(out);
    markDirty();
  });

  const update = (patch: Partial<typeof draft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    save.schedule(next);
  };

  return (
    <li
      ref={sortable.setNodeRef}
      style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }}
      className={cn(
        "rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow",
        sortable.isDragging && "z-10 shadow-lift ring-2 ring-brand-400",
        open && "ring-1 ring-brand-200",
      )}
    >
      <div className="flex items-center gap-2 p-2.5">
        <button
          type="button"
          className="grid size-8 shrink-0 cursor-grab touch-none place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:focus-ring active:cursor-grabbing"
          aria-label={`Reorder block ${index + 1}: ${draft.title || meta.label}`}
          {...sortable.attributes}
          {...sortable.listeners}
        >
          <GripVertical className="size-4" aria-hidden />
        </button>
        <TypeChip meta={meta} size="sm" />
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-1 text-left focus-visible:focus-ring"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-slate-900">{draft.title || meta.label}</span>
            <span className="block truncate text-2xs text-muted-foreground">
              {meta.label}
              {problems.length ? ` · ${problems[0]}` : ""}
            </span>
          </span>
          <ChevronDown className={cn("size-4 shrink-0 text-slate-500 transition-transform", open && "rotate-180")} aria-hidden />
        </button>
        {(save.status === "saving" || save.status === "error" || save.status === "dirty") && (
          <SaveIndicator status={save.status} error={save.error} onRetry={() => void save.flush()} className="hidden sm:flex" />
        )}
        <Button variant="ghost" size="icon-sm" aria-label={`Delete block ${index + 1}`} onClick={onDelete}>
          <Trash2 />
        </Button>
      </div>
      {open && (
        <div className="space-y-4 border-t border-slate-100 p-4">
          <label className="block text-sm font-medium text-slate-800">
            Block title <span className="font-normal text-muted-foreground">(optional)</span>
            <input
              className="mt-1.5 block h-10 w-full rounded-xl border border-input bg-white px-3 text-sm shadow-sm outline-none focus-visible:border-brand-500 focus-visible:ring-4 focus-visible:ring-brand-500/15"
              value={draft.title}
              onChange={(e) => update({ title: e.target.value })}
            />
          </label>
          <ContentEditor type={activity.activity_type} content={draft.content} onChange={(content) => update({ content })} />
          {problems.length > 0 && (
            <Alert tone="warning" title="This block isn't saved until it's complete">
              {problems.join(" · ")}
            </Alert>
          )}
          <SaveIndicator status={save.status} error={save.error} savedAt={save.savedAt} onRetry={() => void save.flush()} />
        </div>
      )}
    </li>
  );
}

function Composer({ type, onCancel, onCreate, busy }: { type: ActivityTypeKey; onCancel: () => void; onCreate: (c: { title: string; content: C }) => void; busy: boolean }) {
  const meta = ACTIVITY_TYPES[type];
  const [content, setContent] = React.useState<C>(() => defaultContent(type) ?? {});
  const [title, setTitle] = React.useState("");
  const problems = contentProblems(type, content);
  return (
    <div className="rounded-2xl border-2 border-dashed border-brand-300 bg-brand-50/30 p-4">
      <div className="mb-4 flex items-center gap-2.5">
        <TypeChip meta={meta} size="sm" />
        <p className="font-semibold text-slate-900">New {meta.label.toLowerCase()} block</p>
      </div>
      <div className="space-y-4">
        <label className="block text-sm font-medium text-slate-800">
          Block title <span className="font-normal text-muted-foreground">(optional)</span>
          <input
            className="mt-1.5 block h-10 w-full rounded-xl border border-input bg-white px-3 text-sm shadow-sm outline-none focus-visible:border-brand-500 focus-visible:ring-4 focus-visible:ring-brand-500/15"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <ContentEditor type={type} content={content} onChange={setContent} />
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        {problems.length > 0 && <p className="mr-auto text-xs font-medium text-amber-800">{problems[0]}</p>}
        <Button variant="secondary" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" leftIcon={<Plus />} disabled={problems.length > 0} loading={busy} onClick={() => onCreate({ title, content })}>
          Add block
        </Button>
      </div>
    </div>
  );
}

/** Ordered interactive blocks inside a lesson (drag to reorder → PUT activities/order). */
export function ActivitiesEditor({ lessonId, activities: initial, required }: { lessonId: string; activities: Activity[]; required?: boolean }) {
  const { courseId, setActivities } = useBuilder();
  const [items, setItems] = React.useState<Activity[]>(() => [...initial].sort((a, b) => a.position - b.position));
  const [composer, setComposer] = React.useState<ActivityTypeKey | null>(null);
  const [toDelete, setToDelete] = React.useState<Activity | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const commit = (next: Activity[]) => {
    setItems(next);
    setActivities(lessonId, next);
  };

  const reorder = useMutation({
    mutationFn: (ids: string[]) => api.put<Activity[]>(`/courses/${courseId}/lessons/${lessonId}/activities/order`, { activity_ids: ids }),
    onError: (e, _ids) => {
      toast.error(`Couldn't reorder blocks: ${errorMessage(e)}`);
      commit([...initial]);
    },
  });
  const create = useMutation({
    mutationFn: (b: { type: string; title: string; content: C }) =>
      api.post<Activity>(`/courses/${courseId}/lessons/${lessonId}/activities`, { activity_type: b.type, title: b.title || null, content: b.content }),
    onSuccess: (a) => {
      commit([...items, a]);
      setComposer(null);
      toast.success("Block added");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = async (a: Activity) => {
    await api.delete(`/courses/${courseId}/activities/${a.id}`);
    commit(items.filter((x) => x.id !== a.id));
    toast.success("Block deleted");
  };

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = items.findIndex((x) => x.id === e.active.id);
    const to = items.findIndex((x) => x.id === e.over!.id);
    const next = arrayMove(items, from, to).map((a, i) => ({ ...a, position: i }));
    commit(next);
    reorder.mutate(next.map((a) => a.id));
  };

  return (
    <SectionCard
      title="Blocks"
      description={required ? "Mixed lessons are built entirely from blocks — add at least one." : "Add interactive blocks below the main content. Drag to reorder."}
      icon={Blocks}
      color="violet"
      action={
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="soft" size="sm" leftIcon={<Plus />}>
              Add block
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-[60vh] w-64 overflow-y-auto">
            <DropdownMenuLabel>Block type</DropdownMenuLabel>
            {(Object.keys(ACTIVITY_TYPES) as ActivityTypeKey[]).map((t) => {
              const m = ACTIVITY_TYPES[t];
              return (
                <DropdownMenuItem key={t} onSelect={() => setComposer(t)} className="items-start">
                  <TypeChip meta={m} size="xs" className="mt-0.5" />
                  <span className="min-w-0">
                    <span className="block font-medium text-slate-900">{m.label}</span>
                    <span className="block text-2xs text-muted-foreground">{m.description}</span>
                  </span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      }
    >
      {items.length === 0 && !composer ? (
        <EmptyState
          bordered
          size="sm"
          illustration="rocket"
          title={required ? "No blocks yet" : "Make it interactive"}
          description="Callouts, knowledge checks, flashcards, embeds and more — mixed into the lesson in any order."
        />
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={items.map((a) => a.id)} strategy={verticalListSortingStrategy}>
            <ol className="space-y-2">
              {items.map((a, i) => (
                <BlockCard
                  key={a.id}
                  activity={a}
                  index={i}
                  onChange={(next) => commit(items.map((x) => (x.id === next.id ? next : x)))}
                  onDelete={() => setToDelete(a)}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}
      {composer && (
        <div className="mt-3">
          <Composer type={composer} busy={create.isPending} onCancel={() => setComposer(null)} onCreate={(b) => create.mutate({ type: composer, ...b })} />
        </div>
      )}
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        destructive
        title="Delete this block?"
        description="It will be removed from the draft. Published versions are not affected."
        confirmLabel="Delete block"
        onConfirm={async () => {
          if (!toDelete) return;
          try {
            await remove(toDelete);
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
    </SectionCard>
  );
}
