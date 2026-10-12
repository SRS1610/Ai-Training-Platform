"use client";

/**
 * Learning paths: list + create, ordered course editor (dnd-kit, keyboard accessible) and path enrolment;
 * plus the "Assign training" course table.
 */

import type { Page } from "@praxis/types";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Alert,
  Badge,
  Button,
  CategoryBadge,
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  FilterBar,
  FormField,
  Input,
  SimpleSelect,
  Skeleton,
  StatusPill,
  Switch,
  Textarea,
  cn,
  colorClasses,
  colorFor,
  toast,
  type ColumnDef,
} from "@praxis/ui";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  BookOpenCheck,
  Building2,
  CalendarClock,
  CheckCircle2,
  GripVertical,
  Layers,
  Plus,
  RefreshCcw,
  Route,
  SkipForward,
  Trash2,
  UserRound,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { ErrorState } from "@/components/common/error-state";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatMinutes, formatRelative } from "@/lib/format";
import { AssignTrainingDialog } from "./assign-training-dialog";
import { ak } from "./keys";
import { CourseSelect, DepartmentMultiPicker, MemberMultiPicker, TeamMultiPicker, type Option } from "./pickers";
import type { CourseOut, PathEnrolOut, PathOut } from "./types";
import { UpgradeNotice, isPlanLimit } from "./ui";

/* ================================================================== list */

