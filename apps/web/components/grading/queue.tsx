"use client";

import { Avatar, Badge, Button, EmptyState, Pagination, Skeleton, StatusPill, cn } from "@praxis/ui";
import { AlertOctagon, ArrowRight, Bot, ChevronRight, Clock, FileQuestion, Flag, MessageSquareWarning, ShieldAlert } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { formatRelative } from "@/lib/format";
import { GRADING_MODE_LABEL, SUBMISSION_STATUS, slaTone, type QueueItem, type ReviewQueueItem } from "./types";

const SLA_CLASSES = {
  success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  warning: "bg-amber-50 text-amber-800 ring-amber-200",
  danger: "bg-rose-50 text-rose-700 ring-rose-200",
  neutral: "bg-slate-100 text-slate-600 ring-slate-200",
} as const;

export function SlaChip({ submittedAt, className }: { submittedAt: string | null | undefined; className?: string }) {
  const sla = slaTone(submittedAt);
  const words = sla.tone === "danger" ? "over SLA" : sla.tone === "warning" ? "approaching SLA" : "within SLA";
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ring-1 ring-inset", SLA_CLASSES[sla.tone], className)}
      title={submittedAt ? `Waiting ${sla.label} — ${words} (72h)` : undefined}
    >
      <Clock className="size-3" aria-hidden />
      {sla.label}
      <span className="sr-only">waiting, {words}</span>
    </span>
  );
}

/** Small circular score chip, coloured pass/fail. */
export function ScoreChip({ score, passed, label = "AI", confidence }: { score: number; passed?: boolean | null; label?: string; confidence?: number | null }) {
  const good = passed ?? score >= 70;
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold tabular-nums ring-1 ring-inset",
          good ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-rose-50 text-rose-700 ring-rose-200",
        )}
      >
        <Bot className="size-3.5" aria-hidden />
        <span className="sr-only">{label} score</span>
        {Math.round(score)}%
      </span>
      {confidence !== null && confidence !== undefined && (
        <span className="text-2xs font-medium text-slate-500" title="Model confidence">
          conf {Math.round(confidence * 100)}%
        </span>
      )}
    </span>
  );
}

function RowShell({ href, children, highlight }: { href: string; children: React.ReactNode; highlight?: boolean }) {
  return (
    <li>
      <Link
        href={href}
        className={cn(
          "group relative grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 px-4 py-3.5 transition-colors hover:bg-brand-50/40 focus-visible:z-10 focus-visible:focus-ring sm:px-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1.5fr)_150px_150px_92px_24px]",
          highlight && "before:absolute before:inset-y-2 before:left-0 before:w-1 before:rounded-r-full before:bg-gradient-to-b before:from-amber-400 before:to-rose-500",
        )}
      >
        {children}
      </Link>
    </li>
  );
}

export function QueueList({ items, loading }: { items: QueueItem[]; loading?: boolean }) {
  if (loading) return <ListSkeleton />;
  return (
    <ul className="divide-y divide-slate-100" aria-label="Submissions awaiting review">
      {items.map((it) => {
        const st = SUBMISSION_STATUS[it.status] ?? { label: it.status, tone: "neutral" as const };
        return (
          <RowShell key={it.submission_id} href={`/app/instructor/grading/${it.submission_id}`} highlight={it.high_stakes}>
            <div className="flex min-w-0 items-center gap-3">
              <Avatar name={it.learner_name} size="sm" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">{it.learner_name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  v{it.version} · submitted {formatRelative(it.submitted_at)}
                </p>
              </div>
            </div>
            <div className="col-span-2 row-start-2 min-w-0 lg:col-span-1 lg:row-start-auto">
              <p className="truncate text-sm font-medium text-slate-800">{it.assignment_title}</p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {it.high_stakes && (
                  <Badge tone="warning" size="sm">
                    <AlertOctagon aria-hidden /> High stakes
                  </Badge>
                )}
                {it.review_requested && (
                  <Badge tone="violet" size="sm">
                    <MessageSquareWarning aria-hidden /> Review requested
                  </Badge>
                )}
                {it.integrity_flags > 0 && (
                  <Badge tone="neutral" size="sm" title="Supplementary integrity signal awaiting review">
                    <ShieldAlert aria-hidden /> {it.integrity_flags} signal{it.integrity_flags > 1 ? "s" : ""}
                  </Badge>
                )}
                <span className="text-2xs font-medium text-slate-500">{GRADING_MODE_LABEL[it.grading_mode] ?? it.grading_mode}</span>
              </div>
            </div>
            <div className="col-start-1 row-start-3 flex items-center gap-2 lg:col-start-auto lg:row-start-auto">
              <StatusPill status={it.status} label={st.label} tone={st.tone} size="sm" />
            </div>
            <div className="col-start-2 row-start-3 justify-self-end lg:col-start-auto lg:row-start-auto lg:justify-self-start">
              {it.ai_recommendation ? (
                <ScoreChip score={it.ai_recommendation.score} passed={it.ai_recommendation.passed} confidence={it.ai_recommendation.confidence} />
              ) : (
                <span className="text-xs text-slate-500">No AI score</span>
              )}
            </div>
            <div className="col-start-2 row-start-1 justify-self-end lg:col-start-auto lg:row-start-auto lg:justify-self-start">
              <SlaChip submittedAt={it.submitted_at} />
            </div>
            <ChevronRight className="hidden size-4 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-600 lg:block" aria-hidden />
          </RowShell>
        );
      })}
    </ul>
  );
}

