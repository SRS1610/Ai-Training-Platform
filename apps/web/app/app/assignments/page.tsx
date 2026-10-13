"use client";

import type { Page } from "@praxis/types";
import { Badge, Button, EmptyState, Input, KpiTile, PageHeader, Skeleton, Tabs, TabsList, TabsTrigger, cn, colorClasses } from "@praxis/ui";
import { useQueries, useQuery } from "@tanstack/react-query";
import { ArrowRight, Bot, ClipboardCheck, Files, Lock, PenSquare, Search, Send, Trophy } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Suspense } from "react";
import { ErrorState } from "@/components/common/error-state";
import { GRADING_MODE_LABEL, PHASE_META, type SubmissionPhase, submissionPhase } from "@/components/learn/assignments/meta";
import { lk } from "@/components/learn/query-keys";
import type { LearnerAssignment, MyEnrolment, Submission } from "@/components/learn/types";
import { useUrlState } from "@/components/learn/use-url-state";
import { CourseCover, DueChip } from "@/components/learn/visuals";
import { ApiError, api } from "@/lib/api";
import { formatRelative } from "@/lib/format";

type Filter = "todo" | "submitted" | "graded" | "all";
const TODO: SubmissionPhase[] = ["not_started", "draft", "returned"];
const IN_REVIEW: SubmissionPhase[] = ["submitted", "ai_grading", "ai_graded", "under_review"];
const GRADED: SubmissionPhase[] = ["graded_passed", "graded_failed"];

interface Row {
  a: LearnerAssignment;
  s: Submission | null;
  phase: SubmissionPhase;
  locked: boolean;
  loading: boolean;
  course?: MyEnrolment;
  due: string | null;
}

function AssignmentRow({ r }: { r: Row }) {
  const meta = PHASE_META[r.phase];
  const c = colorClasses(meta.color);
  const pct = r.s?.final_score ?? null;
  const cta = r.locked ? "View brief" : r.phase === "not_started" ? "Start" : r.phase === "draft" ? "Continue" : r.phase === "returned" ? "Revise" : GRADED.includes(r.phase) ? "View feedback" : "View submission";
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-soft transition duration-300 ease-spring hover:-translate-y-0.5 hover:shadow-lift focus-within:ring-2 focus-within:ring-brand-500/40 sm:flex-row">
      <CourseCover category={r.course?.category ?? "Assignment"} thumbnailUrl={null} iconSize="sm" className="h-20 shrink-0 sm:h-auto sm:w-36">
        <span className={cn("absolute inset-x-0 bottom-0 h-1", c.solid)} aria-hidden />
      </CourseCover>
      <div className="flex min-w-0 flex-1 flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-5 sm:p-5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={meta.tone} size="sm">
              <meta.icon aria-hidden /> {meta.label}
            </Badge>
            {r.a.grading_mode.startsWith("ai") && (
              <Badge tone="violet" size="sm">
                <Bot aria-hidden /> {r.a.grading_mode === "ai_recommend_human_final" ? "AI + assessor" : "AI graded"}
              </Badge>
            )}
            {r.a.high_stakes && (
              <Badge tone="danger" size="sm">
                High stakes
              </Badge>
            )}
            {r.locked && (
              <Badge tone="neutral" size="sm">
                <Lock aria-hidden /> Enrol to start
              </Badge>
            )}
          </div>
          <h3 className="mt-1.5 font-display text-base font-semibold text-slate-900">
            <Link href={`/app/assignments/${r.a.id}`} className="after:absolute after:inset-0 focus-visible:outline-none">
              {r.a.title}
            </Link>
          </h3>
          <p className="mt-0.5 line-clamp-1 text-sm text-slate-600">{r.a.objective || r.a.scenario}</p>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-slate-500">
            {r.course && <span className="font-medium text-slate-600">{r.course.title}</span>}
            {r.due && !GRADED.includes(r.phase) && <DueChip date={r.due} />}
            <span>{GRADING_MODE_LABEL[r.a.grading_mode] ?? r.a.grading_mode}</span>
            <span>Pass {Math.round(r.a.passing_score)}%</span>
            {r.s?.latest_version && <span>v{r.s.current_version} · saved {formatRelative(r.s.latest_version.created_at)}</span>}
          </div>
        </div>
        <div className="relative z-10 flex items-center justify-between gap-4 sm:flex-col sm:items-end sm:justify-center">
          {pct !== null ? (
            <span className={cn("font-display text-2xl font-bold tabular-nums", r.s?.passed ? "text-emerald-700" : "text-rose-700")}>{Math.round(pct)}%</span>
          ) : r.loading ? (
            <Skeleton className="h-6 w-16" />
          ) : null}
          <Button asChild size="sm" variant={TODO.includes(r.phase) && !r.locked ? "primary" : "secondary"} rightIcon={<ArrowRight />}>
            <Link href={`/app/assignments/${r.a.id}`}>{cta}</Link>
          </Button>
        </div>
      </div>
    </article>
  );
}

