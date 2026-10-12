"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  closestCorners,
  pointerWithin,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Button,
  CATEGORY_COLORS,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  cn,
  colorClasses,
  toast,
} from "@praxis/ui";
import { useMutation } from "@tanstack/react-query";
import { ChevronDown, Eye, GripVertical, MoreHorizontal, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import * as React from "react";
import { api, errorMessage } from "@/lib/api";
import { formatMinutes } from "@/lib/format";
import { lessonMeta } from "../meta";
import { TypeChip } from "../shared";
import type { CourseModule, Lesson, Structure, StructureModule } from "../types";
import { useBuilder } from "./builder-context";

const mid = (id: string) => `m:${id}`;
const lid = (id: string) => `l:${id}`;
const raw = (id: string | number) => String(id).slice(2);
const isModule = (id: string | number) => String(id).startsWith("m:");

function moduleColor(i: number) {
  return colorClasses(CATEGORY_COLORS[i % CATEGORY_COLORS.length]!);
}

/* ------------------------------------------------------------------ lesson row */

function LessonRow({ lesson, selected, onSelect }: { lesson: Lesson; selected?: boolean; onSelect?: () => void }) {
  const meta = lessonMeta(lesson.lesson_type);
  const sortable = useSortable({ id: lid(lesson.id), data: { type: "lesson" } });
  return (
    <li
      ref={sortable.setNodeRef}
      style={{ transform: CSS.Translate.toString(sortable.transform), transition: sortable.transition }}
      className={cn(
        "group relative flex items-center gap-1.5 rounded-xl py-1 pl-1 pr-2 transition-colors",
        selected ? "bg-brand-50 ring-1 ring-inset ring-brand-200" : "hover:bg-slate-50",
        sortable.isDragging && "opacity-40",
      )}
    >
      {selected && <span className="absolute inset-y-1.5 left-0 w-1 rounded-full bg-brand-600" aria-hidden />}
      <button
        type="button"
        className="grid size-7 shrink-0 cursor-grab touch-none place-items-center rounded-lg text-slate-400 opacity-60 transition-opacity hover:bg-white hover:text-slate-700 focus-visible:opacity-100 focus-visible:focus-ring active:cursor-grabbing group-hover:opacity-100"
        aria-label={`Drag lesson ${lesson.title}`}
        {...sortable.attributes}
        {...sortable.listeners}
      >
        <GripVertical className="size-3.5" aria-hidden />
      </button>
      <button type="button" onClick={onSelect} aria-current={selected ? "true" : undefined} className="flex min-w-0 flex-1 items-center gap-2 rounded-lg py-1 text-left focus-visible:focus-ring">
        <TypeChip meta={meta} size="xs" />
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate text-sm", selected ? "font-semibold text-brand-900" : "font-medium text-slate-800")}>{lesson.title || "Untitled lesson"}</span>
          <span className="flex items-center gap-1.5 text-2xs text-muted-foreground">
            {meta.label}
            {lesson.duration_minutes > 0 && <span>· {lesson.duration_minutes}m</span>}
            {!lesson.is_required && <span className="font-semibold text-amber-700">· Optional</span>}
            {lesson.is_preview && (
              <span className="inline-flex items-center gap-0.5 font-semibold text-sky-700">
                · <Eye className="size-3" aria-hidden /> Preview
              </span>
            )}
            {lesson.ai_generated && <Sparkles className="size-3 text-fuchsia-500" aria-label="AI generated" />}
          </span>
        </span>
      </button>
    </li>
  );
}

/* ------------------------------------------------------------------ module card */

function ModuleCard({
  module,
  index,
  selectedLessonId,
  onSelect,
  onAddLesson,
  onRename,
  onDelete,
}: {
  module: StructureModule;
  index: number;
  selectedLessonId: string | null;
  onSelect: (id: string) => void;
  onAddLesson: (moduleId: string) => void;
  onRename: (m: StructureModule, title: string) => void;
  onDelete: (m: StructureModule) => void;
}) {
  const [open, setOpen] = React.useState(true);
  const [editing, setEditing] = React.useState(false);
  const [title, setTitle] = React.useState(module.title);
  React.useEffect(() => setTitle(module.title), [module.title]);
  const sortable = useSortable({ id: mid(module.id), data: { type: "module" } });
  const c = moduleColor(index);
  const minutes = module.lessons.reduce((s, l) => s + (l.duration_minutes || 0), 0);
  const hasSelected = module.lessons.some((l) => l.id === selectedLessonId);
  const expanded = open || hasSelected;

  return (
    <li
      ref={sortable.setNodeRef}
      style={{ transform: CSS.Translate.toString(sortable.transform), transition: sortable.transition }}
      className={cn("list-none", sortable.isDragging && "opacity-40")}
    >
      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-soft">
        <div className={cn("flex items-center gap-1.5 border-b border-slate-100 bg-gradient-to-r p-2", c.tint)}>
          <button
            type="button"
            className="grid size-7 shrink-0 cursor-grab touch-none place-items-center rounded-lg text-slate-400 hover:bg-white hover:text-slate-700 focus-visible:focus-ring active:cursor-grabbing"
            aria-label={`Drag module ${module.title}`}
            {...sortable.attributes}
            {...sortable.listeners}
          >
            <GripVertical className="size-4" aria-hidden />
          </button>
          <span className={cn("grid size-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br text-xs font-bold text-white shadow-sm", c.gradient)} aria-hidden>
            {index + 1}
          </span>
          {editing ? (
            <Input
              inputSize="sm"
              autoFocus
              className="h-8"
              aria-label="Module title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => {
                setEditing(false);
                if (title.trim() && title.trim() !== module.title) onRename(module, title.trim());
                else setTitle(module.title);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") {
                  setTitle(module.title);
                  setEditing(false);
                }
              }}
            />
          ) : (
            <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={expanded} className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-1 text-left focus-visible:focus-ring">
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 block text-sm font-semibold leading-snug text-slate-900">{module.title}</span>
                <span className="text-2xs text-muted-foreground">
                  {module.lessons.length} lesson{module.lessons.length === 1 ? "" : "s"}
                  {minutes > 0 && ` · ${formatMinutes(minutes)}`}
                </span>
              </span>
              <ChevronDown className={cn("size-4 shrink-0 text-slate-500 transition-transform", !expanded && "-rotate-90")} aria-hidden />
            </button>
          )}
          {(
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={`Module ${module.title} actions`}>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => onAddLesson(module.id)}>
                  <Plus /> Add lesson
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setEditing(true)}>
                  <Pencil /> Rename
                </DropdownMenuItem>
                <DropdownMenuItem destructive onSelect={() => onDelete(module)}>
                  <Trash2 /> Delete module
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {expanded && (
          <div className="p-1.5">
            <SortableContext items={module.lessons.map((l) => lid(l.id))} strategy={verticalListSortingStrategy}>
              <ul className="space-y-0.5" aria-label={`Lessons in ${module.title}`}>
                {module.lessons.map((l) => (
                  <LessonRow key={l.id} lesson={l} selected={l.id === selectedLessonId} onSelect={() => onSelect(l.id)} />
                ))}
              </ul>
            </SortableContext>
            {module.lessons.length === 0 && (
              <p className="mx-1 my-1 rounded-xl border-2 border-dashed border-slate-200 px-3 py-4 text-center text-xs text-muted-foreground">Drop lessons here or add the first one</p>
            )}
            <button
              type="button"
              onClick={() => onAddLesson(module.id)}
              className={cn("mt-0.5 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors focus-visible:focus-ring", c.text, "hover:bg-slate-50")}
            >
              <Plus className="size-4" aria-hidden /> Add lesson
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ outline */

export function CourseOutline({
  structure,
  selectedLessonId,
  onSelect,
  onAddLesson,
}: {
  structure: Structure;
  selectedLessonId: string | null;
  onSelect: (id: string) => void;
  onAddLesson: (moduleId: string) => void;
}) {
  const { courseId, refresh, markDirty } = useBuilder();
  const [items, setItems] = React.useState<StructureModule[]>(structure.modules);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [newModule, setNewModule] = React.useState("");
  const [toDelete, setToDelete] = React.useState<StructureModule | null>(null);
  const snapshot = React.useRef<StructureModule[]>(structure.modules);
  const [live, setLive] = React.useState("");

  React.useEffect(() => {
    if (!activeId) setItems(structure.modules);
  }, [structure.modules, activeId]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const moduleOf = React.useCallback((lessonId: string, list = items) => list.find((m) => m.lessons.some((l) => l.id === lessonId)), [items]);

  const collision: CollisionDetection = React.useCallback((args) => {
    if (isModule(args.active.id)) {
      return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((c) => isModule(c.id)) });
    }
    const hits = pointerWithin(args);
    const lessonHits = hits.filter((h) => !isModule(h.id));
    if (lessonHits.length) {
      return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((c) => lessonHits.some((h) => h.id === c.id)) });
    }
    if (hits.length) return hits;
    return closestCorners(args);
  }, []);

  const persist = useMutation({
    mutationFn: (mods: StructureModule[]) =>
      api.put<Structure>(`/courses/${courseId}/structure`, {
        modules: mods.map((m, i) => ({
          id: m.id,
          position: i,
          lessons: m.lessons.map((l, j) => ({ id: l.id, position: j, module_id: m.id })),
        })),
      }),
    onSuccess: () => {
      markDirty();
      void refresh();
    },
    onError: (e) => {
      toast.error(`Couldn't save the new order: ${errorMessage(e)}`);
      setItems(snapshot.current);
    },
  });

  const titleOf = (id: string | number) => {
    const r = raw(id);
    if (isModule(id)) return `module ${items.find((m) => m.id === r)?.title ?? ""}`;
    for (const m of items) {
      const l = m.lessons.find((x) => x.id === r);
      if (l) return `lesson ${l.title}`;
    }
    return "item";
  };

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${titleOf(active.id)}. Use the arrow keys to move, space to drop, escape to cancel.`,
    onDragOver: ({ active, over }) => (over ? `${titleOf(active.id)} is over ${titleOf(over.id)}.` : `${titleOf(active.id)} is no longer over a drop target.`),
    onDragEnd: ({ active, over }) => (over ? `Dropped ${titleOf(active.id)}.` : `${titleOf(active.id)} was dropped.`),
    onDragCancel: ({ active }) => `Moving ${titleOf(active.id)} was cancelled.`,
  };

  const onDragStart = (e: DragStartEvent) => {
    snapshot.current = items;
    setActiveId(String(e.active.id));
  };

  const onDragOver = (e: DragOverEvent) => {
    const { active, over } = e;
    if (!over || isModule(active.id)) return;
    const lessonId = raw(active.id);
    const from = moduleOf(lessonId);
    const to = isModule(over.id) ? items.find((m) => m.id === raw(over.id)) : moduleOf(raw(over.id));
    if (!from || !to || from.id === to.id) return;
    setItems((prev) => {
      const lesson = from.lessons.find((l) => l.id === lessonId)!;
      return prev.map((m) => {
        if (m.id === from.id) return { ...m, lessons: m.lessons.filter((l) => l.id !== lessonId) };
        if (m.id === to.id) {
          const overIdx = isModule(over.id) ? m.lessons.length : m.lessons.findIndex((l) => l.id === raw(over.id));
          const next = [...m.lessons];
          next.splice(overIdx < 0 ? next.length : overIdx, 0, { ...lesson, module_id: m.id });
          return { ...m, lessons: next };
        }
        return m;
      });
    });
  };

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    setActiveId(null);
    let next = items;
    if (over) {
      if (isModule(active.id)) {
        const a = items.findIndex((m) => m.id === raw(active.id));
        const b = items.findIndex((m) => m.id === raw(over.id));
        if (a >= 0 && b >= 0 && a !== b) next = arrayMove(items, a, b);
      } else if (!isModule(over.id)) {
        const m = moduleOf(raw(active.id));
        if (m) {
          const a = m.lessons.findIndex((l) => l.id === raw(active.id));
          const b = m.lessons.findIndex((l) => l.id === raw(over.id));
          if (a >= 0 && b >= 0 && a !== b) next = items.map((x) => (x.id === m.id ? { ...x, lessons: arrayMove(x.lessons, a, b) } : x));
        }
      }
    }
    setItems(next);
    const sig = (mods: StructureModule[]) => mods.map((m) => `${m.id}:${m.lessons.map((l) => l.id).join(",")}`).join("|");
    if (sig(next) !== sig(snapshot.current)) {
      persist.mutate(next);
      setLive("Outline order saved.");
    }
  };

  const addModule = useMutation({
    mutationFn: (title: string) => api.post<CourseModule>(`/courses/${courseId}/modules`, { title }),
    onSuccess: (m) => {
      setNewModule("");
      toast.success(`Module “${m.title}” added`);
      markDirty();
      void refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const rename = async (m: StructureModule, title: string) => {
    setItems((prev) => prev.map((x) => (x.id === m.id ? { ...x, title } : x)));
    try {
      await api.patch(`/courses/${courseId}/modules/${m.id}`, { title });
      markDirty();
      void refresh();
    } catch (e) {
      toast.error(errorMessage(e));
      setItems((prev) => prev.map((x) => (x.id === m.id ? { ...x, title: m.title } : x)));
    }
  };

  const active = activeId
    ? isModule(activeId)
      ? { kind: "module" as const, module: items.find((m) => m.id === raw(activeId)), index: items.findIndex((m) => m.id === raw(activeId)) }
      : { kind: "lesson" as const, lesson: items.flatMap((m) => m.lessons).find((l) => l.id === raw(activeId)) }
    : null;

  return (
    <div className="space-y-3">
      <p className="sr-only" aria-live="polite">
        {live}
      </p>
      <DndContext
        sensors={sensors}
        collisionDetection={collision}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          setActiveId(null);
          setItems(snapshot.current);
        }}
        accessibility={{ announcements, screenReaderInstructions: { draggable: "To pick up an item, press space or enter. Use the arrow keys to move it, including into another module. Press space or enter again to drop, or escape to cancel." } }}
      >
        <SortableContext items={items.map((m) => mid(m.id))} strategy={verticalListSortingStrategy}>
          <ol className="space-y-3" aria-label="Course outline">
            {items.map((m, i) => (
              <ModuleCard
                key={m.id}
                module={m}
                index={i}
                selectedLessonId={selectedLessonId}
                onSelect={onSelect}
                onAddLesson={onAddLesson}
                onRename={rename}
                onDelete={setToDelete}
              />
            ))}
          </ol>
        </SortableContext>
        <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(.2,.7,.2,1)" }}>
          {active?.kind === "lesson" && active.lesson ? (
            <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 shadow-lift ring-2 ring-brand-400">
              <GripVertical className="size-3.5 text-slate-400" aria-hidden />
              <TypeChip meta={lessonMeta(active.lesson.lesson_type)} size="xs" />
              <span className="truncate text-sm font-semibold text-slate-900">{active.lesson.title}</span>
            </div>
          ) : active?.kind === "module" && active.module ? (
            <div className="flex items-center gap-2 rounded-2xl bg-white p-3 shadow-lift ring-2 ring-brand-400">
              <GripVertical className="size-4 text-slate-400" aria-hidden />
              <span className={cn("grid size-7 place-items-center rounded-lg bg-gradient-to-br text-xs font-bold text-white", moduleColor(active.index).gradient)}>{active.index + 1}</span>
              <span className="truncate text-sm font-semibold text-slate-900">{active.module.title}</span>
              <span className="ml-auto text-2xs text-muted-foreground">{active.module.lessons.length} lessons</span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <form
        className="flex gap-2 rounded-2xl border-2 border-dashed border-slate-200 bg-white/60 p-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (newModule.trim()) addModule.mutate(newModule.trim());
        }}
      >
        <Input inputSize="sm" value={newModule} onChange={(e) => setNewModule(e.target.value)} placeholder={items.length ? "New module title" : "Name your first module"} aria-label="New module title" />
        <Button type="submit" size="sm" variant="soft" leftIcon={<Plus />} loading={addModule.isPending} disabled={!newModule.trim()}>
          Module
        </Button>
      </form>

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        destructive
        title={`Delete module “${toDelete?.title}”?`}
        description={`This removes the module and its ${toDelete?.lessons.length ?? 0} lesson(s) from the draft. Published versions are unaffected until you publish again.`}
        confirmLabel="Delete module"
        onConfirm={async () => {
          if (!toDelete) return;
          try {
            await api.delete(`/courses/${courseId}/modules/${toDelete.id}`);
            toast.success("Module deleted");
            if (toDelete.lessons.some((l) => l.id === selectedLessonId)) onSelect("");
            markDirty();
            await refresh();
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
    </div>
  );
}
