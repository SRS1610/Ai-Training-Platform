"use client";

import type { Page } from "@praxis/types";
import { BandChip, Badge, Button, ProgressRing, Skeleton, StatusPill, cn, colorClasses } from "@praxis/ui";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Bot, ClipboardCheck, Clock, HelpCircle, MonitorPlay, Repeat, Sparkles, Target, Trophy } from "lucide-react";
import Link from "next/link";
import { Markdown } from "@/components/common/markdown";
import { ApiError, api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { lk } from "../query-keys";
import type { LessonPayload, LessonState, QuizOverview, Submission } from "../types";
import { str } from "./media";

function Frame({
  color,
  icon: Icon,
  eyebrow,
  title,
  children,
  aside,
}: {
  color: Parameters<typeof colorClasses>[0];
  icon: typeof HelpCircle;
  eyebrow: string;
  title: string;
  children?: React.ReactNode;
  aside?: React.ReactNode;
}) {
  const c = colorClasses(color);
  return (
    <section className={cn("relative overflow-hidden rounded-3xl border bg-gradient-to-br p-5 sm:p-7", c.border, c.tint)}>
      <div className={cn("pointer-events-none absolute -right-12 -top-12 size-44 rounded-full bg-gradient-to-br opacity-20 blur-2xl", c.gradient)} aria-hidden />
      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-start">
        <span className={cn("grid size-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br text-white shadow-lift", c.gradient)}>
          <Icon className="size-7" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className={cn("text-xs font-semibold uppercase tracking-wider", c.text)}>{eyebrow}</p>
          <h2 className="mt-1 font-display text-xl font-bold text-slate-900">{title}</h2>
          <div className="mt-3">{children}</div>
        </div>
        {aside && <div className="shrink-0 self-center">{aside}</div>}
      </div>
    </section>
  );
}

function Stat({ icon: Icon, label }: { icon: typeof Clock; label: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-2.5 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-200">
      <Icon className="size-3.5 text-slate-500" aria-hidden />
      {label}
    </span>
  );
}

export function QuizLessonCard({ lesson }: { lesson: LessonPayload }) {
  const id = lesson.assessment_id ?? lesson.linked?.id;
  const q = useQuery({
    queryKey: lk.quiz.overview(id ?? ""),
    queryFn: ({ signal }) => api.get<QuizOverview>(`/assessments/${id}/overview`, { signal }),
    enabled: !!id,
    retry: false,
  });
  const ov = q.data;
  const a = ov?.assessment;
  const missing = !id || (q.error instanceof ApiError && q.error.status === 404);
  return (
    <Frame
      color="emerald"
      icon={HelpCircle}
      eyebrow={a?.kind === "practice" ? "Practice quiz" : a?.kind === "final" ? "Final assessment" : a?.kind === "survey" ? "Survey" : "Graded quiz"}
      title={a?.title ?? lesson.linked?.title ?? lesson.title}
      aside={
        ov && ov.best_percentage !== null ? (
          <ProgressRing value={ov.best_percentage} size={84} stroke={8} color={ov.passed ? "emerald" : "amber"} sublabel="best" aria-label="Best score" />
        ) : undefined
      }
    >
      {missing ? (
        <p className="text-sm text-slate-600">This quiz isn&apos;t available right now. Your instructor has been notified of missing content.</p>
      ) : q.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-9 w-40" />
        </div>
      ) : ov && a ? (
        <>
          {a.description && <p className="text-sm text-slate-600">{a.description}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Stat icon={HelpCircle} label={`${a.question_count} questions`} />
            <Stat icon={Target} label={`Pass mark ${Math.round(a.pass_percentage)}%`} />
            {a.time_limit_minutes ? <Stat icon={Clock} label={`${a.time_limit_minutes} min`} /> : null}
            <Stat icon={Repeat} label={ov.attempts_remaining === null ? `${ov.attempts_used} attempt${ov.attempts_used === 1 ? "" : "s"} used` : `${ov.attempts_remaining} attempt${ov.attempts_remaining === 1 ? "" : "s"} left`} />
            {ov.passed && (
              <Badge tone="success">
                <Trophy aria-hidden /> Passed
              </Badge>
            )}
          </div>
          <Button asChild variant={ov.passed ? "secondary" : "gradient"} className="mt-5" rightIcon={<ArrowRight />}>
            <Link href={`/app/quiz/${id}`}>{ov.in_progress_attempt_id ? "Resume quiz" : ov.passed ? "Review quiz" : ov.attempts_used ? "Try again" : "Start quiz"}</Link>
          </Button>
        </>
      ) : (
        <Button asChild variant="gradient" rightIcon={<ArrowRight />}>
          <Link href={`/app/quiz/${id}`}>Open quiz</Link>
        </Button>
      )}
    </Frame>
  );
}

export function AssignmentLessonCard({ lesson }: { lesson: LessonPayload }) {
  const id = lesson.assignment_id ?? lesson.linked?.id;
  const sub = useQuery({
    queryKey: lk.assignments.submission(id ?? ""),
    queryFn: ({ signal }) => api.get<Submission | null>(`/assignments/${id}/submission`, { signal }),
    enabled: !!id,
    retry: false,
  });
  const s = sub.data;
  return (
    <Frame
      color="amber"
      icon={ClipboardCheck}
      eyebrow="Practical assignment"
      title={lesson.linked?.title ?? lesson.title}
      aside={s?.final_score !== null && s?.final_score !== undefined ? <ProgressRing value={s.final_score} size={84} stroke={8} color={s.passed ? "emerald" : "amber"} sublabel="score" aria-label="Assignment score" /> : undefined}
    >
      <div className="flex flex-wrap gap-2">
        {lesson.linked?.time_limit_minutes ? <Stat icon={Clock} label={`${lesson.linked.time_limit_minutes} min`} /> : null}
        {typeof lesson.linked?.passing_score === "number" ? <Stat icon={Target} label={`Pass mark ${Math.round(lesson.linked.passing_score)}%`} /> : null}
        {s ? <StatusPill status={s.status} label={s.status === "ai_graded" ? "Awaiting assessor" : undefined} /> : sub.isSuccess ? <StatusPill status="not_started" /> : null}
      </div>
      <p className="mt-3 text-sm text-slate-600">Apply what you&apos;ve learned to a realistic task. Draft, attach evidence and submit for feedback.</p>
      {id ? (
        <Button asChild variant={s?.status === "graded" ? "secondary" : "gradient"} className="mt-5" rightIcon={<ArrowRight />}>
          <Link href={`/app/assignments/${id}`}>{!s ? "Start assignment" : s.status === "draft" || s.status === "returned" ? "Continue working" : "View submission"}</Link>
        </Button>
      ) : (
        <p className="mt-3 text-sm text-slate-600">This assignment isn&apos;t available right now.</p>
      )}
    </Frame>
  );
}

interface SimSession {
  id: string;
  attempt_number: number;
  status: string;
  total_score: number | null;
  band: string | null;
  passed: boolean | null;
  completed_at: string | null;
}

export function SimulationLessonCard({ lesson, progress }: { lesson: LessonPayload; progress: LessonState }) {
  const id = lesson.simulation_id ?? lesson.linked?.id;
  const done = progress.status === "completed";
  const sessions = useQuery({
    queryKey: ["simulation-sessions", "mine", id],
    queryFn: ({ signal }) => api.get<Page<SimSession>>("/simulation-sessions", { signal, query: { simulation_id: id, page_size: 50 } }),
    enabled: !!id,
    retry: false,
  });
  const completed = (sessions.data?.items ?? []).filter((x) => x.status === "completed" && x.total_score !== null);
  const best = completed.reduce<SimSession | null>((a, x) => (!a || (x.total_score ?? 0) > (a.total_score ?? 0) ? x : a), null);
  const inProgress = (sessions.data?.items ?? []).find((x) => x.status === "in_progress" || x.status === "active");
  return (
    <Frame
      color="violet"
      icon={MonitorPlay}
      eyebrow="Simulation"
      title={lesson.linked?.title ?? lesson.title}
      aside={
        best && best.total_score !== null ? (
          <div className="flex flex-col items-center gap-1.5">
            <ProgressRing value={best.total_score} size={84} stroke={8} color={best.passed ? "emerald" : "amber"} sublabel="best" aria-label={`Best simulation score ${Math.round(best.total_score)}`} />
            {best.band && <BandChip band={best.band} size="sm" />}
          </div>
        ) : undefined
      }
    >
      <p className="text-sm text-slate-600">
        Step into a realistic work environment — handle the situation, make decisions under pressure and get scored feedback on each skill.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {done ? (
          <Badge tone="success">
            <Trophy aria-hidden /> Completed
          </Badge>
        ) : progress.status === "in_progress" ? (
          <StatusPill status="in_progress" />
        ) : null}
        {completed.length > 0 && <Stat icon={Repeat} label={`${completed.length} run${completed.length === 1 ? "" : "s"} completed`} />}
        {best?.completed_at && <Stat icon={Clock} label={`Best on ${formatDate(best.completed_at)}`} />}
      </div>
      {id ? (
        <Button asChild variant={done ? "secondary" : "gradient"} className="mt-5" rightIcon={<ArrowRight />}>
          <Link href={`/app/simulations/${id}`}>{inProgress ? "Resume simulation" : done || completed.length ? "Practise again" : "Launch simulation"}</Link>
        </Button>
      ) : (
        <p className="mt-3 text-sm text-slate-600">This simulation isn&apos;t available right now.</p>
      )}
    </Frame>
  );
}

export function TutorLessonCard({ content, onOpen, enabled }: { content: Record<string, unknown>; onOpen: () => void; enabled: boolean }) {
  const prompts = Array.isArray(content.prompts) ? (content.prompts as unknown[]).filter((p): p is string => typeof p === "string") : [];
  return (
    <div className="space-y-5">
      {(str(content.body_markdown) || str(content.instructions)) && <Markdown>{(str(content.body_markdown) ?? str(content.instructions))!}</Markdown>}
      <Frame color="fuchsia" icon={Bot} eyebrow="AI tutor session" title="Talk it through with your AI tutor">
        <p className="text-sm text-slate-600">
          Ask questions, request examples or have it quiz you. Answers are grounded in this course&apos;s material and cite their sources.
        </p>
        {prompts.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2">
            {prompts.slice(0, 4).map((p) => (
              <li key={p} className="rounded-full bg-white px-3 py-1 text-xs font-medium text-fuchsia-800 ring-1 ring-fuchsia-200">
                “{p}”
              </li>
            ))}
          </ul>
        )}
        {enabled ? (
          <Button variant="gradient" className="mt-5" leftIcon={<Sparkles />} onClick={onOpen}>
            Open AI tutor
          </Button>
        ) : (
          <p className="mt-3 text-sm font-medium text-slate-600">The AI tutor is turned off for this course.</p>
        )}
      </Frame>
    </div>
  );
}
