"use client";

import {
  Badge,
  BandChip,
  Breadcrumbs,
  Button,
  CATEGORY_COLORS,
  Card,
  cn,
  colorClasses,
  EmptyState,
  Skeleton,
  bandMeta,
  toast,
} from "@praxis/ui";
import { SkillRadarChart } from "@praxis/ui/charts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertOctagon,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  CircleDashed,
  Clock,
  Flag,
  Lightbulb,
  ListRestart,
  MessageSquare,
  MousePointerClick,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  SquareTerminal,
  ThumbsUp,
  TrendingUp,
  Trophy,
  XCircle,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { ErrorState } from "@/components/common/error-state";
import { TutorPanel } from "@/components/tutor/tutor-panel";
import { Markdown } from "@/components/common/markdown";
import { ApiError, errorMessage } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { EnteringEnvironment } from "./entering";
import { aggregateAttempts, fetchMySessions, fetchReplay, fetchResult, fetchSimulation, simKeys, startSession } from "./queries";
import { industryMeta } from "./theme";
import type { ReplayAction, SimResult, SimSession, TimelineItem } from "./types";
import { simClock } from "./workspace/model";

const END_REASON: Record<string, string> = {
  success: "Scenario resolved",
  failure: "Scenario failed",
  escalated: "Escalated to another team",
  timeout: "Ran out of time",
  action_limit: "Action limit reached",
  incomplete: "Finished early",
  abandoned: "Attempt abandoned",
  expired: "Session expired",
};

/* ------------------------------------------------------------------ score ring */

