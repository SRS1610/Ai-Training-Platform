"use client";

import type { Page } from "@praxis/types";
import { Alert, Avatar, Badge, Breadcrumbs, Button, Skeleton, StatusPill } from "@praxis/ui";
import { useQuery } from "@tanstack/react-query";
import { AlertOctagon, ArrowLeft, ArrowRight, CalendarClock, Clock, MessageSquareWarning, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ErrorState } from "@/components/common/error-state";
import { AssignmentBrief } from "@/components/grading/assignment-brief";
import { GradeForm } from "@/components/grading/grade-form";
import { GradeHistory, IntegrityPanel } from "@/components/grading/history-integrity";
import { SlaChip } from "@/components/grading/queue";
import { SubmissionViewer } from "@/components/grading/submission-viewer";
import { GRADING_MODE_LABEL, SUBMISSION_STATUS, gk, type GradingDetail, type QueueItem, type StructuredField } from "@/components/grading/types";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

function WorkspaceSkeleton() {
  return (
    <div className="space-y-6" aria-busy aria-label="Loading submission">
      <Skeleton className="h-5 w-56" />
      <div className="flex items-center gap-4">
        <Skeleton className="size-12 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-7 w-72" />
          <Skeleton className="h-4 w-48" />
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_440px]">
        <Skeleton className="h-[560px] rounded-2xl" />
        <Skeleton className="h-[560px] rounded-2xl" />
      </div>
    </div>
  );
}

export default function GradingWorkspacePage() {
  const { submissionId } = useParams<{ submissionId: string }>();
  const router = useRouter();
  const q = useQuery({
    queryKey: gk.detail(submissionId),
    queryFn: ({ signal }) => api.get<GradingDetail>(`/grading/submissions/${submissionId}`, { signal }),
    refetchOnWindowFocus: false,
  });
  const next = useQuery({
    queryKey: gk.queue({ next: true }),
    queryFn: ({ signal }) => api.get<Page<QueueItem>>("/grading/queue", { signal, query: { page_size: 5 } }),
  });
  const nextItem = next.data?.items.find((i) => i.submission_id !== submissionId);

  if (q.isLoading) return <WorkspaceSkeleton />;
  if (q.isError || !q.data)
    return (
      <div className="space-y-4">
        <Button variant="ghost" asChild leftIcon={<ArrowLeft />}>
          <Link href="/app/instructor/grading">Back to queue</Link>
        </Button>
        <ErrorState error={q.error} onRetry={() => q.refetch()} size="lg" />
      </div>
    );

  const d = q.data;
  const sub = d.submission;
  const a = d.assignment;
  const st = SUBMISSION_STATUS[sub.status] ?? { label: sub.status, tone: "neutral" as const };
  const latest = [...d.versions].sort((x, y) => y.version_number - x.version_number)[0];
  const openSignals = d.integrity_signals.filter((s) => !s.review_outcome).length;

  return (
    <div className="space-y-6">
      <Breadcrumbs
        linkComponent={Link}
        items={[{ label: "Grading", href: "/app/instructor/grading" }, { label: a.title, href: `/app/instructor/grading?assignment=${a.id}` }, { label: d.learner.full_name }]}
      />
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <Avatar name={d.learner.full_name} size="lg" />
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-brand-700">Grading workspace</p>
            <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              {d.learner.full_name} <span className="font-medium text-slate-400">·</span> <span className="text-slate-700">{a.title}</span>
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">
              <StatusPill status={sub.status} label={st.label} tone={st.tone} />
              {a.high_stakes && (
                <Badge tone="warning">
                  <AlertOctagon aria-hidden /> High stakes
                </Badge>
              )}
              <Badge tone="neutral">{GRADING_MODE_LABEL[a.grading_mode] ?? a.grading_mode}</Badge>
              {sub.late && (
                <Badge tone="danger">
                  <CalendarClock aria-hidden /> Late
                </Badge>
              )}
              {openSignals > 0 && (
                <Badge tone="neutral">
                  <ShieldAlert aria-hidden /> {openSignals} signal{openSignals > 1 ? "s" : ""} to review
                </Badge>
              )}
              <SlaChip submittedAt={sub.submitted_at} />
              <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                <Clock className="size-3.5" aria-hidden /> Submitted {formatDateTime(sub.submitted_at)} · attempt {sub.submit_count}
                {a.max_submissions ? ` of ${a.max_submissions}` : ""}
              </span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="secondary" asChild leftIcon={<ArrowLeft />}>
            <Link href="/app/instructor/grading">Queue</Link>
          </Button>
          {nextItem && (
            <Button variant="soft" rightIcon={<ArrowRight />} onClick={() => router.push(`/app/instructor/grading/${nextItem.submission_id}`)}>
              Next submission
            </Button>
          )}
        </div>
      </header>

      {sub.review_requested && (
        <Alert tone="warning" icon={<MessageSquareWarning aria-hidden />} title="The learner requested a human review">
          {sub.review_request_note ? <span className="whitespace-pre-wrap">“{sub.review_request_note}”</span> : "No note was added."}
        </Alert>
      )}
      {sub.status === "returned" && sub.returned_feedback && (
        <Alert tone="info" title="Returned for resubmission">
          {sub.returned_feedback}
        </Alert>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_420px] xl:grid-cols-[minmax(0,1fr)_460px]">
        <div className="min-w-0 space-y-6">
          <SubmissionViewer versions={d.versions} fields={(a.structured_fields ?? []) as StructuredField[]} currentVersion={sub.current_version} />
          <AssignmentBrief assignment={a} version={latest} />
          <IntegrityPanel signals={d.integrity_signals} submissionId={sub.id} />
          <GradeHistory grades={d.grades} />
        </div>
        <aside aria-label="Scoring" className="min-w-0 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto lg:pb-2 lg:pr-1 lg:scrollbar-thin">
          <GradeForm detail={d} />
        </aside>
      </div>
    </div>
  );
}
