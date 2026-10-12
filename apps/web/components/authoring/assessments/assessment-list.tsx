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
  PageHeader,
  SimpleSelect,
  Textarea,
  cn,
  colorClasses,
  toast,
  type ColumnDef,
} from "@praxis/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, FileQuestion, Pencil, Plus, Rocket, ShieldAlert, Timer, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { ErrorState } from "@/components/common/error-state";
import { api, errorMessage } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import { problemsMessage } from "../hooks";
import { ak } from "../keys";
import { ASSESSMENT_KINDS, gradingLabel, kindMeta } from "../meta";
import { AStatus, SubNav } from "../shared";
import { ASSESS_NAV } from "../questions/banks-list";
import type { Assessment, AssessmentDetail, Page } from "../types";
import { useCourseOptions } from "../use-options";

export function KindChip({ kind }: { kind: string }) {
  const k = kindMeta(kind);
  const c = colorClasses(k.color);
  return <span className={cn("inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-2xs font-semibold ring-1 ring-inset", c.soft, c.text, c.ring)}>{k.label}</span>;
}

function CreateAssessmentDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const courses = useCourseOptions(open);
  const [title, setTitle] = React.useState("");
  const [kind, setKind] = React.useState("quiz");
  const [courseId, setCourseId] = React.useState("none");
  const [description, setDescription] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (open) {
      setTitle("");
      setKind("quiz");
      setCourseId("none");
      setDescription("");
      setError(null);
    }
  }, [open]);
  const create = useMutation({
    mutationFn: () =>
      api.post<AssessmentDetail>("/assessments", {
        title: title.trim(),
        kind,
        course_id: courseId === "none" ? null : courseId,
        description: description.trim() || null,
        ...(kind === "final" ? { high_stakes: true, max_attempts: 2, pass_percentage: 75 } : kind === "practice" ? { show_feedback: "after_submit", max_attempts: null } : {}),
      }),
    onSuccess: (a) => {
      toast.success(`“${a.title}” created`);
      qc.invalidateQueries({ queryKey: ak.assessments.all });
      onOpenChange(false);
      router.push(`/app/instructor/assessments/${a.id}`);
    },
    onError: (e) => setError(problemsMessage(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>New assessment</DialogTitle>
          <DialogDescription>Pick a kind — sensible defaults are applied and everything can be tuned in settings.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) return setError("Give the assessment a title");
            create.mutate();
          }}
        >
          <FormField label="Title" required>
            <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={255} placeholder="e.g. Week 1 check: recognising phishing" />
          </FormField>
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-slate-800">Kind</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Kind">
              {ASSESSMENT_KINDS.map((k) => {
                const on = kind === k.value;
                const c = colorClasses(k.color);
                return (
                  <button key={k.value} type="button" role="radio" aria-checked={on} onClick={() => setKind(k.value)} className={cn("rounded-2xl border p-3 text-left transition-all focus-visible:focus-ring", on ? cn(c.border, c.soft, "ring-1", c.ring) : "border-slate-200 bg-white hover:bg-slate-50")}>
                    <span className={cn("block text-sm font-semibold", on ? c.text : "text-slate-900")}>{k.label}</span>
                    <span className="block text-2xs text-muted-foreground">{k.description}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>
          <FormField label="Course" hint="Optional.">
            {(aria) => <SimpleSelect {...aria} value={courseId} onValueChange={setCourseId} options={[{ value: "none", label: "Not linked to a course" }, ...courses.options]} />}
          </FormField>
          <FormField label="Description">
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </FormField>
          {error && <Alert tone="danger">{error}</Alert>}
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="gradient" loading={create.isPending}>
              Create & add questions
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AssessmentList() {
  const router = useRouter();
  const qc = useQueryClient();
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState("all");
  const [pagination, setPagination] = React.useState({ pageIndex: 0, pageSize: 20 });
  const [createOpen, setCreateOpen] = React.useState(false);
  const [toDelete, setToDelete] = React.useState<Assessment | null>(null);
  const courses = useCourseOptions();
  const list = useQuery({
    queryKey: ak.assessments.list({ q, status, page: pagination.pageIndex }),
    queryFn: ({ signal }) =>
      api.get<Page<Assessment>>("/assessments", { signal, query: { q: q || undefined, status: status === "all" ? undefined : status, page: pagination.pageIndex + 1, page_size: pagination.pageSize } }),
    placeholderData: (p) => p,
  });
  const act = useMutation({
    mutationFn: ({ a, action }: { a: Assessment; action: "publish" | "archive" }) => api.post<AssessmentDetail>(`/assessments/${a.id}/${action}`),
    onSuccess: (a, v) => {
      toast.success(v.action === "publish" ? `“${a.title}” published` : `“${a.title}” archived`);
      qc.invalidateQueries({ queryKey: ak.assessments.all });
    },
    onError: (e) => toast.error(problemsMessage(e)),
  });

  const columns = React.useMemo<ColumnDef<Assessment, unknown>[]>(
    () => [
      {
        id: "title",
        header: "Assessment",
        cell: ({ row }) => {
          const a = row.original;
          const c = colorClasses(kindMeta(a.kind).color);
          return (
            <div className="flex min-w-[240px] items-center gap-3">
              <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-white", c.gradient)} aria-hidden>
                <FileQuestion className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="truncate font-semibold text-slate-900">{a.title}</p>
                <p className="truncate text-xs text-muted-foreground">{courses.titleOf(a.course_id) ?? "Standalone"}</p>
              </div>
            </div>
          );
        },
      },
      { id: "kind", header: "Kind", cell: ({ row }) => <KindChip kind={row.original.kind} /> },
      { id: "status", header: "Status", cell: ({ row }) => <AStatus status={row.original.status} size="sm" /> },
      {
        id: "rules",
        header: "Rules",
        cell: ({ row }) => {
          const a = row.original;
          return (
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
              <span className="font-semibold text-emerald-700">Pass {Math.round(a.pass_percentage)}%</span>
              {a.time_limit_minutes && (
                <span className="inline-flex items-center gap-0.5">
                  <Timer className="size-3" aria-hidden /> {a.time_limit_minutes}m
                </span>
              )}
              <span>{a.max_attempts ? `${a.max_attempts} attempts` : "∞ attempts"}</span>
              {a.high_stakes && (
                <Badge tone="danger" size="sm">
                  <ShieldAlert aria-hidden /> High stakes
                </Badge>
              )}
            </div>
          );
        },
      },
      { id: "grading", header: "Grading", cell: ({ row }) => <span className="whitespace-nowrap text-xs text-slate-600">{gradingLabel(row.original.grading_mode)}</span> },
      { id: "updated", header: "Updated", cell: ({ row }) => <span className="whitespace-nowrap text-xs text-muted-foreground">{formatRelative(row.original.updated_at)}</span> },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [courses.data],
  );

  return (
    <>
      <PageHeader
        title="Assessments"
        description="Quizzes, finals and practice tests built from fixed questions or random pools."
        icon={<FileQuestion />}
        actions={
          <Button variant="gradient" leftIcon={<Plus />} onClick={() => setCreateOpen(true)}>
            New assessment
          </Button>
        }
      />
      <SubNav items={ASSESS_NAV} />
      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : (
        <DataTable
          aria-label="Assessments"
          columns={columns}
          data={list.data?.items ?? []}
          loading={list.isLoading}
          total={list.data?.total ?? 0}
          pagination={pagination}
          onPaginationChange={setPagination}
          onRowClick={(a) => router.push(`/app/instructor/assessments/${a.id}`)}
          columnToggle={false}
          rowActions={[
            { label: "Open builder", icon: <Pencil />, onSelect: (a) => router.push(`/app/instructor/assessments/${a.id}`) },
            { label: "Publish", icon: <Rocket />, hidden: (a) => a.status === "published", onSelect: (a) => act.mutate({ a, action: "publish" }) },
            { label: "Archive", icon: <Archive />, hidden: (a) => a.status === "archived", onSelect: (a) => act.mutate({ a, action: "archive" }) },
            { label: "Delete", icon: <Trash2 />, destructive: true, separatorBefore: true, onSelect: setToDelete },
          ]}
          toolbar={
            <FilterBar
              search={q}
              onSearchChange={(v) => {
                setQ(v);
                setPagination((p) => ({ ...p, pageIndex: 0 }));
              }}
              searchPlaceholder="Search assessments…"
            >
              <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1" role="radiogroup" aria-label="Status">
                {["all", "draft", "published", "archived"].map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={status === s}
                    onClick={() => {
                      setStatus(s);
                      setPagination((p) => ({ ...p, pageIndex: 0 }));
                    }}
                    className={cn("rounded-lg px-3 py-1.5 text-xs font-semibold capitalize focus-visible:focus-ring", status === s ? "bg-white text-slate-900 shadow-sm" : "text-slate-600")}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </FilterBar>
          }
          empty={{
            title: q || status !== "all" ? "No assessments match" : "No assessments yet",
            description: "Create one, then add questions from your banks or random pools.",
            action: (
              <Button size="sm" leftIcon={<Plus />} onClick={() => setCreateOpen(true)}>
                New assessment
              </Button>
            ),
          }}
        />
      )}
      <CreateAssessmentDialog open={createOpen} onOpenChange={setCreateOpen} />
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        destructive
        title={`Delete “${toDelete?.title}”?`}
        description="Quiz lessons linked to it will fail publish validation until relinked. Past attempts are kept."
        confirmLabel="Delete assessment"
        onConfirm={async () => {
          if (!toDelete) return;
          try {
            await api.delete(`/assessments/${toDelete.id}`);
            toast.success("Assessment deleted");
            qc.invalidateQueries({ queryKey: ak.assessments.all });
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
    </>
  );
}
