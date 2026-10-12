"use client";

import {
  Button,
  CategoryBadge,
  ConfirmDialog,
  DataTable,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  FilterBar,
  KpiTile,
  PageHeader,
  Pagination,
  SimpleSelect,
  Skeleton,
  cn,
  colorClasses,
  colorFor,
  toast,
  type ColumnDef,
} from "@praxis/ui";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  BookOpen,
  Copy,
  FilePen,
  GraduationCap,
  LayoutGrid,
  ListTree,
  MoreHorizontal,
  Pencil,
  Plus,
  Rocket,
  Rows3,
  Sparkles,
  Trash2,
  Users,
  Wand2,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { ErrorState } from "@/components/common/error-state";
import { api, errorMessage } from "@/lib/api";
import { Can, useAuth } from "@/lib/auth";
import { formatMinutes, formatRelative } from "@/lib/format";
import { useSearchParamState } from "../hooks";
import { ak } from "../keys";
import { DIFFICULTIES, difficultyMeta } from "../meta";
import { AIBadge, AStatus } from "../shared";
import type { Course, Page } from "../types";
import { CreateCourseDialog } from "./create-course-dialog";

const STATUSES = [
  { value: "", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "in_review", label: "In review" },
  { value: "published", label: "Published" },
  { value: "archived", label: "Archived" },
];

const PAGE_SIZE = 12;

