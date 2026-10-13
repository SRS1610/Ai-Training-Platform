"use client";

import type { Page } from "@praxis/types";
import {
  Card,
  FilterBar,
  KpiTile,
  PageHeader,
  SimpleSelect,
  Skeleton,
  Tabs,
  TabsTrigger,
  cn,
} from "@praxis/ui";
import { useQuery } from "@tanstack/react-query";
import { AlertOctagon, Bot, FileQuestion, Inbox, ListChecks } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { ErrorState } from "@/components/common/error-state";
import { SwitchChip } from "@/components/grading/list-input";
import { ScrollTabsList } from "@/components/grading/scroll-tabs";
import { QueueEmpty, QueueList, QueuePagination, QuizQueueList } from "@/components/grading/queue";
import { QUEUE_TABS, gk, type QueueItem, type QueueTabId, type ReviewQueueItem } from "@/components/grading/types";
import { useUrlState } from "@/components/grading/use-url-state";
import { api, type Query } from "@/lib/api";
import { usePermission } from "@/lib/auth";

const PAGE_SIZE = 20;
const KEYS = ["tab", "assignment", "course", "hs", "rr", "page"] as const;

interface Named {
  id: string;
  title: string;
}

function useCount(params: Query, enabled = true) {
  return useQuery({
    queryKey: gk.count(params),
    queryFn: ({ signal }) => api.get<Page<QueueItem>>("/grading/queue", { signal, query: { ...params, page_size: 1 } }),
    select: (d) => d.total,
    enabled,
  });
}

