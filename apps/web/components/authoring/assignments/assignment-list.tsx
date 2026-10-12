"use client";

import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FilterBar,
  FormField,
  Input,
  KpiTile,
  PageHeader,
  SimpleSelect,
  cn,
  colorClasses,
  toast,
  type ColumnDef,
} from "@praxis/ui";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArrowRight, ClipboardCheck, Copy, FilePen, Paperclip, Pencil, Plus, Rocket, Scale, ShieldAlert, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { ErrorState } from "@/components/common/error-state";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatRelative } from "@/lib/format";
import { problemsMessage, useSearchParamState } from "../hooks";
import { ak } from "../keys";
import { GRADING_MODES } from "../meta";
import { AIBadge, AStatus, SubNav } from "../shared";
import type { Assignment, Page, Rubric } from "../types";
import { useCourseOptions } from "../use-options";

export const ASSIGN_NAV = [
  { href: "/app/instructor/assignments", label: "Assignments", icon: ClipboardCheck, color: "amber" as const },
  { href: "/app/instructor/rubrics", label: "Rubrics", icon: Scale, color: "emerald" as const },
];

export function GradingChip({ mode, className }: { mode: string; className?: string }) {
  const g = GRADING_MODES.find((x) => x.value === mode);
  const c = colorClasses(g?.color ?? "indigo");
  return <span className={cn("inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-2xs font-semibold ring-1 ring-inset", c.soft, c.text, c.ring, className)}>{g?.label ?? mode}</span>;
}

function CreateAssignmentDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const courses = useCourseOptions(open);
  const [title, setTitle] = React.useState("");
  const [courseId, setCourseId] = React.useState("none");
  const [mode, setMode] = React.useState("ai_recommend_human_final");
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (open) {
      setTitle("");
      setCourseId("none");
      setMode("ai_recommend_human_final");
      setError(null);
    }
  }, [open]);
  const create = useMutation({
    mutationFn: () =>
      api.post<Assignment>("/assignments", {
        title: title.trim(),
        course_id: courseId === "none" ? null : courseId,
        grading_mode: mode,
        required_evidence: [{ id: "written", label: "Written response", type: "text", required: true }],
      }),
    onSuccess: (a) => {
      toast.success(`“${a.title}” created as a draft`);
      qc.invalidateQueries({ queryKey: ak.assignments.all });
      onOpenChange(false);
      router.push(`/app/instructor/assignments/${a.id}`);
    },
    onError: (e) => setError(problemsMessage(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <span className="mb-1 grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-glow">
            <ClipboardCheck className="size-5" aria-hidden />
          </span>
          <DialogTitle>New practical assignment</DialogTitle>
          <DialogDescription>A realistic task learners complete with evidence, graded against a rubric.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) return setError("Give the assignment a title");
            create.mutate();
          }}
        >
          <FormField label="Title" required>
            <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={255} placeholder="e.g. Write up a phishing incident for the CISO" />
          </FormField>
          <FormField label="Course" hint="Optional.">
            {(aria) => <SimpleSelect {...aria} value={courseId} onValueChange={setCourseId} options={[{ value: "none", label: "Not linked to a course" }, ...courses.options]} />}
          </FormField>
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-slate-800">Grading</legend>
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Grading mode">
              {GRADING_MODES.map((g) => {
                const on = mode === g.value;
                const c = colorClasses(g.color);
                return (
                  <button
                    key={g.value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setMode(g.value)}
                    className={cn("rounded-2xl border p-3 text-left transition-all focus-visible:focus-ring", on ? cn(c.border, c.soft, "ring-1", c.ring) : "border-slate-200 bg-white hover:bg-slate-50")}
                  >
                    <span className={cn("block text-sm font-semibold", on ? c.text : "text-slate-900")}>{g.label}</span>
                    <span className="block text-2xs text-muted-foreground">{g.description}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>
          {error && <Alert tone="danger">{error}</Alert>}
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="gradient" rightIcon={<ArrowRight />} loading={create.isPending}>
              Create & open editor
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const STATUSES = ["all", "draft", "published", "archived"];

/** /app/instructor/assignments */
export function AssignmentList() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [get, set] = useSearchParamState(sp, router.replace, pathname);
  const qc = useQueryClient();
  const { can } = useAuth();
  const q = get("q") ?? "";
  const status = get("status") ?? "all";
  const course = get("course") ?? "all";
  const page = Math.max(1, Number(get("page") ?? 1));
  const pageSize = 20;
  const [createOpen, setCreateOpen] = React.useState(get("new") === "1");
  const [toDelete, setToDelete] = React.useState<Assignment | null>(null);
  const courses = useCourseOptions();
  const rubrics = useQuery({
    queryKey: ak.rubrics.list({ picker: true }),
    queryFn: ({ signal }) => api.get<Page<Rubric>>("/rubrics", { signal, query: { page_size: 200 } }),
    staleTime: 60_000,
  });
  const rubricTitle = (id: string | null) => (id ? rubrics.data?.items.find((r) => r.id === id)?.title : undefined);

  const list = useQuery({
    queryKey: ak.assignments.list({ q, status, course, page }),
    queryFn: ({ signal }) =>
      api.get<Page<Assignment>>("/assignments", {
        signal,
        query: { q: q || undefined, status: status === "all" ? undefined : status, course_id: course === "all" ? undefined : course, page, page_size: pageSize },
      }),
    placeholderData: (p) => p,
  });
  const counts = useQueries({
    queries: ["", "published", "draft", "archived"].map((s) => ({
      queryKey: ak.assignments.list({ count: s }),
      queryFn: ({ signal }: { signal: AbortSignal }) => api.get<Page<Assignment>>("/assignments", { signal, query: { status: s || undefined, page_size: 1 } }),
      staleTime: 30_000,
    })),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ak.assignments.all });
  const act = useMutation({
    mutationFn: ({ a, action }: { a: Assignment; action: "publish" | "archive" }) => api.post<Assignment>(`/assignments/${a.id}/${action}`),
    onSuccess: (a, v) => {
      toast.success(v.action === "publish" ? `“${a.title}” published` : `“${a.title}” archived`);
      invalidate();
    },
    onError: (e) => toast.error(problemsMessage(e)),
  });
  const duplicate = useMutation({
    mutationFn: async (a: Assignment) => {
      const full = await api.get<Assignment>(`/assignments/${a.id}`);
      return api.post<Assignment>("/assignments", {
        title: `${full.title} (copy)`.slice(0, 255),
        course_id: full.course_id,
        scenario: full.scenario,
        objective: full.objective,
        instructions: full.instructions,
        required_evidence: full.required_evidence,
        structured_fields: full.structured_fields,
        resources: full.resources,
        expected_output: full.expected_output ?? null,
        evaluation_criteria: full.evaluation_criteria,
        rubric_id: full.rubric_id,
        time_limit_minutes: full.time_limit_minutes,
        due_days_after_enrolment: full.due_days_after_enrolment,
        passing_score: full.passing_score,
        grading_mode: full.grading_mode,
        high_stakes: full.high_stakes,
        max_submissions: full.max_submissions,
        allowed_file_types: full.allowed_file_types,
        skill_ids: full.skill_ids,
      });
    },
    onSuccess: (a) => {
      toast.success("Duplicated as a new draft");
      invalidate();
      router.push(`/app/instructor/assignments/${a.id}`);
    },
    onError: (e) => toast.error(problemsMessage(e)),
  });

  const columns = React.useMemo<ColumnDef<Assignment, unknown>[]>(
    () => [
      {
        id: "title",
        header: "Assignment",
        cell: ({ row }) => {
          const a = row.original;
          return (
            <div className="flex min-w-[260px] items-center gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-sm" aria-hidden>
                <ClipboardCheck className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 truncate font-semibold text-slate-900">
                  <Link href={`/app/instructor/assignments/${a.id}`} onClick={(e) => e.stopPropagation()} className="truncate rounded hover:text-brand-700 focus-visible:focus-ring">
                    {a.title}
                  </Link>
                  {a.ai_generated && <AIBadge />}
                </p>
                <p className="truncate text-xs text-muted-foreground">{courses.titleOf(a.course_id) ?? "Standalone"}</p>
              </div>
            </div>
          );
        },
      },
      { id: "status", header: "Status", cell: ({ row }) => <AStatus status={row.original.status} size="sm" /> },
      {
        id: "grading",
        header: "Grading",
        cell: ({ row }) => (
          <div className="flex flex-wrap items-center gap-1">
            <GradingChip mode={row.original.grading_mode} />
            {row.original.high_stakes && (
              <Badge tone="danger" size="sm">
                <ShieldAlert aria-hidden /> High stakes
              </Badge>
            )}
          </div>
        ),
      },
      {
        id: "rubric",
        header: "Rubric",
        cell: ({ row }) =>
          row.original.rubric_id ? (
            <span className="inline-flex max-w-[200px] items-center gap-1.5 text-xs text-slate-700">
              <Scale className="size-3.5 shrink-0 text-emerald-600" aria-hidden />
              <span className="truncate">{rubricTitle(row.original.rubric_id) ?? "Rubric"}</span>
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">None</span>
          ),
      },
      {
        id: "evidence",
        header: "Evidence",
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1 text-xs tabular-nums text-slate-700">
            <Paperclip className="size-3.5 text-sky-600" aria-hidden /> {row.original.required_evidence.length}
          </span>
        ),
      },
      { id: "pass", header: "Pass", cell: ({ row }) => <span className="text-xs font-semibold tabular-nums text-emerald-700">{Math.round(row.original.passing_score)}%</span> },
      { id: "updated", header: "Updated", cell: ({ row }) => <span className="whitespace-nowrap text-xs text-muted-foreground">{formatRelative(row.original.updated_at)}</span> },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [courses.data, rubrics.data],
  );

  const filtered = !!q || status !== "all" || course !== "all";

  return (
    <>
      <PageHeader
        title="Assignments"
        description="Practical, evidence-based tasks graded with rubrics — by assessors, AI, or both."
        icon={<ClipboardCheck />}
        actions={
          can("assignments.manage") ? (
            <Button variant="gradient" leftIcon={<Plus />} onClick={() => setCreateOpen(true)}>
              New assignment
            </Button>
          ) : undefined
        }
      />
      <SubNav items={ASSIGN_NAV} />
      <section aria-label="Assignment counts" className="stagger mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {[
          { label: "All assignments", s: "all", icon: <ClipboardCheck />, color: "amber" as const, i: 0, hint: "In your organisation" },
          { label: "Published", s: "published", icon: <Rocket />, color: "emerald" as const, i: 1, hint: "Open for submissions" },
          { label: "Drafts", s: "draft", icon: <FilePen />, color: "sky" as const, i: 2, hint: "Being written" },
          { label: "Archived", s: "archived", icon: <Archive />, color: "rose" as const, i: 3, hint: "Closed" },
        ].map((k) => (
          <button
            key={k.label}
            type="button"
            onClick={() => set({ status: k.s === "all" ? null : k.s, page: null })}
            aria-pressed={status === k.s}
            className={cn("rounded-2xl text-left focus-visible:focus-ring", status === k.s && "ring-2 ring-brand-400 ring-offset-2 ring-offset-background")}
          >
            <KpiTile label={k.label} value={counts[k.i]?.data?.total ?? "—"} icon={k.icon} color={k.color} hint={k.hint} />
          </button>
        ))}
      </section>
      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : (
        <DataTable
          aria-label="Assignments"
          columns={columns}
          data={list.data?.items ?? []}
          loading={list.isLoading}
          total={list.data?.total ?? 0}
          pagination={{ pageIndex: page - 1, pageSize }}
          onPaginationChange={(u) => {
            const next = typeof u === "function" ? u({ pageIndex: page - 1, pageSize }) : u;
            set({ page: next.pageIndex ? String(next.pageIndex + 1) : null });
          }}
          onRowClick={(a) => router.push(`/app/instructor/assignments/${a.id}`)}
          columnToggle={false}
          rowActions={[
            { label: "Open editor", icon: <Pencil />, onSelect: (a) => router.push(`/app/instructor/assignments/${a.id}`) },
            { label: "Publish", icon: <Rocket />, hidden: (a) => a.status === "published", onSelect: (a) => act.mutate({ a, action: "publish" }) },
            { label: "Archive", icon: <Archive />, hidden: (a) => a.status !== "published", onSelect: (a) => act.mutate({ a, action: "archive" }) },
            { label: "Duplicate", icon: <Copy />, onSelect: (a) => duplicate.mutate(a) },
            { label: "Delete", icon: <Trash2 />, destructive: true, separatorBefore: true, onSelect: setToDelete },
          ]}
          toolbar={
            <FilterBar search={q} onSearchChange={(v) => set({ q: v || null, page: null })} searchPlaceholder="Search assignments…">
              <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1" role="radiogroup" aria-label="Status">
                {STATUSES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={status === s}
                    onClick={() => set({ status: s === "all" ? null : s, page: null })}
                    className={cn("rounded-lg px-3 py-1.5 text-xs font-semibold capitalize focus-visible:focus-ring", status === s ? "bg-white text-slate-900 shadow-sm" : "text-slate-600")}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <SimpleSelect
                aria-label="Course"
                value={course}
                onValueChange={(v) => set({ course: v === "all" ? null : v, page: null })}
                options={[{ value: "all", label: "All courses" }, ...courses.options]}
                className="h-9 w-56"
              />
            </FilterBar>
          }
          empty={{
            illustration: filtered ? "search" : "inbox",
            title: filtered ? "No assignments match" : "No assignments yet",
            description: filtered ? "Try a different filter or search." : "Create a practical task — or let the AI course builder draft one with a rubric.",
            action: !filtered ? (
              <div className="flex flex-wrap justify-center gap-2">
                <Button size="sm" leftIcon={<Plus />} onClick={() => setCreateOpen(true)}>
                  New assignment
                </Button>
                <Button size="sm" variant="soft" leftIcon={<Sparkles />} onClick={() => router.push("/app/instructor/ai-builder")}>
                  Draft with AI
                </Button>
              </div>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => set({ q: null, status: null, course: null, page: null })}>
                Clear filters
              </Button>
            ),
          }}
        />
      )}
      <CreateAssignmentDialog
        open={createOpen}
        onOpenChange={(o) => {
          setCreateOpen(o);
          if (!o && get("new")) set({ new: null });
        }}
      />
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        destructive
        title={`Delete “${toDelete?.title}”?`}
        description="Assignment lessons linked to it will block course publishing until relinked. Existing submissions are kept for records."
        confirmLabel="Delete assignment"
        onConfirm={async () => {
          if (!toDelete) return;
          try {
            await api.delete(`/assignments/${toDelete.id}`);
            toast.success("Assignment deleted");
            invalidate();
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
    </>
  );
}