function AssignmentsList() {
  const url = useUrlState();
  const tabParam = url.get("tab");
  const [term, setTerm] = React.useState("");
  const list = useQuery({
    queryKey: lk.assignments.list({ page_size: 100 }),
    queryFn: ({ signal }) => api.get<Page<LearnerAssignment>>("/assignments", { signal, query: { page_size: 100 } }),
  });
  const enrolments = useQuery({ queryKey: lk.enrolments.me, queryFn: ({ signal }) => api.get<MyEnrolment[]>("/enrolments/me", { signal }) });
  const enrolled = new Map((enrolments.data ?? []).map((e) => [e.course_id, e]));
  const items = (list.data?.items ?? []).filter((a) => !a.course_id || enrolled.has(a.course_id) || !enrolments.isSuccess);
  const subs = useQueries({
    queries: items.map((a) => ({
      queryKey: lk.assignments.submission(a.id),
      queryFn: ({ signal }: { signal: AbortSignal }) => api.get<Submission | null>(`/assignments/${a.id}/submission`, { signal }),
      retry: false,
      enabled: list.isSuccess,
    })),
  });

  const rows: Row[] = items.map((a, i) => {
    const sq = subs[i];
    const s = (sq?.data as Submission | null | undefined) ?? null;
    const course = a.course_id ? enrolled.get(a.course_id) : undefined;
    const locked = sq?.error instanceof ApiError && sq.error.code === "not_enrolled";
    const due = s?.due_at ?? (a.due_days_after_enrolment !== null && course ? new Date(new Date(course.created_at).getTime() + a.due_days_after_enrolment * 86400000).toISOString() : null);
    return { a, s, phase: submissionPhase(s), locked, loading: !!sq?.isLoading, course, due };
  });
  const counts = {
    todo: rows.filter((r) => TODO.includes(r.phase)).length,
    submitted: rows.filter((r) => IN_REVIEW.includes(r.phase)).length,
    graded: rows.filter((r) => GRADED.includes(r.phase)).length,
    all: rows.length,
  };
  const passed = rows.filter((r) => r.phase === "graded_passed").length;
  // With nothing to do, open on "All" rather than an empty tab (an explicit ?tab= always wins).
  const settled = list.isSuccess && enrolments.isSuccess && subs.every((q) => !q.isLoading);
  const defaultFilter: Filter = settled && counts.todo === 0 && rows.length > 0 ? "all" : "todo";
  const filter = (["todo", "submitted", "graded", "all"].includes(tabParam ?? "") ? tabParam : defaultFilter) as Filter;
  const needle = term.trim().toLowerCase();
  const shown = rows
    .filter((r) => (filter === "todo" ? TODO.includes(r.phase) : filter === "submitted" ? IN_REVIEW.includes(r.phase) : filter === "graded" ? GRADED.includes(r.phase) : true))
    .filter((r) => !needle || r.a.title.toLowerCase().includes(needle) || (r.course?.title ?? "").toLowerCase().includes(needle))
    .sort((x, y) => (x.due ?? "9999").localeCompare(y.due ?? "9999") || x.a.title.localeCompare(y.a.title));
  const loading = list.isLoading || enrolments.isLoading;

  return (
    <>
      <PageHeader
        title="Assignments"
        description="Practical, real-world tasks from your courses — draft, attach evidence, submit and get rubric-based feedback."
        icon={<ClipboardCheck />}
        actions={
          <Button asChild variant="secondary" leftIcon={<Files />}>
            <Link href="/app/learning">My learning</Link>
          </Button>
        }
      />

      <section aria-label="Summary" className="stagger mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <KpiTile label="To do" value={loading ? "—" : counts.todo} icon={<PenSquare />} color="amber" hint="Not started, drafts or returned" />
        <KpiTile label="In review" value={loading ? "—" : counts.submitted} icon={<Send />} color="violet" hint="With your assessors" />
        <KpiTile label="Graded" value={loading ? "—" : counts.graded} icon={<ClipboardCheck />} color="sky" hint="Feedback released" />
        <KpiTile label="Passed" value={loading ? "—" : passed} icon={<Trophy />} color="emerald" hint="Met the standard" />
      </section>

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={filter} onValueChange={(v) => url.set({ tab: v === defaultFilter ? null : v })}>
          <TabsList aria-label="Filter assignments" className="max-w-full overflow-x-auto no-scrollbar">
            {(
              [
                ["todo", "To do"],
                ["submitted", "In review"],
                ["graded", "Graded"],
                ["all", "All"],
              ] as const
            ).map(([k, label]) => (
              <TabsTrigger key={k} value={k}>
                {label} <span className="text-xs tabular-nums text-slate-500">{counts[k]}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="sm:w-72">
          <Input value={term} onChange={(e) => setTerm(e.target.value)} leftIcon={<Search />} placeholder="Search assignments" aria-label="Search assignments" type="search" />
        </div>
      </div>

      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : loading ? (
        <div className="space-y-4" aria-busy aria-label="Loading assignments">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <EmptyState
          bordered
          illustration={needle ? "search" : filter === "graded" ? "trophy" : "inbox"}
          title={
            needle
              ? "No assignments match your search"
              : filter === "todo"
                ? rows.length
                  ? "You're all caught up"
                  : "No assignments yet"
                : filter === "submitted"
                  ? "Nothing waiting for review"
                  : filter === "graded"
                    ? "No graded assignments yet"
                    : "No assignments yet"
          }
          description={
            rows.length
              ? "Switch tabs to see the rest of your assignments."
              : "Practical assignments from the courses you're enrolled in will appear here."
          }
          action={
            !rows.length ? (
              <Button asChild variant="gradient">
                <Link href="/app/catalog">Explore courses</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="stagger space-y-4">
          {shown.map((r) => (
            <li key={r.a.id}>
              <AssignmentRow r={r} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export default function AssignmentsPage() {
  return (
    <Suspense fallback={null}>
      <AssignmentsList />
    </Suspense>
  );
}