function CourseActions({ course, onAction }: { course: Course; onAction: (a: "duplicate" | "archive" | "restore" | "delete", c: Course) => void }) {
  const { can } = useAuth();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${course.title}`} onClick={(e) => e.stopPropagation()}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem asChild>
          <Link href={`/app/instructor/courses/${course.id}`}>
            <Pencil /> Open builder
          </Link>
        </DropdownMenuItem>
        {can("courses.create") && (
          <DropdownMenuItem onSelect={() => onAction("duplicate", course)}>
            <Copy /> Duplicate
          </DropdownMenuItem>
        )}
        {can("courses.delete") && (
          <>
            <DropdownMenuSeparator />
            {course.status === "archived" ? (
              <DropdownMenuItem onSelect={() => onAction("restore", course)}>
                <ArchiveRestore /> Restore
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => onAction("archive", course)}>
                <Archive /> Archive
              </DropdownMenuItem>
            )}
            <DropdownMenuItem destructive onSelect={() => onAction("delete", course)}>
              <Trash2 /> Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CourseCard({ course, onAction }: { course: Course; onAction: (a: "duplicate" | "archive" | "restore" | "delete", c: Course) => void }) {
  const color = colorFor(course.category ?? course.title);
  const c = colorClasses(color);
  const d = difficultyMeta(course.difficulty);
  const dc = colorClasses(d.color);
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-soft transition duration-300 ease-spring hover:-translate-y-1 hover:shadow-lift">
      <div className={cn("relative h-24 overflow-hidden bg-gradient-to-br", c.gradient)}>
        {course.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={course.thumbnail_url} alt="" className="absolute inset-0 size-full object-cover opacity-90" />
        ) : (
          <>
            <div className="absolute inset-0 bg-grid-faint opacity-20 [background-size:24px_24px]" aria-hidden />
            <BookOpen className="absolute -bottom-4 -right-3 size-24 rotate-[-12deg] text-white/20" aria-hidden />
          </>
        )}
        <div className="absolute left-3 top-3 flex items-center gap-1.5">
          <span className="rounded-full bg-white/95 px-2 py-0.5 shadow-sm">
            <AStatus status={course.status} size="sm" />
          </span>
          {course.ai_generated && <AIBadge className="bg-white/95" />}
        </div>
        <div className="absolute right-2 top-2 rounded-lg bg-white/90 shadow-sm">
          <CourseActions course={course} onAction={onAction} />
        </div>
      </div>
      <div className="flex flex-1 flex-col p-4">
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {course.category && <CategoryBadge category={course.category} size="sm" />}
          <span className={cn("rounded-full px-2 py-0.5 text-2xs font-semibold ring-1 ring-inset", dc.soft, dc.text, dc.ring)}>{d.label}</span>
        </div>
        <h3 className="font-display text-base font-semibold leading-snug text-slate-900">
          <Link href={`/app/instructor/courses/${course.id}`} className="rounded after:absolute after:inset-0 focus-visible:focus-ring">
            {course.title}
          </Link>
        </h3>
        {course.subtitle && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{course.subtitle}</p>}
        <div className="mt-auto pt-4">
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { icon: ListTree, v: course.module_count, l: "modules", cl: "text-indigo-600" },
              { icon: BookOpen, v: course.lesson_count, l: "lessons", cl: "text-sky-600" },
              { icon: Users, v: course.enrolment_count, l: "enrolled", cl: "text-emerald-600" },
            ].map((s) => (
              <div key={s.l} className="rounded-xl bg-slate-50 px-1 py-2">
                <s.icon className={cn("mx-auto size-3.5", s.cl)} aria-hidden />
                <p className="mt-0.5 font-display text-sm font-bold tabular-nums text-slate-900">{s.v}</p>
                <p className="text-2xs text-muted-foreground">{s.l}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 flex items-center justify-between text-2xs text-muted-foreground">
            <span>{course.current_version_number ? `v${course.current_version_number} live` : "Not yet published"}</span>
            <span>Updated {formatRelative(course.updated_at)}</span>
          </p>
        </div>
      </div>
    </article>
  );
}

export function CourseList() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [get, set] = useSearchParamState(sp, router.replace, pathname);
  const qc = useQueryClient();
  const { can } = useAuth();
  const status = get("status") ?? "";
  const search = get("q") ?? "";
  const mine = get("scope") === "mine";
  const difficulty = get("difficulty") ?? "";
  const view = get("view") === "table" ? "table" : "grid";
  const page = Math.max(1, Number(get("page") ?? 1));
  const [createOpen, setCreateOpen] = React.useState(get("new") === "1");
  const [confirm, setConfirm] = React.useState<{ action: "archive" | "delete"; course: Course } | null>(null);

  const params = { status, search, mine, difficulty, page };
  const list = useQuery({
    queryKey: ak.courses.list(params),
    queryFn: ({ signal }) =>
      api.get<Page<Course>>("/courses", {
        signal,
        query: { status: status || undefined, search: search || undefined, mine: mine || undefined, difficulty: difficulty || undefined, page, page_size: PAGE_SIZE },
      }),
    placeholderData: (prev) => prev,
  });

  const counts = useQueries({
    queries: ["", "published", "draft", "archived"].map((s) => ({
      queryKey: ak.courses.list({ count: s, mine }),
      queryFn: ({ signal }: { signal: AbortSignal }) => api.get<Page<Course>>("/courses", { signal, query: { status: s || undefined, mine: mine || undefined, page_size: 1 } }),
      staleTime: 30_000,
    })),
  });
  const totalOf = (i: number) => counts[i]?.data?.total;

  const invalidate = () => qc.invalidateQueries({ queryKey: ak.courses.all });
  const duplicate = useMutation({
    mutationFn: (c: Course) => api.post<Course>(`/courses/${c.id}/duplicate`, {}),
    onSuccess: (c) => {
      toast.success(`Duplicated as “${c.title}”`);
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const restore = useMutation({
    mutationFn: (c: Course) => api.post<Course>(`/courses/${c.id}/restore`),
    onSuccess: (c) => {
      toast.success(`Restored “${c.title}”`);
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const onAction = (a: "duplicate" | "archive" | "restore" | "delete", c: Course) => {
    if (a === "duplicate") duplicate.mutate(c);
    else if (a === "restore") restore.mutate(c);
    else setConfirm({ action: a, course: c });
  };

  const columns = React.useMemo<ColumnDef<Course, unknown>[]>(
    () => [
      {
        id: "title",
        header: "Course",
        accessorKey: "title",
        cell: ({ row }) => {
          const c = row.original;
          const col = colorClasses(colorFor(c.category ?? c.title));
          return (
            <div className="flex min-w-[220px] items-center gap-3">
              <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-white", col.gradient)} aria-hidden>
                <BookOpen className="size-4" />
              </span>
              <div className="min-w-0">
                <Link href={`/app/instructor/courses/${c.id}`} className="block truncate font-semibold text-slate-900 hover:text-brand-700 focus-visible:focus-ring">
                  {c.title}
                </Link>
                <p className="truncate text-xs text-muted-foreground">{c.category ?? "Uncategorised"}</p>
              </div>
            </div>
          );
        },
      },
      { id: "status", header: "Status", accessorKey: "status", cell: ({ row }) => <AStatus status={row.original.status} size="sm" /> },
      {
        id: "difficulty",
        header: "Level",
        accessorKey: "difficulty",
        cell: ({ row }) => {
          const d = difficultyMeta(row.original.difficulty);
          const c = colorClasses(d.color);
          return <span className={cn("rounded-full px-2 py-0.5 text-2xs font-semibold ring-1 ring-inset", c.soft, c.text, c.ring)}>{d.label}</span>;
        },
      },
      { id: "lessons", header: "Lessons", accessorKey: "lesson_count", meta: { cellClassName: "tabular-nums" } },
      { id: "enrolled", header: "Enrolled", accessorKey: "enrolment_count", meta: { cellClassName: "tabular-nums" } },
      { id: "duration", header: "Duration", accessorKey: "duration_minutes", cell: ({ row }) => formatMinutes(row.original.duration_minutes || 0) },
      {
        id: "version",
        header: "Version",
        cell: ({ row }) => (row.original.current_version_number ? `v${row.original.current_version_number}` : "—"),
      },
      { id: "updated", header: "Updated", accessorKey: "updated_at", cell: ({ row }) => <span className="whitespace-nowrap text-muted-foreground">{formatRelative(row.original.updated_at)}</span> },
      { id: "actions", header: () => <span className="sr-only">Actions</span>, enableSorting: false, cell: ({ row }) => <CourseActions course={row.original} onAction={onAction} /> },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const filtered = !!(status || search || difficulty);

  return (
    <>
      <PageHeader
        title="Courses"
        description="Build, version and publish training your people actually finish."
        icon={<GraduationCap />}
        actions={
          <>
            <Can permission="courses.create">
              <Button asChild variant="soft" leftIcon={<Wand2 />}>
                <Link href="/app/instructor/ai-builder">AI course builder</Link>
              </Button>
              <Button variant="gradient" leftIcon={<Plus />} onClick={() => setCreateOpen(true)}>
                New course
              </Button>
            </Can>
          </>
        }
      />

      <section aria-label="Course counts" className="stagger mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {[
          { label: "All courses", s: "", icon: <BookOpen />, color: "indigo" as const, i: 0, hint: mine ? "Created by you" : "In your organisation" },
          { label: "Published", s: "published", icon: <Rocket />, color: "emerald" as const, i: 1, hint: "Live for learners" },
          { label: "Drafts", s: "draft", icon: <FilePen />, color: "amber" as const, i: 2, hint: "Work in progress" },
          { label: "Archived", s: "archived", icon: <Archive />, color: "rose" as const, i: 3, hint: "Hidden from catalog" },
        ].map((k) => (
          <button key={k.label} type="button" onClick={() => set({ status: k.s || null, page: null })} className={cn("rounded-2xl text-left focus-visible:focus-ring", status === k.s && "ring-2 ring-brand-400 ring-offset-2 ring-offset-background")} aria-pressed={status === k.s}>
            <KpiTile label={k.label} value={totalOf(k.i) ?? "—"} icon={k.icon} color={k.color} hint={k.hint} />
          </button>
        ))}
      </section>

      <div className="mb-4 space-y-3">
        <FilterBar
          search={search}
          onSearchChange={(q) => set({ q, page: null })}
          searchPlaceholder="Search courses…"
          actions={
            <div className="hidden items-center gap-1 rounded-xl bg-slate-100 p-1 sm:flex" role="radiogroup" aria-label="Layout">
              {(
                [
                  ["grid", LayoutGrid, "Cards"],
                  ["table", Rows3, "Table"],
                ] as const
              ).map(([v, Icon, l]) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={view === v}
                  aria-label={l}
                  onClick={() => set({ view: v === "grid" ? null : v })}
                  className={cn("grid size-8 place-items-center rounded-lg focus-visible:focus-ring", view === v ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800")}
                >
                  <Icon className="size-4" aria-hidden />
                </button>
              ))}
            </div>
          }
        >
          <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1" role="radiogroup" aria-label="Scope">
            {[
              ["all", "All courses"],
              ["mine", "My courses"],
            ].map(([v, l]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={(v === "mine") === mine}
                onClick={() => set({ scope: v === "mine" ? "mine" : null, page: null })}
                className={cn("rounded-lg px-3 py-1.5 text-xs font-semibold focus-visible:focus-ring", (v === "mine") === mine ? "bg-white text-slate-900 shadow-sm" : "text-slate-600")}
              >
                {l}
              </button>
            ))}
          </div>
          <SimpleSelect
            aria-label="Difficulty"
            value={difficulty || "all"}
            onValueChange={(v) => set({ difficulty: v === "all" ? null : v, page: null })}
            options={[{ value: "all", label: "Any level" }, ...DIFFICULTIES.map((d) => ({ value: d.value, label: d.label }))]}
            className="h-9 w-36 sm:w-40"
          />
        </FilterBar>
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto" role="radiogroup" aria-label="Status">
          {STATUSES.map((s) => {
            const on = status === s.value;
            return (
              <button
                key={s.value}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => set({ status: s.value || null, page: null })}
                className={cn(
                  "shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset transition-colors focus-visible:focus-ring",
                  on ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50",
                )}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : view === "table" ? (
        <DataTable
          aria-label="Courses"
          columns={columns}
          data={items}
          loading={list.isLoading}
          total={total}
          pagination={{ pageIndex: page - 1, pageSize: PAGE_SIZE }}
          onPaginationChange={(u) => {
            const next = typeof u === "function" ? u({ pageIndex: page - 1, pageSize: PAGE_SIZE }) : u;
            set({ page: next.pageIndex ? String(next.pageIndex + 1) : null });
          }}
          onRowClick={(c) => router.push(`/app/instructor/courses/${c.id}`)}
          columnToggle={false}
          empty={{ title: filtered ? "No courses match" : "No courses yet", description: filtered ? "Try a different filter or search." : "Create your first course or let AI draft one." }}
        />
      ) : list.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-72 rounded-2xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          bordered
          size="lg"
          illustration={filtered ? "search" : "learning"}
          title={filtered ? "No courses match these filters" : "Your course library is empty"}
          description={filtered ? "Try another status or search term." : "Create a course from scratch, or describe what you need and let the AI course builder draft it for you to review."}
          action={
            filtered ? (
              <Button variant="secondary" onClick={() => set({ status: null, q: null, difficulty: null, page: null })}>
                Clear filters
              </Button>
            ) : can("courses.create") ? (
              <Button variant="gradient" leftIcon={<Plus />} onClick={() => setCreateOpen(true)}>
                New course
              </Button>
            ) : undefined
          }
          secondaryAction={
            !filtered && can("courses.create") ? (
              <Button asChild variant="soft" leftIcon={<Sparkles />}>
                <Link href="/app/instructor/ai-builder">Try the AI builder</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className={cn("stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4", list.isFetching && "opacity-70 transition-opacity")}>
            {items.map((c) => (
              <CourseCard key={c.id} course={c} onAction={onAction} />
            ))}
          </div>
          {total > PAGE_SIZE && <Pagination className="mt-6" page={page} pageSize={PAGE_SIZE} total={total} onPageChange={(p) => set({ page: p > 1 ? String(p) : null })} />}
        </>
      )}

      <CreateCourseDialog
        open={createOpen}
        onOpenChange={(o) => {
          setCreateOpen(o);
          if (!o && get("new")) set({ new: null });
        }}
      />
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        destructive={confirm?.action === "delete"}
        title={confirm?.action === "delete" ? `Delete “${confirm.course.title}”?` : `Archive “${confirm?.course.title}”?`}
        description={
          confirm?.action === "delete"
            ? "The course and all its versions are removed. This cannot be undone."
            : "It's hidden from the catalog; enrolled learners keep their records. You can restore it later."
        }
        confirmLabel={confirm?.action === "delete" ? "Delete course" : "Archive"}
        onConfirm={async () => {
          if (!confirm) return;
          try {
            if (confirm.action === "delete") await api.delete(`/courses/${confirm.course.id}`);
            else await api.post(`/courses/${confirm.course.id}/archive`);
            toast.success(confirm.action === "delete" ? "Course deleted" : "Course archived");
            invalidate();
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
    </>
  );
}
