"use client";

import { Badge, Button, Card, EmptyState, ProgressRing, Skeleton, StatusPill, cn, colorClasses, humanize, toast } from "@praxis/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, CheckCircle2, Clock, Eye, FileQuestion, History, Lock, PlayCircle, Repeat, Save, ShieldCheck, Target, Trophy } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ErrorState } from "@/components/common/error-state";
import { Markdown } from "@/components/common/markdown";
import { lk } from "@/components/learn/query-keys";
import type { Attempt, QuizOverview } from "@/components/learn/types";
import { HeroGlow, SectionTitle } from "@/components/learn/visuals";
import { ApiError, api, errorMessage } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

const KIND_LABEL: Record<string, string> = { quiz: "Quiz", final: "Final assessment", practice: "Practice quiz", survey: "Survey" };
const FEEDBACK_COPY: Record<string, string> = {
  after_submit: "You'll see per-question feedback as soon as you submit.",
  after_close: "Detailed feedback is released after the assessment closes.",
  never: "Only your overall score is shown for this assessment.",
};
const REASON_COPY: Record<string, string> = {
  max_attempts_reached: "You've used all your attempts for this assessment.",
  not_published: "This assessment isn't open yet.",
};

export default function QuizOverviewPage() {
  const { assessmentId } = useParams<{ assessmentId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: lk.quiz.overview(assessmentId),
    queryFn: ({ signal }) => api.get<QuizOverview>(`/assessments/${assessmentId}/overview`, { signal }),
    retry: (n, err) => !(err instanceof ApiError && err.status < 500) && n < 2,
  });
  const start = useMutation({
    mutationFn: () => api.post<Attempt>(`/assessments/${assessmentId}/attempts`),
    onSuccess: (a) => {
      qc.setQueryData(lk.quiz.attempt(a.id), a);
      qc.invalidateQueries({ queryKey: lk.quiz.overview(assessmentId) });
      router.push(`/app/quiz/${assessmentId}/attempt/${a.id}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isLoading)
    return (
      <div className="mx-auto max-w-5xl space-y-6" aria-busy aria-label="Loading assessment">
        <Skeleton className="h-64 rounded-3xl" />
        <Skeleton className="h-48 rounded-2xl" />
      </div>
    );
  if (q.isError || !q.data) {
    const err = q.error;
    if (err instanceof ApiError && (err.status === 404 || err.code === "not_enrolled"))
      return (
        <EmptyState
          size="lg"
          illustration={err.code === "not_enrolled" ? "shield" : "search"}
          title={err.code === "not_enrolled" ? "Enrol in the course to take this quiz" : "Assessment not found"}
          description={err.code === "not_enrolled" ? "This assessment belongs to a course you're not enrolled in." : "It may have been archived."}
          action={
            <Button asChild variant="gradient">
              <Link href="/app/learning">Go to my learning</Link>
            </Button>
          }
        />
      );
    return <ErrorState error={err} onRetry={() => q.refetch()} size="lg" />;
  }

  const ov = q.data;
  const a = ov.assessment;
  const resume = ov.in_progress_attempt_id;
  const tiles = [
    { icon: FileQuestion, label: "Questions", value: a.question_count, color: "sky" as const },
    { icon: Clock, label: "Time limit", value: a.time_limit_minutes ? `${a.time_limit_minutes} min` : "None", color: "violet" as const },
    { icon: Target, label: "Pass mark", value: `${Math.round(a.pass_percentage)}%`, color: "emerald" as const },
    {
      icon: Repeat,
      label: "Attempts",
      value: a.max_attempts ? `${ov.attempts_used} / ${a.max_attempts}` : `${ov.attempts_used} used`,
      color: "amber" as const,
    },
  ];
  const rules = [
    { icon: Save, text: "Answers save automatically as you go — you can leave and resume." },
    a.time_limit_minutes
      ? { icon: Clock, text: `The ${a.time_limit_minutes}-minute timer starts when you begin and keeps running if you leave. Unsaved work is submitted when time runs out.` }
      : { icon: Clock, text: "There's no time limit — take the time you need." },
    { icon: Eye, text: FEEDBACK_COPY[a.show_feedback] ?? FEEDBACK_COPY.after_submit! },
    {
      icon: ShieldCheck,
      text: a.high_stakes
        ? "This is a high-stakes assessment. Switching tabs or windows is recorded for reviewers — it never changes your score automatically."
        : "Switching tabs is recorded for review only and never affects your score automatically.",
    },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Button asChild variant="ghost" size="sm" leftIcon={<ArrowLeft />} className="-ml-2">
        <Link href={a.course_id ? `/app/learn/${a.course_id}` : "/app/learning"}>{a.course_id ? "Back to course" : "My learning"}</Link>
      </Button>

      <section className="relative overflow-hidden rounded-3xl bg-brand-gradient p-6 text-white shadow-glow sm:p-8">
        <HeroGlow />
        <div className="relative flex flex-col gap-6 md:flex-row md:items-center">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-semibold ring-1 ring-white/25">{KIND_LABEL[a.kind] ?? humanize(a.kind)}</span>
              {a.high_stakes && <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-semibold ring-1 ring-white/25">High stakes</span>}
              {ov.passed && (
                <span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-0.5 text-xs font-bold text-emerald-700">
                  <Trophy className="size-3.5" aria-hidden /> Passed
                </span>
              )}
            </div>
            <h1 className="mt-3 font-display text-2xl font-bold tracking-tight sm:text-3xl">{a.title}</h1>
            {a.description && <Markdown className="mt-2 max-w-2xl text-indigo-50 [&_*]:text-indigo-50">{a.description}</Markdown>}
            <div className="mt-6 flex flex-wrap items-center gap-3">
              {resume ? (
                <Button asChild variant="white" size="lg" rightIcon={<ArrowRight />}>
                  <Link href={`/app/quiz/${assessmentId}/attempt/${resume}`}>Resume attempt</Link>
                </Button>
              ) : ov.can_start ? (
                <Button variant="white" size="lg" leftIcon={<PlayCircle />} loading={start.isPending} onClick={() => start.mutate()}>
                  {ov.attempts_used ? "Start a new attempt" : "Start assessment"}
                </Button>
              ) : (
                <span className="inline-flex items-center gap-2 rounded-xl bg-white/15 px-4 py-2.5 text-sm font-semibold ring-1 ring-white/25">
                  <Lock className="size-4" aria-hidden /> {REASON_COPY[ov.reason ?? ""] ?? "You can't start a new attempt right now."}
                </span>
              )}
              {ov.attempts_remaining !== null && ov.can_start && (
                <span className="text-sm text-indigo-100">
                  {ov.attempts_remaining} attempt{ov.attempts_remaining === 1 ? "" : "s"} remaining
                </span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-4 rounded-2xl bg-white/10 p-4 ring-1 ring-white/20 backdrop-blur md:flex-col md:px-6">
            <div className="rounded-full bg-white p-1.5">
              <ProgressRing value={ov.best_percentage ?? 0} size={92} stroke={9} color={ov.passed ? "emerald" : "brand"} aria-label="Best score" label={ov.best_percentage === null ? <span className="font-display text-lg font-bold text-slate-400">—</span> : undefined} />
            </div>
            <div className="md:text-center">
              <p className="text-xs font-semibold uppercase tracking-wider text-indigo-100">Best score</p>
              <p className="text-sm text-white">{ov.best_percentage === null ? "No graded attempts yet" : ov.passed ? "Passed" : `Pass mark ${Math.round(a.pass_percentage)}%`}</p>
            </div>
          </div>
        </div>
      </section>

      <section aria-label="Assessment details" className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
        {tiles.map((t) => {
          const c = colorClasses(t.color);
          return (
            <div key={t.label} className={cn("rounded-2xl border bg-gradient-to-br p-4 shadow-soft", c.border, c.tint)}>
              <p className="flex items-center gap-2 text-sm font-medium text-slate-600">
                <span className={cn("grid size-8 place-items-center rounded-lg bg-gradient-to-br text-white", c.gradient)}>
                  <t.icon className="size-4" aria-hidden />
                </span>
                {t.label}
              </p>
              <p className="mt-2 font-display text-2xl font-bold tabular-nums text-slate-900">{t.value}</p>
            </div>
          );
        })}
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Card padded className="lg:col-span-2">
          <SectionTitle icon={ShieldCheck} color="indigo" title="Before you begin" />
          <ul className="mt-4 space-y-3">
            {rules.map((r, i) => (
              <li key={i} className="flex gap-3 text-sm text-slate-700">
                <r.icon className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />
                {r.text}
              </li>
            ))}
          </ul>
        </Card>
        <Card padded className="lg:col-span-3">
          <SectionTitle icon={History} color="violet" title="Your attempts" description={ov.attempts.length ? `${ov.attempts.length} so far` : undefined} />
          {ov.attempts.length === 0 ? (
            <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">You haven&apos;t attempted this yet. Good luck!</p>
          ) : (
            <ul className="mt-4 divide-y divide-slate-100">
              {[...ov.attempts].sort((x, y) => y.attempt_number - x.attempt_number).map((at) => {
                const href = at.status === "in_progress" ? `/app/quiz/${assessmentId}/attempt/${at.id}` : `/app/quiz/${assessmentId}/result/${at.id}`;
                return (
                  <li key={at.id}>
                    <Link href={href} className="-mx-2 flex items-center gap-3 rounded-xl px-2 py-3 transition hover:bg-slate-50 focus-visible:focus-ring">
                      <span
                        className={cn(
                          "grid size-11 shrink-0 place-items-center rounded-xl font-display text-sm font-bold",
                          at.passed ? "bg-emerald-100 text-emerald-800" : at.percentage !== null ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-600",
                        )}
                      >
                        {at.percentage !== null ? `${Math.round(at.percentage)}%` : "—"}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-slate-900">Attempt {at.attempt_number}</span>
                        <span className="block text-xs text-slate-500">{at.submitted_at ? `Submitted ${formatDateTime(at.submitted_at)}` : `Started ${formatDateTime(at.started_at)}`}</span>
                      </span>
                      {at.passed ? (
                        <Badge tone="success" size="sm">
                          <CheckCircle2 aria-hidden /> Passed
                        </Badge>
                      ) : (
                        <StatusPill status={at.status === "graded" && at.passed === false ? "failed" : at.status} label={at.status === "needs_review" ? "Awaiting review" : at.status === "graded" && at.passed === false ? "Not passed" : undefined} size="sm" />
                      )}
                      <ArrowRight className="size-4 text-slate-400" aria-hidden />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