function GradingQueue() {
  const [state, set] = useUrlState(KEYS);
  const tab = (QUEUE_TABS.some((t) => t.id === state.tab) ? state.tab : "needs_review") as QueueTabId;
  const page = Math.max(1, Number(state.page) || 1);
  const canManage = usePermission("assignments.manage");
  const canCourses = usePermission("courses.view");
  const tabMeta = QUEUE_TABS.find((t) => t.id === tab)!;

  const filters = {
    assignment_id: state.assignment,
    course_id: state.course,
    high_stakes: state.hs === "1" ? true : undefined,
    review_requested: state.rr === "1" ? true : undefined,
  };
  const isQuiz = tab === "quiz";

  const queue = useQuery({
    queryKey: gk.queue({ ...filters, status: tabMeta.status, page }),
    queryFn: ({ signal }) =>
      api.get<Page<QueueItem>>("/grading/queue", {
        signal,
        query: { ...filters, status: tabMeta.status, page, page_size: PAGE_SIZE },
      }),
    enabled: !isQuiz,
    placeholderData: (prev) => prev,
  });
  const quiz = useQuery({
    queryKey: gk.quiz({ course_id: state.course, page }),
    queryFn: ({ signal }) =>
      api.get<Page<ReviewQueueItem>>("/assessments/review-queue", {
        signal,
        query: { course_id: state.course, page, page_size: PAGE_SIZE },
      }),
    enabled: isQuiz,
    placeholderData: (prev) => prev,
  });

  // Tab counters (unfiltered) for the KPI row and tab badges.
  const cNeeds = useCount({});
  const cAi = useCount({ status: "ai_graded" });
  const cUnder = useCount({ status: "under_review" });
  const cHigh = useCount({ high_stakes: true });
  const cQuiz = useQuery({
    queryKey: gk.quiz({ count: true }),
    queryFn: ({ signal }) => api.get<Page<ReviewQueueItem>>("/assessments/review-queue", { signal, query: { page_size: 1 } }),
    select: (d) => d.total,
  });
  const counts: Partial<Record<QueueTabId, number | undefined>> = {
    needs_review: cNeeds.data,
    ai_recommended: cAi.data,
    under_review: cUnder.data,
    quiz: cQuiz.data,
  };

  const assignments = useQuery({
    queryKey: gk.assignments,
    queryFn: ({ signal }) => api.get<Page<Named>>("/assignments", { signal, query: { page_size: 200 } }),
    enabled: canManage,
    staleTime: 5 * 60_000,
  });
  const courses = useQuery({
    queryKey: gk.courses,
    queryFn: ({ signal }) => api.get<Page<Named>>("/courses", { signal, query: { page_size: 200 } }),
    enabled: canCourses,
    staleTime: 5 * 60_000,
  });

  const filtered = !!(state.assignment || state.course || state.hs || state.rr);
  const active = isQuiz ? quiz : queue;
  const total = active.data?.total ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Grading"
        description="Review submissions with AI recommendations. Humans make the final call — every override is recorded."
        icon={<ListChecks />}
      />

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KpiTile label="Awaiting review" value={cNeeds.data ?? "—"} icon={<Inbox />} color="rose" hint="Submitted, AI-scored or review requested" />
        <KpiTile label="AI recommended" value={cAi.data ?? "—"} icon={<Bot />} color="violet" hint="Ready to confirm or override" />
        <KpiTile label="High stakes" value={cHigh.data ?? "—"} icon={<AlertOctagon />} color="amber" hint="Always require a human grade" />
        <KpiTile label="Quiz answers" value={cQuiz.data ?? "—"} icon={<FileQuestion />} color="sky" hint="Attempts with answers to mark" />
      </div>

      <Card className="overflow-hidden">
        <div className="space-y-4 border-b border-slate-100 p-4 sm:p-5">
          <Tabs value={tab} onValueChange={(v) => set({ tab: v === "needs_review" ? undefined : v, page: undefined })}>
            <ScrollTabsList aria-label="Queue" active={tab}>
              {QUEUE_TABS.map((t) => (
                <TabsTrigger key={t.id} value={t.id}>
                  {t.label}
                  {counts[t.id] !== undefined && (
                    <span
                      className={cn(
                        "min-w-5 rounded-full px-1.5 py-px text-2xs font-bold tabular-nums",
                        tab === t.id ? "bg-brand-600 text-white" : "bg-slate-200 text-slate-700",
                      )}
                    >
                      {counts[t.id]}
                    </span>
                  )}
                </TabsTrigger>
              ))}
            </ScrollTabsList>
          </Tabs>
          <FilterBar
            chips={[
              ...(state.assignment
                ? [{ key: "a", label: `Assignment: ${assignments.data?.items.find((a) => a.id === state.assignment)?.title ?? "Selected"}`, onRemove: () => set({ assignment: undefined, page: undefined }) }]
                : []),
              ...(state.course
                ? [{ key: "c", label: `Course: ${courses.data?.items.find((c) => c.id === state.course)?.title ?? "Selected"}`, onRemove: () => set({ course: undefined, page: undefined }) }]
                : []),
            ]}
            onClearAll={filtered ? () => set({ assignment: undefined, course: undefined, hs: undefined, rr: undefined, page: undefined }) : undefined}
          >
            {!isQuiz && canManage && (
              <SimpleSelect
                aria-label="Filter by assignment"
                className="h-9 w-full sm:w-60"
                value={state.assignment ?? "all"}
                onValueChange={(v) => set({ assignment: v === "all" ? undefined : v, page: undefined })}
                options={[{ value: "all", label: "All assignments" }, ...(assignments.data?.items ?? []).map((a) => ({ value: a.id, label: a.title }))]}
              />
            )}
            {canCourses && (
              <SimpleSelect
                aria-label="Filter by course"
                className="h-9 w-full sm:w-56"
                value={state.course ?? "all"}
                onValueChange={(v) => set({ course: v === "all" ? undefined : v, page: undefined })}
                options={[{ value: "all", label: "All courses" }, ...(courses.data?.items ?? []).map((c) => ({ value: c.id, label: c.title }))]}
              />
            )}
            {!isQuiz && (
              <>
                <SwitchChip checked={state.hs === "1"} onCheckedChange={(v) => set({ hs: v ? "1" : undefined, page: undefined })} label="High stakes" />
                <SwitchChip checked={state.rr === "1"} onCheckedChange={(v) => set({ rr: v ? "1" : undefined, page: undefined })} label="Review requested" />
              </>
            )}
          </FilterBar>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {tabMeta.hint}
            {active.data ? ` · ${total.toLocaleString()} item${total === 1 ? "" : "s"}` : ""}
            {!isQuiz && " · ordered by high stakes, review requests, then oldest first"}
          </p>
        </div>

        {active.isError ? (
          <ErrorState error={active.error} onRetry={() => active.refetch()} />
        ) : active.isLoading ? (
          isQuiz ? <QuizQueueList items={[]} loading /> : <QueueList items={[]} loading />
        ) : total === 0 ? (
          <QueueEmpty tab={tab} filtered={filtered} onClear={() => set({ assignment: undefined, course: undefined, hs: undefined, rr: undefined, page: undefined })} />
        ) : isQuiz ? (
          <QuizQueueList items={quiz.data?.items ?? []} />
        ) : (
          <QueueList items={queue.data?.items ?? []} />
        )}
        <QueuePagination page={page} pageSize={PAGE_SIZE} total={total} onPage={(p) => set({ page: p === 1 ? undefined : p })} />
      </Card>

      <p className="text-center text-xs text-muted-foreground">
        SLA colours: <span className="font-semibold text-emerald-700">under 24h</span> · <span className="font-semibold text-amber-800">24–72h</span> ·{" "}
        <span className="font-semibold text-rose-700">over 72h</span>. Need a rubric?{" "}
        <Link href="/app/instructor/assignments" className="font-medium text-brand-700 underline-offset-2 hover:underline">
          Manage assignments
        </Link>
      </p>
    </div>
  );
}

export default function GradingPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-2xl" />}>
      <GradingQueue />
    </Suspense>
  );
}
