"use client";

import {
  Button,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  FilterBar,
  PageHeader,
  Pagination,
  Skeleton,
  cn,
  colorClasses,
  toast,
} from "@praxis/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Layers, MoreHorizontal, Pencil, Plus, Scale, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { ErrorState } from "@/components/common/error-state";
import { api, errorMessage } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import { problemsMessage } from "../hooks";
import { ak } from "../keys";
import { ASSIGN_NAV } from "../assignments/assignment-list";
import { AIBadge, SubNav } from "../shared";
import type { Page, Rubric } from "../types";
import { balance, criterionColor, levelColor, toCriteriaIn, toLocalCriteria } from "./rubric-editor";

const PAGE_SIZE = 18;

function RubricCard({ r, onDuplicate, onDelete }: { r: Rubric; onDuplicate: () => void; onDelete: () => void }) {
  const t = r.criteria.reduce((s, c) => s + (Number(c.weight) || 0), 0);
  const balanced = Math.abs(t - 100) <= 0.01;
  const maxLevels = Math.max(0, ...r.criteria.map((c) => c.levels?.length ?? 0));
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-soft transition duration-300 ease-spring hover:-translate-y-1 hover:shadow-lift">
      <div className="pointer-events-none absolute -right-10 -top-10 size-36 rounded-full bg-emerald-400 opacity-[0.12] blur-2xl" aria-hidden />
      <div className="relative flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500 text-white shadow-sm" aria-hidden>
          <Scale className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-base font-semibold leading-snug text-slate-900">
            <Link href={`/app/instructor/rubrics/${r.id}`} className="rounded after:absolute after:inset-0 focus-visible:focus-ring">
              {r.title}
            </Link>
          </h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {r.criteria.length} criteria · {maxLevels} levels {r.ai_generated && <AIBadge />}
          </p>
        </div>
        <div className="relative z-10">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${r.title}`}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={`/app/instructor/rubrics/${r.id}`}>
                  <Pencil /> Edit
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onDuplicate}>
                <Copy /> Duplicate
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onSelect={onDelete}>
                <Trash2 /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {r.description && <p className="relative mt-3 line-clamp-2 text-sm text-muted-foreground">{r.description}</p>}
      <div className="relative mt-4">
        <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`Weights: ${r.criteria.map((c) => `${c.name} ${c.weight}`).join(", ")}`}>
          {r.criteria.map((c, i) => (
            <span key={c.id ?? i} className={cn("h-full border-r-2 border-white last:border-r-0", colorClasses(criterionColor(i)).solid)} style={{ width: `${((Number(c.weight) || 0) / Math.max(t, 1)) * 100}%` }} />
          ))}
        </div>
        <ul className="mt-3 space-y-1.5">
          {r.criteria.slice(0, 4).map((c, i) => (
            <li key={c.id ?? i} className="flex items-center justify-between gap-2 text-xs">
              <span className="flex min-w-0 items-center gap-1.5 text-slate-700">
                <span className={cn("size-2 shrink-0 rounded-full", colorClasses(criterionColor(i)).solid)} aria-hidden />
                <span className="truncate">{c.name}</span>
              </span>
              <span className="shrink-0 font-semibold tabular-nums text-slate-500">{balanced ? `${c.weight}%` : `${Math.round(((Number(c.weight) || 0) / Math.max(t, 1)) * 100)}%`}</span>
            </li>
          ))}
          {r.criteria.length > 4 && <li className="text-2xs text-muted-foreground">+{r.criteria.length - 4} more</li>}
        </ul>
      </div>
      <div className="relative mt-auto flex items-center justify-between pt-4">
        <div className="flex gap-0.5" aria-hidden>
          {Array.from({ length: Math.min(maxLevels, 6) }).map((_, j) => (
            <span key={j} className={cn("h-1.5 w-4 rounded-full", colorClasses(levelColor(j, Math.min(maxLevels, 6))).solid)} />
          ))}
        </div>
        <p className="text-2xs text-muted-foreground">Updated {formatRelative(r.updated_at)}</p>
      </div>
    </article>
  );
}

/** /app/instructor/rubrics */
export function RubricList() {
  const qc = useQueryClient();
  const router = useRouter();
  const [q, setQ] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [toDelete, setToDelete] = React.useState<Rubric | null>(null);
  const list = useQuery({
    queryKey: ak.rubrics.list({ q, page }),
    queryFn: ({ signal }) => api.get<Page<Rubric>>("/rubrics", { signal, query: { q: q || undefined, page, page_size: PAGE_SIZE } }),
    placeholderData: (p) => p,
  });
  const duplicate = useMutation({
    mutationFn: (r: Rubric) => {
      let criteria = toLocalCriteria(r.criteria);
      const t = criteria.reduce((s, c) => s + c.weight, 0);
      if (Math.abs(t - 100) > 0.01) criteria = balance(criteria);
      return api.post<Rubric>("/rubrics", { title: `${r.title} (copy)`.slice(0, 255), description: r.description, criteria: toCriteriaIn(criteria) });
    },
    onSuccess: (r) => {
      toast.success("Rubric duplicated");
      qc.invalidateQueries({ queryKey: ak.rubrics.all });
      router.push(`/app/instructor/rubrics/${r.id}`);
    },
    onError: (e) => toast.error(problemsMessage(e)),
  });
  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;

  return (
    <>
      <PageHeader
        title="Rubrics"
        description="Reusable, weighted grading criteria for assignments and open questions."
        icon={<Scale />}
        actions={
          <Button asChild variant="gradient" leftIcon={<Plus />}>
            <Link href="/app/instructor/rubrics/new">New rubric</Link>
          </Button>
        }
      />
      <SubNav items={ASSIGN_NAV} />
      <div className="mb-4">
        <FilterBar
          search={q}
          onSearchChange={(v) => {
            setQ(v);
            setPage(1);
          }}
          searchPlaceholder="Search rubrics…"
          actions={
            total > 0 ? (
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground" aria-live="polite">
                <Layers className="size-4" aria-hidden /> {total} rubric{total === 1 ? "" : "s"}
              </p>
            ) : undefined
          }
        />
      </div>
      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : list.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-64 rounded-2xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          bordered
          size="lg"
          illustration={q ? "search" : "trophy"}
          title={q ? "No rubrics match" : "No rubrics yet"}
          description={q ? "Try a different search." : "Build a rubric once and reuse it across assignments — the AI grader explains every score against it."}
          action={
            !q ? (
              <Button asChild variant="gradient" leftIcon={<Plus />}>
                <Link href="/app/instructor/rubrics/new">Create a rubric</Link>
              </Button>
            ) : undefined
          }
          secondaryAction={
            !q ? (
              <Button asChild variant="soft" leftIcon={<Sparkles />}>
                <Link href="/app/instructor/ai-builder">Generate with AI</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className={cn("stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-3", list.isFetching && "opacity-70 transition-opacity")}>
            {items.map((r) => (
              <RubricCard key={r.id} r={r} onDuplicate={() => duplicate.mutate(r)} onDelete={() => setToDelete(r)} />
            ))}
          </div>
          {total > PAGE_SIZE && <Pagination className="mt-6" page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />}
        </>
      )}
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        destructive
        title={`Delete “${toDelete?.title}”?`}
        description="Assignments using it keep their past grades, but AI grading needs a new rubric before they can be republished."
        confirmLabel="Delete rubric"
        onConfirm={async () => {
          if (!toDelete) return;
          try {
            await api.delete(`/rubrics/${toDelete.id}`);
            toast.success("Rubric deleted");
            qc.invalidateQueries({ queryKey: ak.rubrics.all });
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
    </>
  );
}