function useCountUp(target: number, ms = 1200) {
  const [v, setV] = React.useState(0);
  React.useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return setV(target);
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      setV(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

function ScoreRing({ score, band }: { score: number; band: string | null }) {
  const meta = bandMeta(band);
  const c = colorClasses(meta.color);
  const v = useCountUp(score);
  const size = 196;
  const stroke = 16;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const id = React.useId().replace(/:/g, "");
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }} role="img" aria-label={`Score ${Math.round(score)} out of 100, ${meta.label}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <defs>
          <linearGradient id={`sr${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={c.hex} />
            <stop offset="100%" stopColor="#8b5cf6" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#eef2f7" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={`url(#sr${id})`} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ - (v / 100) * circ} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-5xl font-extrabold tabular-nums tracking-tight text-slate-900">{Math.round(v)}</span>
        <span className="text-xs font-medium text-slate-500">out of 100</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ confetti (Advanced / Expert) */

function Confetti() {
  // Two staggered waves of ribbons and dots drifting down across the hero (decorative; hidden for reduced motion).
  const [pieces] = React.useState(() =>
    Array.from({ length: 72 }, (_, i) => ({
      left: Math.random() * 100,
      delay: (i % 2 ? 1.6 : 0) + Math.random() * 1.2,
      dur: 2.8 + Math.random() * 1.8,
      dx: (Math.random() - 0.5) * 140,
      spin: 360 + Math.random() * 540,
      color: colorClasses(CATEGORY_COLORS[i % CATEGORY_COLORS.length]!).hex,
      w: 7 + Math.random() * 6,
      round: Math.random() > 0.65,
    })),
  );
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden motion-reduce:hidden" aria-hidden>
      <style>{`@keyframes praxis-confetti{0%{transform:translate3d(0,-24px,0) rotate(0deg);opacity:0}8%{opacity:1}80%{opacity:1}100%{transform:translate3d(var(--dx),var(--fall),0) rotate(var(--spin));opacity:0}}`}</style>
      {pieces.map((p, i) => (
        <span
          key={i}
          className={p.round ? "absolute -top-3 rounded-full" : "absolute -top-3 rounded-[2px]"}
          style={
            {
              left: `${p.left}%`,
              width: p.w,
              height: p.round ? p.w : p.w * 0.42,
              background: p.color,
              opacity: 0,
              "--dx": `${p.dx}px`,
              "--fall": "380px",
              "--spin": `${p.spin}deg`,
              animation: `praxis-confetti ${p.dur}s cubic-bezier(.33,.2,.55,1) ${p.delay}s 1 both`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ page */

export function SessionResults({ session }: { session: SimSession }) {
  const router = useRouter();
  const qc = useQueryClient();
  const result = useQuery({ queryKey: simKeys.result(session.id), queryFn: ({ signal }) => fetchResult(session.id, signal) });
  const replay = useQuery({ queryKey: simKeys.replay(session.id), queryFn: ({ signal }) => fetchReplay(session.id, signal), retry: false });
  const sim = useQuery({ queryKey: simKeys.detail(session.simulation_id), queryFn: ({ signal }) => fetchSimulation(session.simulation_id, signal), retry: false });
  const mine = useQuery({
    queryKey: simKeys.mySessions({ simulation_id: session.simulation_id }),
    queryFn: ({ signal }) => fetchMySessions({ simulation_id: session.simulation_id, page_size: 200 }, signal),
  });
  const [entering, setEntering] = React.useState(false);
  const [tutor, setTutor] = React.useState(false);

  if (result.isError) return <ErrorState error={result.error} onRetry={() => result.refetch()} size="lg" />;
  if (result.isLoading || !result.data) return <ResultsSkeleton />;
  const r = result.data;
  const meta = bandMeta(r.band);
  const c = colorClasses(meta.color);
  const celebrate = ["advanced", "expert"].includes((r.band ?? "").toLowerCase());
  const s = sim.data;
  const ind = industryMeta(session.view.meta.industry);
  const used = aggregateAttempts(mine.data?.items ?? []).get(session.simulation_id)?.attempts ?? session.attempt_number;
  const maxed = !!s?.max_attempts && used >= s.max_attempts;
  const overTarget = r.target_minutes ? r.sim_minutes > r.target_minutes : false;

  const tryAgain = async () => {
    setEntering(true);
    try {
      const ns = await startSession(session.simulation_id);
      qc.setQueryData(simKeys.session(ns.id), ns);
      qc.invalidateQueries({ queryKey: ["simulation-sessions"] });
      setTimeout(() => router.push(`/app/simulations/session/${ns.id}?fresh=1`), 1100);
    } catch (err) {
      setEntering(false);
      toast.error(err instanceof ApiError && err.code === "attempt_limit" ? err.message : errorMessage(err));
    }
  };

  return (
    <div className="pb-8">
      <Breadcrumbs
        linkComponent={Link}
        className="mb-4"
        items={[{ label: "Simulations", href: "/app/simulations" }, { label: session.view.meta.title, href: `/app/simulations/${session.simulation_id}` }, { label: `Attempt ${r.attempt_number} debrief` }]}
      />

      {/* ------------------------------------------------ hero */}
      <section className={cn("relative overflow-hidden rounded-3xl border bg-white shadow-soft", celebrate ? "border-transparent ring-2 ring-offset-2 " + c.ring : "border-slate-200/80")}>
        <div className={cn("absolute inset-0 bg-gradient-to-br opacity-90", c.tint)} aria-hidden />
        {celebrate && <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_10%,rgba(139,92,246,0.18),transparent_45%),radial-gradient(circle_at_10%_90%,rgba(16,185,129,0.16),transparent_40%)]" aria-hidden />}
        {celebrate && <Confetti />}
        <div className="relative z-10 grid items-center gap-8 p-6 sm:p-8 lg:grid-cols-[auto_1fr_auto]">
          <div className="mx-auto">
            <ScoreRing score={r.total_score ?? 0} band={r.band} />
          </div>
          <div className="min-w-0 text-center lg:text-left">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Debrief · Attempt {r.attempt_number}</p>
            <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              {celebrate ? (r.band?.toLowerCase() === "expert" ? "Outstanding work." : "Excellent work.") : r.passed ? "Nicely done — you passed." : "Good effort — let's level up."}
            </h1>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2 lg:justify-start">
              {r.band && <BandChip band={r.band} size="lg" />}
              {r.passed ? (
                <Badge tone="success" size="lg">
                  <CheckCircle2 aria-hidden /> Passed
                </Badge>
              ) : (
                <Badge tone="danger" size="lg">
                  <XCircle aria-hidden /> Not passed
                </Badge>
              )}
              <Badge tone="neutral" size="lg">
                <Flag aria-hidden /> {END_REASON[r.end_reason ?? ""] ?? r.end_reason ?? "Finished"}
              </Badge>
            </div>
            <dl className="mt-5 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm lg:justify-start">
              <div className="flex items-center gap-1.5">
                <Clock className="size-4 text-slate-400" aria-hidden />
                <dt className="text-slate-500">Sim time</dt>
                <dd className={cn("font-semibold tabular-nums", overTarget ? "text-amber-700" : "text-slate-900")}>
                  {simClock(r.sim_minutes)}
                  {r.target_minutes ? <span className="font-normal text-slate-500"> / {r.target_minutes}:00 target</span> : null}
                </dd>
              </div>
              <div className="flex items-center gap-1.5">
                <MousePointerClick className="size-4 text-slate-400" aria-hidden />
                <dt className="text-slate-500">Actions</dt>
                <dd className="font-semibold tabular-nums text-slate-900">{session.view.action_count}</dd>
              </div>
              {r.completed_at && (
                <div className="flex items-center gap-1.5">
                  <dt className="sr-only">Completed</dt>
                  <dd className="text-slate-500">{formatDateTime(r.completed_at)}</dd>
                </div>
              )}
            </dl>
          </div>
          <div className="flex flex-col items-stretch gap-2 sm:flex-row lg:flex-col">
            {celebrate && (
              <div className="mb-2 hidden items-center justify-center lg:flex">
                <span className="grid size-16 place-items-center rounded-3xl bg-gradient-to-br from-amber-300 to-orange-500 text-white shadow-lift motion-safe:animate-float">
                  <Trophy className="size-8" aria-hidden />
                </span>
              </div>
            )}
            <Button variant="gradient" leftIcon={<RotateCcw />} onClick={tryAgain} disabled={maxed} loading={entering}>
              Try again
            </Button>
            {s?.course_id ? (
              <Button variant="secondary" asChild leftIcon={<BookOpen />}>
                <Link href={`/app/learn/${s.course_id}`}>Back to course</Link>
              </Button>
            ) : (
              <Button variant="secondary" asChild leftIcon={<ArrowLeft />}>
                <Link href="/app/simulations">All simulations</Link>
              </Button>
            )}
            <Button variant="soft" leftIcon={<Sparkles />} onClick={() => setTutor(true)}>
              Ask the AI tutor
            </Button>
            {maxed ? (
              <p className="text-center text-xs text-rose-700">All {s?.max_attempts} attempts used</p>
            ) : s?.max_attempts ? (
              <p className="text-center text-xs text-slate-500">
                {s.max_attempts - used} {s.max_attempts - used === 1 ? "attempt" : "attempts"} left
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_1fr]">
        <Dimensions r={r} />
        <div className="space-y-6">
          <Card className="relative overflow-hidden p-5 sm:p-6">
            <div className="pointer-events-none absolute -right-10 -top-10 size-40 rounded-full bg-fuchsia-200/40 blur-2xl" aria-hidden />
            <h2 className="relative flex items-center gap-3 font-display text-base font-semibold text-slate-900">
              <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-sm">
                <Sparkles className="size-[18px]" aria-hidden />
              </span>
              Coach’s debrief
            </h2>
            <div className="relative mt-4">
              {r.narrative ? <Markdown className="text-[15px]">{r.narrative}</Markdown> : <p className="text-sm text-muted-foreground">{r.feedback.summary}</p>}
            </div>
          </Card>
          <FeedbackGrid r={r} />
        </div>
      </div>

      <Mistakes r={r} />

      <Timeline items={r.feedback.timeline ?? []} actions={replay.data?.actions ?? []} loading={replay.isLoading} phases={session.view.phases} />

      <TutorPanel open={tutor} onOpenChange={setTutor} courseId={s?.course_id ?? undefined} />
      <EnteringEnvironment open={entering} title={session.view.meta.title} environment={session.view.meta.environment_type} industry={session.view.meta.industry} />
      <span className="sr-only">{ind.label}</span>
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <div className="space-y-6" aria-busy aria-label="Loading your debrief">
      <Skeleton className="h-5 w-64" />
      <Skeleton className="h-64 rounded-3xl" />
      <div className="grid gap-6 xl:grid-cols-2">
        <Skeleton className="h-96 rounded-2xl" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ dimensions */

function Dimensions({ r }: { r: SimResult }) {
  const data = r.dimensions.map((d) => ({ subject: d.name, value: Math.round(d.percent) }));
  return (
    <Card className="p-5 sm:p-6">
      <h2 className="flex items-center gap-3 font-display text-base font-semibold text-slate-900">
        <span className="grid size-9 place-items-center rounded-xl bg-sky-50 text-sky-600">
          <TrendingUp className="size-[18px]" aria-hidden />
        </span>
        Performance by dimension
      </h2>
      {data.length >= 3 && <SkillRadarChart data={data} height={280} className="mt-2" aria-label={`Dimension scores: ${data.map((d) => `${d.subject} ${d.value}%`).join(", ")}`} />}
      <ul className="mt-2 space-y-3.5">
        {r.dimensions.map((d, i) => {
          const c = colorClasses(CATEGORY_COLORS[i % CATEGORY_COLORS.length]!);
          const pct = Math.round(d.percent);
          return (
            <li key={d.id}>
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-sm">
                <span className="flex items-center gap-2 font-medium text-slate-800">
                  <span className={cn("size-2.5 shrink-0 rounded-full", c.solid)} aria-hidden />
                  {d.name}
                  <span className={cn("whitespace-nowrap rounded-full px-1.5 py-0.5 text-2xs font-bold", c.soft, c.text)}>{d.weight}%</span>
                </span>
                <span className="whitespace-nowrap text-xs tabular-nums text-slate-600 sm:text-sm">
                  <span className="font-semibold text-slate-900">{d.score.toFixed(1)}</span>/{d.weight} pts · {pct}%
                </span>
              </div>
              <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${d.name} ${pct}%`}>
                <div className={cn("h-full rounded-full bg-gradient-to-r transition-all duration-1000", c.gradient)} style={{ width: `${pct}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/* ------------------------------------------------------------------ feedback */

function FeedbackGrid({ r }: { r: SimResult }) {
  const f = r.feedback;
  const groups = [
    { key: "strengths", title: "Strengths", icon: ThumbsUp, color: "emerald" as const, items: f.strengths ?? [] },
    { key: "improvements", title: "To improve", icon: TrendingUp, color: "amber" as const, items: f.improvements ?? [] },
    { key: "missed", title: "Missed critical steps", icon: CircleDashed, color: "rose" as const, items: f.missed_steps ?? [] },
    { key: "tips", title: "Tips", icon: Lightbulb, color: "sky" as const, items: f.tips ?? [] },
  ].filter((g) => g.items.length);
  if (!groups.length) return null;
  return (
    <div className={cn("grid gap-4", groups.length > 1 && "sm:grid-cols-2")}>
      {groups.map((g) => {
        const c = colorClasses(g.color);
        const Icon = g.icon;
        return (
          <Card key={g.key} className={cn("bg-gradient-to-br p-4", c.tint)}>
            <h3 className={cn("flex items-center gap-2 text-sm font-semibold", c.text)}>
              <Icon className="size-4" aria-hidden />
              {g.title}
              <span className={cn("ml-auto rounded-full px-1.5 text-2xs", c.soft)}>{g.items.length}</span>
            </h3>
            <ul className="mt-2.5 space-y-2">
              {g.items.map((it, i) => (
                <li key={it.id ?? i} className="flex gap-2 text-sm text-slate-700">
                  <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", c.solid)} aria-hidden />
                  {it.text}
                </li>
              ))}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}

function Mistakes({ r }: { r: SimResult }) {
  const crit = r.feedback.critical_actions ?? [];
  const inc = r.feedback.incorrect_actions ?? [];
  if (!crit.length && !inc.length) return null;
  return (
    <Card className="mt-6 p-5 sm:p-6">
      <h2 className="flex items-center gap-3 font-display text-base font-semibold text-slate-900">
        <span className="grid size-9 place-items-center rounded-xl bg-rose-50 text-rose-600">
          <AlertOctagon className="size-[18px]" aria-hidden />
        </span>
        Decisions to revisit
      </h2>
      <ul className="mt-4 grid gap-3 md:grid-cols-2">
        {[...crit.map((x) => ({ ...x, critical: true })), ...inc.map((x) => ({ ...x, critical: false }))].map((x, i) => (
          <li key={i} className={cn("rounded-2xl border p-4", x.critical ? "border-rose-200 bg-rose-50/70" : "border-amber-200 bg-amber-50/60")}>
            <div className="flex items-center justify-between gap-2">
              <span className={cn("rounded-full px-2 py-0.5 text-2xs font-bold uppercase tracking-wider", x.critical ? "bg-rose-600 text-white" : "bg-amber-500 text-white")}>
                {x.critical ? "Critical" : "Incorrect"}
              </span>
              {typeof x.minutes === "number" && <span className="font-mono text-2xs text-slate-500">T+{simClock(x.minutes)}</span>}
            </div>
            <p className="mt-2 text-sm font-semibold text-slate-900">{x.label}</p>
            {x.feedback && <p className="mt-1 text-sm text-slate-700">{x.feedback}</p>}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ------------------------------------------------------------------ timeline replay */

const CLASS_DOT: Record<string, string> = {
  correct: "bg-emerald-500",
  neutral: "bg-slate-300",
  incorrect: "bg-amber-500",
  critical: "bg-rose-600",
};

function inputText(a?: ReplayAction): string | null {
  const inp = a?.input?.input;
  if (!inp) return null;
  if (typeof inp === "string") return inp;
  if (typeof inp === "object") {
    const o = inp as Record<string, unknown>;
    if (typeof o.text === "string") return o.text;
    if (typeof o.choice === "string") return null;
  }
  return null;
}

function PhaseMarker({ label, start }: { label: string; start?: boolean }) {
  return (
    <li className="flex items-center gap-3 py-2">
      <span className="h-px flex-1 bg-gradient-to-r from-transparent via-brand-200 to-brand-300" aria-hidden />
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold shadow-sm",
          start ? "bg-white text-brand-800 ring-1 ring-inset ring-brand-200" : "bg-brand-gradient text-white",
        )}
      >
        {start ? <Flag className="size-3" aria-hidden /> : <ArrowRight className="size-3" aria-hidden />}
        <span className="sr-only">Phase: </span>
        {label}
      </span>
      <span className="h-px flex-1 bg-gradient-to-l from-transparent via-brand-200 to-brand-300" aria-hidden />
    </li>
  );
}

function Timeline({ items, actions, loading, phases }: { items: TimelineItem[]; actions: ReplayAction[]; loading: boolean; phases: { id: string; name: string }[] }) {
  const [filter, setFilter] = React.useState<"all" | "mistakes">("all");
  const [cursor, setCursor] = React.useState<number>(items.length);
  const [playing, setPlaying] = React.useState(false);
  const bySeq = React.useMemo(() => new Map(actions.map((a) => [a.seq, a])), [actions]);
  const phaseName = (id?: string | null) => phases.find((p) => p.id === id)?.name ?? id ?? "";

  React.useEffect(() => {
    if (!playing) return;
    if (cursor >= items.length) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setCursor((c) => c + 1), 650);
    return () => clearTimeout(t);
  }, [playing, cursor, items.length]);

  const visible = items.slice(0, cursor).filter((i) => filter === "all" || i.classification === "incorrect" || i.classification === "critical");
  // Timeline items carry the phase *after* each step: mark a transition right after the step that caused it.
  let prevPhase: string | null | undefined = phases[0]?.id;

  return (
    <Card className="mt-6 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-3 font-display text-base font-semibold text-slate-900">
          <span className="grid size-9 place-items-center rounded-xl bg-indigo-50 text-indigo-600">
            <ListRestart className="size-[18px]" aria-hidden />
          </span>
          Action replay
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl bg-slate-100 p-1 text-sm" role="group" aria-label="Filter steps">
            {(["all", "mistakes"] as const).map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
                className={cn("rounded-lg px-3 py-1 font-medium transition-colors focus-visible:focus-ring", filter === f ? "bg-white text-slate-900 shadow-sm" : "text-slate-600")}
              >
                {f === "all" ? "All steps" : "Mistakes only"}
              </button>
            ))}
          </div>
          <Button
            size="sm"
            variant="soft"
            leftIcon={playing ? <Pause /> : <Play />}
            onClick={() => {
              if (playing) return setPlaying(false);
              if (cursor >= items.length) setCursor(0);
              setPlaying(true);
            }}
            disabled={!items.length}
          >
            {playing ? "Pause" : "Play replay"}
          </Button>
        </div>
      </div>
      {items.length > 0 && (
        <div className="mt-4 flex items-center gap-3">
          <label htmlFor="replay-scrub" className="sr-only">
            Replay position
          </label>
          <input
            id="replay-scrub"
            type="range"
            min={0}
            max={items.length}
            value={cursor}
            onChange={(e) => {
              setPlaying(false);
              setCursor(Number(e.target.value));
            }}
            className="h-2 flex-1 cursor-pointer accent-brand-600"
          />
          <span className="w-20 text-right font-mono text-xs tabular-nums text-slate-500">
            {cursor}/{items.length}
          </span>
        </div>
      )}
      {loading ? (
        <div className="mt-4 space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-xl" />
          ))}
        </div>
      ) : !items.length ? (
        <EmptyState size="sm" illustration="chart" title="No steps recorded" description="This attempt ended before any actions were taken." />
      ) : (
        <ol className="relative mt-5 max-h-[44rem] space-y-0 overflow-y-auto pr-1 scrollbar-thin" aria-live="polite">
          {phases[0] && <PhaseMarker label={`Start · ${phases[0].name}`} start />}
          {visible.map((it, idx) => {
            const a = bySeq.get(it.seq);
            const text = it.type === "event" ? null : inputText(a);
            const marker = it.phase && it.phase !== prevPhase ? it.phase : null;
            prevPhase = it.phase ?? prevPhase;
            const term = !!a?.outcome?.outputs?.some((o) => o.format === "terminal");
            const Icon = it.type === "event" ? Zap : term ? SquareTerminal : a?.input?.character ? MessageSquare : MousePointerClick;
            const last = idx === visible.length - 1;
            return (
              <React.Fragment key={`${it.seq}-${idx}`}>
                <li className={cn("relative flex gap-3 pb-3", playing && last && "motion-safe:animate-fade-up")}>
                  <div className="flex flex-col items-center">
                    <span className={cn("grid size-8 shrink-0 place-items-center rounded-xl ring-4 ring-white", it.type === "event" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600")}>
                      <Icon className="size-4" aria-hidden />
                    </span>
                    {!last && <span className="mt-1 w-px flex-1 bg-slate-200" aria-hidden />}
                  </div>
                  <div className={cn("min-w-0 flex-1 rounded-xl border px-3.5 py-2.5", it.classification === "critical" ? "border-rose-200 bg-rose-50/50" : it.classification === "incorrect" ? "border-amber-200 bg-amber-50/40" : "border-slate-100 bg-white")}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-900">{it.type === "event" ? `Event: ${it.label}` : it.label}</p>
                      <span className="flex items-center gap-2 text-2xs text-slate-500">
                        {it.classification && (
                          <span className="inline-flex items-center gap-1 capitalize">
                            <span className={cn("size-2 rounded-full", CLASS_DOT[it.classification] ?? CLASS_DOT.neutral)} aria-hidden />
                            {it.classification}
                          </span>
                        )}
                        <span className="font-mono tabular-nums">T+{simClock(it.minutes)}</span>
                      </span>
                    </div>
                    {text && <p className={cn("mt-1 text-sm", term ? "font-mono text-[12.5px] text-teal-800" : "text-slate-600")}>{term ? `> ${text}` : `“${text}”`}</p>}
                    {a?.reply?.text && (
                      <p className="mt-1.5 rounded-lg bg-violet-50 px-2.5 py-1.5 text-xs text-violet-900">
                        <span className="font-semibold">{a.reply.name ?? "Reply"}:</span> {a.reply.text}
                      </p>
                    )}
                    {a?.outcome?.feedback && <p className="mt-1.5 text-xs text-slate-600">{a.outcome.feedback}</p>}
                  </div>
                </li>
                {marker && <PhaseMarker label={phaseName(marker)} />}
              </React.Fragment>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