export function PathsList() {
  const router = useRouter();
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState("all");
  const [page, setPage] = React.useState(1);
  const [create, setCreate] = React.useState(false);
  const params = { search: q || undefined, status: status === "all" ? undefined : status, page, page_size: 24 };
  const list = useQuery({
    queryKey: ak.paths.list(params),
    queryFn: ({ signal }) => api.get<Page<PathOut>>("/learning-paths", { signal, query: params }),
    placeholderData: keepPreviousData,
  });

  if (list.isError) return <ErrorState error={list.error} onRetry={() => list.refetch()} />;
  const items = (list.data?.items ?? []).filter((p) => !p.is_personalised);

  return (
    <div className="space-y-4">
      <FilterBar
        search={q}
        onSearchChange={(v) => {
          setQ(v);
          setPage(1);
        }}
        searchPlaceholder="Search learning paths…"
        actions={
          <Button leftIcon={<Plus />} size="sm" onClick={() => setCreate(true)}>
            New learning path
          </Button>
        }
      >
        <SimpleSelect
          aria-label="Filter by status"
          value={status}
          onValueChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          className="h-9 w-40"
          options={[
            { value: "all", label: "All statuses" },
            { value: "draft", label: "Draft" },
            { value: "published", label: "Published" },
            { value: "archived", label: "Archived" },
          ]}
        />
      </FilterBar>
      {list.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-56 rounded-2xl" />
          ))}
        </div>
      ) : !items.length ? (
        <EmptyState
          bordered
          illustration="rocket"
          title={q || status !== "all" ? "No paths match" : "Build your first learning path"}
          description="Sequence courses into a program — onboarding, certification tracks, role readiness — and enrol whole teams at once."
          action={
            <Button variant="gradient" leftIcon={<Plus />} onClick={() => setCreate(true)}>
              New learning path
            </Button>
          }
        />
      ) : (
        <ul className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((p) => {
            const color = colorFor(p.title);
            const c = colorClasses(color);
            const required = p.items.filter((i) => i.is_required).length;
            return (
              <li key={p.id}>
                <Link
                  href={`/app/admin/learning-paths/${p.id}`}
                  className="group flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-lift focus-visible:focus-ring"
                >
                  <div className={cn("relative h-24 bg-gradient-to-br p-4", c.gradient)}>
                    <div className="pointer-events-none absolute inset-0 bg-grid-faint opacity-20 [background-size:20px_20px]" aria-hidden />
                    <div className="relative flex items-start justify-between">
                      <span className="grid size-10 place-items-center rounded-xl bg-white/20 text-white ring-1 ring-white/30 backdrop-blur">
                        <Route className="size-5" aria-hidden />
                      </span>
                      <StatusPill status={p.status} size="sm" className="bg-white/95" />
                    </div>
                  </div>
                  <div className="flex flex-1 flex-col p-5">
                    <h3 className="font-display text-base font-semibold text-slate-900 group-hover:text-brand-700">{p.title}</h3>
                    {p.description && <p className="mt-1 line-clamp-2 text-sm text-slate-600">{p.description}</p>}
                    <ol className="mt-3 flex items-center gap-1" aria-label="Course sequence">
                      {p.items.slice(0, 8).map((it, i) => (
                        <li key={it.id} className="flex items-center gap-1">
                          <span
                            title={it.course_title ?? undefined}
                            className={cn("grid size-6 place-items-center rounded-full text-2xs font-bold", it.is_required ? cn("bg-gradient-to-br text-white", colorClasses(colorFor(it.course_title)).gradient) : "bg-slate-100 text-slate-600")}
                          >
                            {i + 1}
                          </span>
                          {i < Math.min(p.items.length, 8) - 1 && <span className="h-0.5 w-2 rounded bg-slate-200" aria-hidden />}
                        </li>
                      ))}
                      {p.items.length > 8 && <li className="text-xs text-muted-foreground">+{p.items.length - 8}</li>}
                    </ol>
                    <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 pt-4 text-xs text-slate-600">
                      <span className="inline-flex items-center gap-1">
                        <Layers className="size-3.5 text-violet-600" aria-hidden />
                        {p.items.length} course{p.items.length === 1 ? "" : "s"} · {required} required
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <UsersRound className="size-3.5 text-sky-600" aria-hidden />
                        {p.enrolled_users} enrolled
                      </span>
                      <span className="ml-auto text-slate-500">Updated {formatRelative(p.updated_at)}</span>
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {list.data && list.data.total > 24 && (
        <div className="flex justify-center gap-2">
          <Button variant="secondary" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <Button variant="secondary" size="sm" disabled={page * 24 >= list.data.total} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      )}
      <CreatePathDialog open={create} onOpenChange={setCreate} onCreated={(p) => router.push(`/app/admin/learning-paths/${p.id}`)} />
    </div>
  );
}

function CreatePathDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (p: PathOut) => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  React.useEffect(() => {
    if (open) {
      setTitle("");
      setDescription("");
      create.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const create = useMutation({
    mutationFn: () => api.post<PathOut>("/learning-paths", { title: title.trim(), description: description.trim() || null, status: "draft", items: [] }),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ak.paths.all });
      toast.success("Learning path created — add some courses");
      onOpenChange(false);
      onCreated(p);
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <span className="mb-1 grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500 text-white">
            <Route className="size-5" aria-hidden />
          </span>
          <DialogTitle>New learning path</DialogTitle>
          <DialogDescription>Start as a draft; add and order courses, then publish to enrol learners.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) create.mutate();
          }}
        >
          <FormField label="Title" required>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={255} autoFocus placeholder="e.g. Service Desk Onboarding" />
          </FormField>
          <FormField label="Description">
            <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={10000} placeholder="What will learners be able to do at the end?" />
          </FormField>
          {create.isError && (
            <Alert tone="danger" title="Couldn't create the path">
              {errorMessage(create.error)}
            </Alert>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="gradient" loading={create.isPending} disabled={!title.trim()}>
              Create path
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ================================================================== editor */

interface DraftItem {
  key: string;
  course_id: string;
  course_title: string;
  course_status: string | null;
  lesson_id: string | null;
  is_required: boolean;
  note: string;
}

function toDraft(p: PathOut): DraftItem[] {
  return p.items
    .filter((i) => i.course_id)
    .sort((a, b) => a.position - b.position)
    .map((i) => ({
      key: i.id,
      course_id: i.course_id!,
      course_title: i.course_title ?? "Untitled course",
      course_status: i.course_status ?? null,
      lesson_id: i.lesson_id ?? null,
      is_required: i.is_required,
      note: i.note ?? "",
    }));
}

function SortableItem({
  item,
  index,
  count,
  onChange,
  onRemove,
  onMove,
}: {
  item: DraftItem;
  index: number;
  count: number;
  onChange: (patch: Partial<DraftItem>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.key });
  const c = colorClasses(colorFor(item.course_title));
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("relative rounded-2xl border bg-white p-3 shadow-sm transition-shadow sm:p-4", isDragging ? "z-10 border-brand-300 shadow-lift" : "border-slate-200")}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          className="mt-1 grid size-8 shrink-0 cursor-grab touch-none place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:focus-ring active:cursor-grabbing"
          aria-label={`Reorder ${item.course_title}. Press space to pick up, arrow keys to move, space to drop.`}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" aria-hidden />
        </button>
        <span className={cn("mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br font-display text-sm font-bold text-white shadow-sm", c.gradient)} aria-hidden>
          {index + 1}
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-slate-900">{item.course_title}</p>
            {item.course_status && item.course_status !== "published" && (
              <Badge tone="warning" size="sm" title="Learners are only enrolled in published courses">
                {item.course_status}
              </Badge>
            )}
          </div>
          <Input
            inputSize="sm"
            value={item.note}
            onChange={(e) => onChange({ note: e.target.value })}
            placeholder="Optional note for learners (why this course, what to focus on)"
            aria-label={`Note for ${item.course_title}`}
            maxLength={2000}
          />
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:items-center">
          <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
            <Switch checked={item.is_required} onCheckedChange={(v) => onChange({ is_required: v })} aria-label={`${item.course_title} required`} />
            <span className="hidden sm:inline">{item.is_required ? "Required" : "Optional"}</span>
          </label>
          <div className="flex">
            <Button variant="ghost" size="icon-sm" aria-label="Move up" disabled={index === 0} onClick={() => onMove(-1)}>
              <ArrowUp />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Move down" disabled={index === count - 1} onClick={() => onMove(1)}>
              <ArrowDown />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label={`Remove ${item.course_title}`} className="text-rose-600 hover:bg-rose-50" onClick={onRemove}>
              <Trash2 />
            </Button>
          </div>
        </div>
      </div>
    </li>
  );
}

export function PathItemsEditor({ path, onSaved }: { path: PathOut; onSaved: () => void }) {
  const [items, setItems] = React.useState<DraftItem[]>(() => toDraft(path));
  const [adding, setAdding] = React.useState<Option | null>(null);
  const [announce, setAnnounce] = React.useState("");
  React.useEffect(() => setItems(toDraft(path)), [path]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const original = JSON.stringify(toDraft(path).map(({ key: _k, course_title: _t, course_status: _s, ...r }) => r));
  const dirty = JSON.stringify(items.map(({ key: _k, course_title: _t, course_status: _s, ...r }) => r)) !== original;

  const save = useMutation({
    mutationFn: () =>
      api.put<PathOut>(`/learning-paths/${path.id}/items`, {
        items: items.map((i) => ({ course_id: i.course_id, lesson_id: i.lesson_id, is_required: i.is_required, note: i.note.trim() || null })),
      }),
    onSuccess: () => {
      toast.success("Course sequence saved");
      onSaved();
    },
  });

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    setItems((list) => {
      const from = list.findIndex((i) => i.key === e.active.id);
      const to = list.findIndex((i) => i.key === e.over!.id);
      setAnnounce(`${list[from]?.course_title} moved to position ${to + 1}`);
      return arrayMove(list, from, to);
    });
  };

  const move = (idx: number, dir: -1 | 1) => {
    setItems((list) => {
      const to = idx + dir;
      if (to < 0 || to >= list.length) return list;
      setAnnounce(`${list[idx]?.course_title} moved to position ${to + 1}`);
      return arrayMove(list, idx, to);
    });
  };

  return (
    <section aria-labelledby="sequence-title" className="rounded-2xl border border-slate-200/80 bg-white shadow-soft">
      <div className="flex flex-col gap-3 border-b border-slate-100 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div>
          <h2 id="sequence-title" className="font-display text-lg font-semibold text-slate-900">
            Course sequence
          </h2>
          <p className="text-sm text-muted-foreground">Drag to reorder (or use the arrows / keyboard). Learners see courses in this order.</p>
        </div>
        <Button leftIcon={<CheckCircle2 />} loading={save.isPending} disabled={!dirty} onClick={() => save.mutate()}>
          Save sequence
        </Button>
      </div>
      <div className="space-y-4 p-5 sm:p-6">
        <p className="sr-only" aria-live="polite">
          {announce}
        </p>
        {items.length === 0 ? (
          <EmptyState size="sm" illustration="learning" title="No courses in this path yet" description="Add courses below — published courses are enrolled when learners join." />
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={items.map((i) => i.key)} strategy={verticalListSortingStrategy}>
              <ol className="space-y-3">
                {items.map((it, idx) => (
                  <SortableItem
                    key={it.key}
                    item={it}
                    index={idx}
                    count={items.length}
                    onChange={(patch) => setItems((l) => l.map((x) => (x.key === it.key ? { ...x, ...patch } : x)))}
                    onRemove={() => setItems((l) => l.filter((x) => x.key !== it.key))}
                    onMove={(d) => move(idx, d)}
                  />
                ))}
              </ol>
            </SortableContext>
          </DndContext>
        )}
        <div className="flex flex-col gap-2 rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 p-3 sm:flex-row sm:items-center">
          <div className="flex-1">
            <CourseSelect value={adding} onChange={setAdding} placeholder="Add a course to the path…" />
          </div>
          <Button
            variant="soft"
            leftIcon={<Plus />}
            disabled={!adding || items.some((i) => i.course_id === adding.value)}
            onClick={() => {
              if (!adding) return;
              setItems((l) => [...l, { key: `new-${adding.value}-${Date.now()}`, course_id: adding.value, course_title: adding.label, course_status: adding.hint ?? null, lesson_id: null, is_required: true, note: "" }]);
              setAnnounce(`${adding.label} added at position ${items.length + 1}`);
              setAdding(null);
            }}
          >
            Add course
          </Button>
        </div>
        {adding && items.some((i) => i.course_id === adding.value) && <p className="text-xs font-medium text-amber-800">That course is already in the path.</p>}
        {save.isError && (
          <Alert tone="danger" title="Couldn't save the sequence">
            {errorMessage(save.error)}
          </Alert>
        )}
        {dirty && <p className="text-xs font-medium text-amber-800">You have unsaved changes to the sequence.</p>}
      </div>
    </section>
  );
}

/* ================================================================== enrol */

export function PathEnrolDialog({ path, open, onOpenChange }: { path: PathOut; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [users, setUsers] = React.useState<Option[]>([]);
  const [departments, setDepartments] = React.useState<Option[]>([]);
  const [teams, setTeams] = React.useState<Option[]>([]);
  const [due, setDue] = React.useState("");
  const [result, setResult] = React.useState<PathEnrolOut | null>(null);
  React.useEffect(() => {
    if (open) {
      setUsers([]);
      setDepartments([]);
      setTeams([]);
      setDue("");
      setResult(null);
      enrol.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const enrol = useMutation({
    mutationFn: () =>
      api.post<PathEnrolOut>(`/learning-paths/${path.id}/enrol`, {
        user_ids: users.map((u) => u.value),
        department_ids: departments.map((d) => d.value),
        team_ids: teams.map((t) => t.value),
        due_date: due || null,
      }),
    onSuccess: (r) => {
      setResult(r);
      qc.invalidateQueries({ queryKey: ak.paths.all });
      qc.invalidateQueries({ queryKey: ak.enrolments.all });
      toast.success(`${r.users} learner${r.users === 1 ? "" : "s"} enrolled in ${path.title}`);
    },
  });
  const has = users.length + departments.length + teams.length > 0;
  const titleOf = (id: string) => path.items.find((i) => i.course_id === id)?.course_title ?? "A course";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <span className="mb-1 grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500 text-white">
            <UsersRound className="size-5" aria-hidden />
          </span>
          <DialogTitle>{result ? "Enrolment complete" : `Enrol in ${path.title}`}</DialogTitle>
          <DialogDescription>
            {result ? `${result.users} learner${result.users === 1 ? "" : "s"} were processed across ${path.items.length} course${path.items.length === 1 ? "" : "s"}.` : "Learners are enrolled in every published course in the path."}
          </DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="space-y-4" aria-live="polite">
            <div className="grid gap-3 sm:grid-cols-3">
              <Tile icon={CheckCircle2} color="emerald" label="New enrolments" value={result.created} />
              <Tile icon={RefreshCcw} color="sky" label="Reactivated" value={result.reactivated} />
              <Tile icon={SkipForward} color="amber" label="Already enrolled" value={result.skipped} />
            </div>
            {result.courses_skipped.length > 0 && (
              <Alert tone="warning" title={`${result.courses_skipped.length} course${result.courses_skipped.length === 1 ? " was" : "s were"} skipped`}>
                <ul className="mt-1 list-disc pl-5">
                  {result.courses_skipped.map((c) => (
                    <li key={c.course_id}>
                      {titleOf(c.course_id ?? "")} — {c.reason === "not_published" ? "not published yet" : c.reason}
                    </li>
                  ))}
                </ul>
              </Alert>
            )}
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (has) enrol.mutate();
            }}
          >
            <FormField label={<span className="inline-flex items-center gap-1.5"><UserRound className="size-4 text-sky-600" aria-hidden />People</span>}>
              {(aria) => <MemberMultiPicker id={aria.id} value={users} onChange={setUsers} />}
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={<span className="inline-flex items-center gap-1.5"><Building2 className="size-4 text-teal-600" aria-hidden />Departments</span>} hint="Includes sub-departments">
                {(aria) => <DepartmentMultiPicker id={aria.id} value={departments} onChange={setDepartments} />}
              </FormField>
              <FormField label={<span className="inline-flex items-center gap-1.5"><UsersRound className="size-4 text-violet-600" aria-hidden />Teams</span>}>
                {(aria) => <TeamMultiPicker id={aria.id} value={teams} onChange={setTeams} />}
              </FormField>
            </div>
            <FormField label={<span className="inline-flex items-center gap-1.5"><CalendarClock className="size-4 text-amber-600" aria-hidden />Due date</span>} hint="Optional — applies to each course in the path.">
              <Input type="date" min={new Date().toISOString().slice(0, 10)} value={due} onChange={(e) => setDue(e.target.value)} className="sm:max-w-xs" />
            </FormField>
            {enrol.isError &&
              (isPlanLimit(enrol.error) ? (
                <UpgradeNotice error={enrol.error} compact />
              ) : (
                <Alert tone="danger" title="Couldn't enrol learners">
                  {errorMessage(enrol.error)}
                </Alert>
              ))}
            <DialogFooter>
              <Button variant="secondary" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="gradient" loading={enrol.isPending} disabled={!has}>
                Enrol learners
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Tile({ icon: Icon, color, label, value }: { icon: typeof CheckCircle2; color: "emerald" | "sky" | "amber"; label: string; value: number }) {
  const c = colorClasses(color);
  return (
    <div className={cn("rounded-2xl border bg-gradient-to-br p-4", c.border, c.tint)}>
      <Icon className={cn("size-5", c.icon)} aria-hidden />
      <p className="mt-2 font-display text-3xl font-bold tabular-nums text-slate-900">{value}</p>
      <p className="text-sm font-medium text-slate-700">{label}</p>
    </div>
  );
}

/* ================================================================== assign training (courses) */

export function AssignTrainingPanel() {
  const { can } = useAuth();
  const [q, setQ] = React.useState("");
  const [pagination, setPagination] = React.useState({ pageIndex: 0, pageSize: 20 });
  const [assign, setAssign] = React.useState<{ course: Option | null } | null>(null);
  const params = { search: q || undefined, status: "published", page: pagination.pageIndex + 1, page_size: pagination.pageSize };
  const list = useQuery({
    queryKey: ak.courses.list(params),
    queryFn: ({ signal }) => api.get<Page<CourseOut>>("/courses", { signal, query: params }),
    placeholderData: keepPreviousData,
  });
  const columns = React.useMemo<ColumnDef<CourseOut, unknown>[]>(
    () => [
      {
        accessorKey: "title",
        header: "Course",
        cell: ({ row }) => {
          const c = colorClasses(colorFor(row.original.category ?? row.original.title));
          return (
            <div className="flex min-w-[16rem] items-center gap-3">
              <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-white", c.gradient)} aria-hidden>
                <BookOpenCheck className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="truncate font-semibold text-slate-900">{row.original.title}</p>
                {row.original.subtitle && <p className="truncate text-xs text-muted-foreground">{row.original.subtitle}</p>}
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: "category",
        header: "Category",
        cell: ({ row }) => (row.original.category ? <CategoryBadge category={row.original.category} size="sm" /> : <span className="text-slate-400">—</span>),
      },
      { accessorKey: "difficulty", header: "Level", cell: ({ row }) => <span className="capitalize text-slate-700">{row.original.difficulty}</span> },
      {
        accessorKey: "duration_minutes",
        header: "Duration",
        cell: ({ row }) => <span className="tabular-nums text-slate-700">{row.original.duration_minutes ? formatMinutes(row.original.duration_minutes) : "—"}</span>,
      },
      {
        id: "assign",
        header: () => <span className="sr-only">Assign</span>,
        enableSorting: false,
        enableHiding: false,
        meta: { cellClassName: "text-right" },
        cell: ({ row }) => (
          <Button size="sm" variant="soft" leftIcon={<BookOpenCheck />} onClick={() => setAssign({ course: { value: row.original.id, label: row.original.title } })}>
            Assign
          </Button>
        ),
      },
    ],
    [],
  );
  if (!can("enrolments.manage")) return null;
  if (list.isError) return <ErrorState error={list.error} onRetry={() => list.refetch()} />;
  return (
    <>
      <DataTable
        aria-label="Published courses"
        columns={columns}
        data={list.data?.items ?? []}
        loading={list.isLoading}
        total={list.data?.total ?? 0}
        pagination={pagination}
        onPaginationChange={setPagination}
        getRowId={(r) => r.id}
        columnToggle={false}
        toolbar={
          <FilterBar
            search={q}
            onSearchChange={(v) => {
              setQ(v);
              setPagination((p) => ({ ...p, pageIndex: 0 }));
            }}
            searchPlaceholder="Search published courses…"
            actions={
              <Button size="sm" leftIcon={<BookOpenCheck />} onClick={() => setAssign({ course: null })}>
                Assign training
              </Button>
            }
          />
        }
        empty={{
          title: q ? "No published courses match" : "No published courses yet",
          description: "Publish a course from the course builder to assign it.",
          action: can("courses.create") ? (
            <Button asChild variant="soft">
              <Link href="/app/instructor/courses">Go to courses</Link>
            </Button>
          ) : undefined,
        }}
      />
      <AssignTrainingDialog open={!!assign} onOpenChange={(o) => !o && setAssign(null)} course={assign?.course ?? null} />
    </>
  );
}
