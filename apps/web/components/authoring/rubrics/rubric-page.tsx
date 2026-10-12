"use client";

import { Badge, Breadcrumbs, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from "@praxis/ui";
import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck, Eye, Pencil, Scale } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { ErrorState } from "@/components/common/error-state";
import { api } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import { ak } from "../keys";
import { ASSIGN_NAV } from "../assignments/assignment-list";
import { AIBadge, AStatus, GradientHeader, SubNav } from "../shared";
import type { Assignment, Page, Rubric } from "../types";
import { RubricEditor, RubricGrid, WeightBar } from "./rubric-editor";

function UsedBy({ rubricId }: { rubricId: string }) {
  const q = useQuery({
    queryKey: ak.assignments.list({ rubric_usage: true }),
    queryFn: ({ signal }) => api.get<Page<Assignment>>("/assignments", { signal, query: { page_size: 200 } }),
    staleTime: 30_000,
  });
  const used = (q.data?.items ?? []).filter((a) => a.rubric_id === rubricId);
  if (q.isLoading) return <Skeleton className="h-16 rounded-2xl" />;
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-soft">
      <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        <ClipboardCheck className="size-4 text-amber-600" aria-hidden /> Used by {used.length} assignment{used.length === 1 ? "" : "s"}
      </p>
      {used.length > 0 ? (
        <ul className="mt-3 space-y-1.5">
          {used.map((a) => (
            <li key={a.id}>
              <Link href={`/app/instructor/assignments/${a.id}`} className="flex items-center justify-between gap-2 rounded-xl px-2 py-1.5 text-sm hover:bg-slate-50 focus-visible:focus-ring">
                <span className="line-clamp-2 font-medium text-slate-800">{a.title}</span>
                <AStatus status={a.status} size="sm" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">Attach it from an assignment’s Rubric section.</p>
      )}
      {used.some((a) => a.status === "published") && <p className="mt-3 text-2xs text-amber-800">Edits apply to future grading of published assignments.</p>}
    </div>
  );
}

function Header({ rubric }: { rubric: Rubric | null }) {
  return (
    <GradientHeader color="emerald">
      <div className="flex items-start gap-4 p-5 sm:p-6">
        <span className="hidden size-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500 text-white shadow-glow sm:grid">
          <Scale className="size-7" aria-hidden />
        </span>
        <div className="min-w-0">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <Badge tone="success" size="sm">
              Rubric
            </Badge>
            {rubric?.ai_generated && <AIBadge />}
          </div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{rubric ? rubric.title : "New rubric"}</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {rubric ? `${rubric.criteria.length} criteria · updated ${formatRelative(rubric.updated_at)}` : "Start from the template below — rename criteria, tune weights and describe each level."}
          </p>
        </div>
      </div>
    </GradientHeader>
  );
}

/** /app/instructor/rubrics/[id] (or /new). */
export function RubricPage({ rubricId }: { rubricId: string }) {
  const router = useRouter();
  const isNew = rubricId === "new";
  const [tab, setTab] = React.useState("edit");
  const q = useQuery({
    queryKey: ak.rubrics.detail(rubricId),
    enabled: !isNew,
    queryFn: ({ signal }) => api.get<Rubric>(`/rubrics/${rubricId}`, { signal }),
  });

  const crumbs = (
    <>
      <Breadcrumbs linkComponent={Link} items={[{ label: "Rubrics", href: "/app/instructor/rubrics" }, { label: isNew ? "New rubric" : (q.data?.title ?? "Rubric") }]} />
      <SubNav items={ASSIGN_NAV} className="mb-0" />
    </>
  );

  if (isNew)
    return (
      <div className="space-y-5">
        {crumbs}
        <Header rubric={null} />
        <RubricEditor onSaved={(r) => router.replace(`/app/instructor/rubrics/${r.id}`)} onCancel={() => router.push("/app/instructor/rubrics")} />
      </div>
    );
  if (q.isLoading)
    return (
      <div className="space-y-5">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-32 rounded-3xl" />
        <Skeleton className="h-96 rounded-3xl" />
      </div>
    );
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} size="lg" />;
  const r = q.data;
  return (
    <div className="space-y-5">
      {crumbs}
      <Header rubric={r} />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList variant="underline">
          <TabsTrigger value="edit">
            <Pencil aria-hidden /> Edit
          </TabsTrigger>
          <TabsTrigger value="preview">
            <Eye aria-hidden /> Grid preview
          </TabsTrigger>
        </TabsList>
        <TabsContent value="edit">
          <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
            <RubricEditor key={r.updated_at} rubric={r} />
            <aside className="space-y-4 xl:sticky xl:top-20">
              <UsedBy rubricId={r.id} />
            </aside>
          </div>
        </TabsContent>
        <TabsContent value="preview">
          <div className="space-y-4">
            <WeightBar criteria={r.criteria} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft" />
            <RubricGrid criteria={r.criteria} />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
