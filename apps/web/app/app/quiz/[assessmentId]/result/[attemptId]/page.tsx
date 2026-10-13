"use client";

import { Button, EmptyState, ProgressRing, Skeleton, Tabs, TabsList, TabsTrigger, cn } from "@praxis/ui";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Award, BookOpen, CheckCircle2, Clock, EyeOff, Hourglass, ListChecks, MinusCircle, RotateCcw, Sparkles, Target, Trophy, XCircle } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";
import { ErrorState } from "@/components/common/error-state";
import { Confetti } from "@/components/learn/celebration";
import { ResultQuestionCard } from "@/components/learn/quiz/answer-review";
import { lk } from "@/components/learn/query-keys";
import type { AttemptResult, QuizOverview } from "@/components/learn/types";
import { ApiError, api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

type Filter = "all" | "incorrect" | "correct" | "pending";

export default function QuizResultPage() {
  const { assessmentId, attemptId } = useParams<{ assessmentId: string; attemptId: string }>();
  const [filter, setFilter] = React.useState<Filter>("all");
  const q = useQuery({
    queryKey: lk.quiz.result(attemptId),
    queryFn: ({ signal }) => api.get<AttemptResult>(`/attempts/${attemptId}/result`, { signal }),
    refetchInterval: (query) => (query.state.data && ["submitted", "needs_review"].includes(query.state.data.status) ? 20_000 : false),
  });
  const ov = useQuery({
    queryKey: lk.quiz.overview(assessmentId),
    queryFn: ({ signal }) => api.get<QuizOverview>(`/assessments/${assessmentId}/overview`, { signal }),
    retry: false,
  });

  if (q.isLoading)
    return (
      <div className="mx-auto max-w-4xl space-y-6" aria-busy aria-label="Loading results">
        <Skeleton className="h-72 rounded-3xl" />
        <Skeleton className="h-40 rounded-2xl" />
      </div>
    );
  if (q.isError || !q.data)
    return q.error instanceof ApiError && q.error.status === 404 ? (
      <EmptyState size="lg" illustration="search" title="Result not found" action={<Button asChild><Link href={`/app/quiz/${assessmentId}`}>Back to assessment</Link></Button>} />
    ) : (
      <ErrorState error={q.error} onRetry={() => q.refetch()} size="lg" />
    );

  const r = q.data;
  const pending = r.status === "needs_review" || r.status === "submitted" || r.questions.some((x) => x.pending_review);
  const passed = r.passed === true && !pending;
  const failed = r.passed === false && !pending;
  const pct = r.percentage ?? 0;
  const counts = {
    correct: r.questions.filter((x) => x.is_correct === true).length,
    partial: r.questions.filter((x) => x.is_correct === false && (x.score ?? 0) > 0).length,
    incorrect: r.questions.filter((x) => x.is_correct === false && !((x.score ?? 0) > 0)).length,
    pending: r.questions.filter((x) => x.pending_review).length,
  };
  const shown = [...r.questions]
    .sort((a, b) => a.position - b.position)
    .map((x, i) => ({ x, i }))
    .filter(({ x }) => (filter === "all" ? true : filter === "correct" ? x.is_correct === true : filter === "incorrect" ? x.is_correct === false : x.pending_review));
  const courseId = ov.data?.assessment.course_id;
  // No retry offer until the final grade is in — the pending answers may still pass.
  const canRetry = ov.data?.can_start && !passed && !pending;

  const theme = passed
    ? { wrap: "from-emerald-500 via-teal-500 to-sky-500", icon: Trophy, title: "You passed! 🎉", sub: "Brilliant work — this result has been added to your progress." }
    : pending
      ? { wrap: "from-violet-500 via-fuchsia-500 to-indigo-500", icon: Hourglass, title: "Submitted — awaiting review", sub: "Some answers are being reviewed by an assessor (AI recommendations are checked by a person). We'll notify you when your final score is ready." }
      : failed
        ? { wrap: "from-amber-400 via-orange-500 to-rose-500", icon: Target, title: "Not quite there yet", sub: "Review the feedback below, revisit the lessons, then try again — you've got this." }
        : { wrap: "from-indigo-500 via-violet-500 to-fuchsia-500", icon: CheckCircle2, title: "Attempt submitted", sub: "Here's how you did." };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Button asChild variant="ghost" size="sm" leftIcon={<ArrowLeft />} className="-ml-2">
        <Link href={`/app/quiz/${assessmentId}`}>Assessment overview</Link>
      </Button>

      <section className={cn("relative overflow-hidden rounded-3xl bg-gradient-to-br p-px shadow-glow", theme.wrap)} aria-labelledby="result-title">
        <div className="relative overflow-hidden rounded-[calc(1.5rem-1px)] bg-white px-6 py-8 sm:px-10">
          {passed && <Confetti pieces={80} />}
          <div className={cn("pointer-events-none absolute -right-16 -top-16 size-64 rounded-full bg-gradient-to-br opacity-15 blur-2xl", theme.wrap)} aria-hidden />
          <div className="relative flex flex-col items-center gap-6 text-center md:flex-row md:text-left">
            <div className="relative">
              {pending ? (
                <div
                  role="img"
                  aria-label={`Score pending review${r.percentage !== null ? `, provisional ${Math.round(pct)}%` : ""}`}
                  className="grid size-[152px] place-items-center rounded-full bg-gradient-to-br from-violet-50 via-white to-fuchsia-50 ring-[14px] ring-inset ring-violet-100"
                >
                  <span className="flex flex-col items-center">
                    <Hourglass className="size-7 text-violet-600 motion-safe:animate-pulse" aria-hidden />
                    <span className="mt-1 font-display text-xl font-bold text-slate-900">Pending</span>
                    <span className="text-xs font-medium text-slate-500">
                      {r.percentage !== null && r.percentage > 0 ? `${Math.round(pct)}% so far` : "awaiting review"}
                    </span>
                  </span>
                </div>
              ) : (
                <ProgressRing
                  value={pct}
                  size={152}
                  stroke={14}
                  color={passed ? "emerald" : failed ? "amber" : "brand"}
                  aria-label={`Score ${r.percentage === null ? "pending" : `${Math.round(pct)}%`}`}
                  label={
                    <span className="flex flex-col items-center">
                      <span className="font-display text-4xl font-extrabold tabular-nums text-slate-900">{r.percentage === null ? "—" : `${Math.round(pct)}%`}</span>
                      <span className="text-xs font-medium text-slate-500">{r.score !== null && r.max_score !== null ? `${Math.round(r.score * 10) / 10} / ${r.max_score}` : "pending"}</span>
                    </span>
                  }
                />
              )}
              <span className={cn("absolute -bottom-1 -right-1 grid size-12 place-items-center rounded-2xl bg-gradient-to-br text-white shadow-lift", theme.wrap, pending && "hidden")}>
                <theme.icon className="size-6" aria-hidden />
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                {r.title} · attempt {r.attempt_number}
              </p>
              <h1 id="result-title" className="mt-1 font-display text-3xl font-bold tracking-tight text-slate-900">
                {theme.title}
              </h1>
              <p className="mt-2 max-w-xl text-slate-600">{theme.sub}</p>
              <dl className="mt-4 flex flex-wrap justify-center gap-x-5 gap-y-1.5 text-sm text-slate-600 md:justify-start">
                <div className="flex items-center gap-1.5">
                  <Target className="size-4 text-slate-400" aria-hidden />
                  <dt className="sr-only">Pass mark</dt>
                  <dd>Pass mark {Math.round(r.pass_percentage)}%</dd>
                </div>
                {r.submitted_at && (
                  <div className="flex items-center gap-1.5">
                    <Clock className="size-4 text-slate-400" aria-hidden />
                    <dt className="sr-only">Submitted</dt>
                    <dd>{formatDateTime(r.submitted_at)}</dd>
                  </div>
                )}
                {r.late && (
                  <div className="font-semibold text-amber-800">
                    <dt className="sr-only">Late</dt>
                    <dd>Submitted late</dd>
                  </div>
                )}
              </dl>
              <div className="mt-5 flex flex-wrap justify-center gap-2 md:justify-start">
                {canRetry && (
                  <Button asChild variant="gradient" leftIcon={<RotateCcw />}>
                    <Link href={`/app/quiz/${assessmentId}`}>Try again</Link>
                  </Button>
                )}
                {courseId && (
                  <Button asChild variant={canRetry ? "secondary" : "gradient"} leftIcon={<BookOpen />}>
                    <Link href={`/app/learn/${courseId}`}>{failed ? "Review the course" : "Continue course"}</Link>
                  </Button>
                )}
                {passed && (
                  <Button asChild variant="secondary" leftIcon={<Award />}>
                    <Link href="/app/achievements">See achievements</Link>
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section aria-label="Summary" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Correct", value: counts.correct, icon: CheckCircle2, cls: "from-emerald-50 border-emerald-200 text-emerald-700" },
          { label: "Partly right", value: counts.partial, icon: MinusCircle, cls: "from-amber-50 border-amber-200 text-amber-800" },
          { label: "Incorrect", value: counts.incorrect, icon: XCircle, cls: "from-rose-50 border-rose-200 text-rose-700" },
          { label: "In review", value: counts.pending, icon: Hourglass, cls: "from-violet-50 border-violet-200 text-violet-700" },
        ].map((t) => (
          <div key={t.label} className={cn("rounded-2xl border bg-gradient-to-br via-white to-white p-4 shadow-soft", t.cls)}>
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider">
              <t.icon className="size-4" aria-hidden />
              {t.label}
            </p>
            <p className="mt-1 font-display text-2xl font-bold tabular-nums text-slate-900">{t.value}</p>
          </div>
        ))}
      </section>

      {r.feedback_available ? (
        <section aria-labelledby="fb-title" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="fb-title" className="flex items-center gap-2 font-display text-lg font-semibold text-slate-900">
              <ListChecks className="size-5 text-brand-600" aria-hidden /> Question feedback
            </h2>
            <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
              <TabsList aria-label="Filter questions">
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="incorrect">Incorrect</TabsTrigger>
                <TabsTrigger value="correct">Correct</TabsTrigger>
                {counts.pending > 0 && <TabsTrigger value="pending">In review</TabsTrigger>}
              </TabsList>
            </Tabs>
          </div>
          {shown.length === 0 ? (
            <p className="rounded-2xl bg-slate-50 p-5 text-center text-sm text-slate-600">No questions in this view.</p>
          ) : (
            <div className="space-y-4">
              {shown.map(({ x, i }) => (
                <ResultQuestionCard key={x.id} q={x} index={i} />
              ))}
            </div>
          )}
        </section>
      ) : (
        <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-500">
            <EyeOff className="size-5" aria-hidden />
          </span>
          <div>
            <p className="font-semibold text-slate-900">Detailed feedback isn&apos;t available yet</p>
            <p className="mt-1 text-sm text-slate-600">
              Your instructor releases per-question feedback for this assessment after it closes (or keeps it private). Your overall score is shown above.
            </p>
          </div>
        </div>
      )}

      {pending && (
        <p className="flex items-center justify-center gap-2 text-xs text-slate-500">
          <Sparkles className="size-3.5" aria-hidden /> This page refreshes automatically while your attempt is being reviewed.
        </p>
      )}
    </div>
  );
}