export function QuizQueueList({ items, loading }: { items: ReviewQueueItem[]; loading?: boolean }) {
  if (loading) return <ListSkeleton />;
  return (
    <ul className="divide-y divide-slate-100" aria-label="Quiz attempts awaiting manual marks">
      {items.map((it) => (
        <RowShell key={it.attempt_id} href={`/app/instructor/grading/attempts/${it.attempt_id}`} highlight={it.high_stakes}>
          <div className="flex min-w-0 items-center gap-3">
            <Avatar name={it.learner_name} size="sm" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">{it.learner_name}</p>
              <p className="truncate text-xs text-muted-foreground">
                Attempt {it.attempt_number} · submitted {formatRelative(it.submitted_at)}
              </p>
            </div>
          </div>
          <div className="col-span-2 row-start-2 min-w-0 lg:col-span-1 lg:row-start-auto">
            <p className="flex items-center gap-1.5 truncate text-sm font-medium text-slate-800">
              <FileQuestion className="size-4 shrink-0 text-sky-600" aria-hidden />
              <span className="truncate">{it.assessment_title}</span>
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {it.high_stakes && (
                <Badge tone="warning" size="sm">
                  <AlertOctagon aria-hidden /> High stakes
                </Badge>
              )}
              <span className="text-2xs font-medium text-slate-500">{GRADING_MODE_LABEL[it.grading_mode] ?? it.grading_mode}</span>
            </div>
          </div>
          <div className="col-start-1 row-start-3 lg:col-start-auto lg:row-start-auto">
            <Badge tone="info" size="sm">
              <Flag aria-hidden /> {it.pending_questions} answer{it.pending_questions === 1 ? "" : "s"} to mark
            </Badge>
          </div>
          <div className="col-start-2 row-start-3 justify-self-end lg:col-start-auto lg:row-start-auto lg:justify-self-start">
            <StatusPill status="needs_review" label="Needs review" tone="violet" size="sm" />
          </div>
          <div className="col-start-2 row-start-1 justify-self-end lg:col-start-auto lg:row-start-auto lg:justify-self-start">
            <SlaChip submittedAt={it.submitted_at} />
          </div>
          <ChevronRight className="hidden size-4 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-600 lg:block" aria-hidden />
        </RowShell>
      ))}
    </ul>
  );
}

function ListSkeleton() {
  return (
    <ul className="divide-y divide-slate-100" aria-busy aria-label="Loading">
      {Array.from({ length: 6 }).map((_, i) => (
        <li key={i} className="flex items-center gap-4 px-5 py-4">
          <Skeleton className="size-8 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="hidden h-4 w-48 md:block" />
          <Skeleton className="h-6 w-20 rounded-full" />
        </li>
      ))}
    </ul>
  );
}

export function QueueEmpty({ tab, filtered, onClear }: { tab: string; filtered: boolean; onClear: () => void }) {
  if (filtered)
    return (
      <EmptyState
        illustration="search"
        title="No matches for these filters"
        description="Try another assignment or course, or clear the filters."
        action={
          <Button variant="secondary" onClick={onClear}>
            Clear filters
          </Button>
        }
      />
    );
  const copy: Record<string, [string, string]> = {
    needs_review: ["Inbox zero — nicely done", "New submissions appear here as learners hand in their work. High-stakes items always float to the top."],
    ai_recommended: ["No AI recommendations waiting", "When the AI scores a high-stakes or human-final submission, it lands here for your decision."],
    under_review: ["Nothing under review", "Submissions you or other assessors pick up will show here."],
    graded: ["No graded submissions yet", "Final grades will be listed here. You can re-grade with an override reason."],
    quiz: ["No quiz answers to mark", "Free-text answers that need a human mark will queue here after learners submit."],
  };
  const [title, description] = copy[tab] ?? copy.needs_review!;
  return (
    <EmptyState
      illustration={tab === "graded" ? "trophy" : "inbox"}
      title={title}
      description={description}
      action={
        tab !== "needs_review" ? undefined : (
          <Button variant="soft" asChild rightIcon={<ArrowRight />}>
            <Link href="/app/instructor/assignments">Manage assignments</Link>
          </Button>
        )
      }
    />
  );
}

export function QueuePagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  if (total <= pageSize) return null;
  return (
    <div className="border-t border-slate-100 p-3 sm:px-5">
      <Pagination page={page} pageSize={pageSize} total={total} onPageChange={onPage} />
    </div>
  );
}
