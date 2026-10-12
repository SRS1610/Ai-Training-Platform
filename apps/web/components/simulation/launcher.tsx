"use client";

import { BandChip, Button, cn, EmptyState, Pagination, Skeleton, StatusPill, bandMeta, colorClasses } from "@praxis/ui";
import { ArrowRight, CheckCircle2, Clock, Gauge, History, MonitorPlay, PlayCircle, ScrollText, Sparkles, Trophy, Wrench } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { ErrorState } from "@/components/common/error-state";
import { formatDateTime, formatRelative } from "@/lib/format";
import { industryMeta } from "./theme";
import type { SessionSummary, Simulation } from "./types";

const BAND_ORDER = ["fail", "needs_improvement", "competent", "advanced", "expert"];

function bandKey(b: string | null | undefined) {
  return (b ?? "").toLowerCase().replace(/[\s-]+/g, "_");
}

export function LauncherHero({
  sessions,
  available,
  loading,
  active,
  activeTitle,
}: {
  sessions: SessionSummary[];
  available: number;
  loading: boolean;
  active?: SessionSummary;
  activeTitle?: string;
}) {
  const finished = sessions.filter((s) => s.status !== "active" && s.total_score !== null);
  const passed = finished.filter((s) => s.passed).length;
  const best = finished.reduce<SessionSummary | null>((b, s) => (!b || (s.total_score ?? 0) > (b.total_score ?? 0) ? s : b), null);
  const avg = finished.length ? Math.round(finished.reduce((a, s) => a + (s.total_score ?? 0), 0) / finished.length) : null;
  const bands = BAND_ORDER.map((b) => ({ band: b, count: finished.filter((s) => bandKey(s.band) === b).length }));

  const tiles = [
    { label: "Available", value: available, icon: MonitorPlay, color: "violet" as const, hint: "published scenarios" },
    { label: "Attempts", value: sessions.length, icon: History, color: "sky" as const, hint: `${passed} passed` },
    { label: "Average score", value: avg ?? "—", icon: Gauge, color: "teal" as const, hint: finished.length ? `across ${finished.length} runs` : "no runs yet" },
    {
      label: "Best band",
      value: best?.band ? bandMeta(best.band).label : "—",
      icon: Trophy,
      color: best?.band ? bandMeta(best.band).color : ("amber" as const),
      hint: best ? `${Math.round(best.total_score ?? 0)}/100` : "play to earn one",
    },
  ];

  return (
    <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
      <div className="relative overflow-hidden rounded-3xl bg-brand-gradient p-6 text-white shadow-glow sm:p-7">
        <div className="pointer-events-none absolute -right-16 -top-20 size-72 rounded-full bg-white/10 blur-2xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-24 left-1/3 size-72 rounded-full bg-fuchsia-300/20 blur-3xl" aria-hidden />
        <div className="relative flex h-full flex-col gap-5">
          <div className="flex items-start gap-4">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-white/15 ring-1 ring-white/25 backdrop-blur">
              {active ? <PlayCircle className="size-6" aria-hidden /> : <Sparkles className="size-6" aria-hidden />}
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-white/80">{active ? "Pick up where you left off" : "Learn by doing"}</p>
              <h2 className="mt-1 font-display text-xl font-bold leading-snug tracking-tight sm:text-2xl">
                {active ? activeTitle ?? "Your simulation is still running" : "Real tools. Real people. Real consequences."}
              </h2>
              <p className="mt-1.5 max-w-xl text-sm text-white/85">
                {active
                  ? `Attempt ${active.attempt_number} · ${active.action_count} actions · ${Math.round(active.sim_minutes_elapsed)} simulated minutes so far.`
                  : "Simulated time only moves when you act, so take a breath, read the situation and work it like a pro. You're scored on accuracy, process, communication, decisions and efficiency."}
              </p>
            </div>
          </div>
          {active && (
            <div className="mt-auto">
              <Button variant="white" asChild rightIcon={<ArrowRight />}>
                <Link href={`/app/simulations/session/${active.id}`}>Resume simulation</Link>
              </Button>
            </div>
          )}
          {!active && finished.length === 0 && (
            <ol className="mt-auto grid gap-2 sm:grid-cols-3" aria-label="How simulations work">
              {[
                { icon: ScrollText, title: "Read the brief", text: "Role, goals and scoring" },
                { icon: Wrench, title: "Work the problem", text: "Talk, investigate, decide" },
                { icon: Trophy, title: "Get debriefed", text: "Band, coaching, replay" },
              ].map((s, i) => (
                <li key={s.title} className="flex items-start gap-3 rounded-2xl bg-white/10 p-3 ring-1 ring-inset ring-white/20 backdrop-blur">
                  <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-white text-sm font-bold text-brand-700 shadow-sm">
                    <s.icon className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">
                      <span className="sr-only">Step {i + 1}: </span>
                      {s.title}
                    </span>
                    <span className="block text-xs text-white/85">{s.text}</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
          {!active && finished.length > 0 && (
            <div className="mt-auto">
              <p className="mb-2 text-xs font-medium text-white/80">Your band history</p>
              <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-white/15 ring-1 ring-white/30" role="img" aria-label={bands.map((b) => `${bandMeta(b.band).label}: ${b.count}`).join(", ")}>
                {bands.map((b) =>
                  b.count ? <span key={b.band} className={colorClasses(bandMeta(b.band).color).solid} style={{ width: `${(b.count / finished.length) * 100}%` }} /> : null,
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-2xs text-white/85">
                {bands
                  .filter((b) => b.count)
                  .map((b) => (
                    <span key={b.band} className="inline-flex items-center gap-1">
                      <span className={cn("size-2 rounded-full ring-1 ring-white/70", colorClasses(bandMeta(b.band).color).solid)} aria-hidden />
                      {bandMeta(b.band).label} · {b.count}
                    </span>
                  ))}
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        {tiles.map((t) => {
          const c = colorClasses(t.color);
          const Icon = t.icon;
          return loading ? (
            <Skeleton key={t.label} className="h-[7.5rem] rounded-2xl" />
          ) : (
            <div key={t.label} className={cn("relative overflow-hidden rounded-2xl border border-slate-200/80 bg-gradient-to-br p-4 shadow-soft", c.tint)}>
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium text-slate-600">{t.label}</p>
                <span className={cn("grid size-8 place-items-center rounded-xl bg-gradient-to-br text-white shadow-sm", c.gradient)}>
                  <Icon className="size-4" aria-hidden />
                </span>
              </div>
              <p className="mt-2 truncate font-display text-2xl font-bold tracking-tight text-slate-900 tabular-nums">{t.value}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{t.hint}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const PAST_PAGE = 8;

export function PastSessions({
  sessions,
  loading,
  error,
  onRetry,
  simulations,
}: {
  sessions: SessionSummary[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  simulations: Map<string, Simulation>;
}) {
  const [page, setPage] = React.useState(1);
  const rows = sessions.slice((page - 1) * PAST_PAGE, page * PAST_PAGE);
  return (
    <section aria-labelledby="past-heading" className="mt-10">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h2 id="past-heading" className="font-display text-lg font-semibold tracking-tight text-slate-900">
            My sessions
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">Every attempt, with its score band. Open one to see the debrief and replay.</p>
        </div>
      </div>
      {error ? (
        <ErrorState error={error} onRetry={onRetry} size="sm" />
      ) : loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-2xl" />
          ))}
        </div>
      ) : sessions.length === 0 ? (
        <EmptyState bordered size="sm" illustration="rocket" title="No sessions yet" description="Start a simulation above — your attempts and debriefs will show up here." />
      ) : (
        <>
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-soft">
            {rows.map((s) => {
              const sim = simulations.get(s.simulation_id);
              const ind = industryMeta(sim?.industry);
              const Icon = ind.icon;
              const done = s.status !== "active";
              return (
                <li key={s.id}>
                  <Link
                    href={`/app/simulations/session/${s.id}`}
                    className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 transition-colors hover:bg-slate-50 focus-visible:focus-ring sm:flex-nowrap sm:px-5"
                  >
                    <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-white shadow-sm", ind.classes.gradient)}>
                      <Icon className="size-5" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-slate-900">{sim?.title ?? "Simulation"}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                        <span>Attempt {s.attempt_number}</span>
                        <span className="inline-flex items-center gap-1">
                          <Clock className="size-3" aria-hidden />
                          {Math.round(s.sim_minutes_elapsed)} sim min
                        </span>
                        <span title={formatDateTime(s.started_at)}>{formatRelative(s.completed_at ?? s.started_at)}</span>
                      </span>
                    </span>
                    <span className="flex items-center gap-3">
                      {done && s.total_score !== null ? (
                        <>
                          {s.passed && <CheckCircle2 className="size-4 text-emerald-600" aria-label="Passed" />}
                          <span className="font-display text-lg font-bold tabular-nums text-slate-900">{Math.round(s.total_score)}</span>
                          {s.band && <BandChip band={s.band} size="sm" />}
                        </>
                      ) : null}
                      <StatusPill status={s.status === "active" ? "in_progress" : s.status} label={s.status === "active" ? "In progress" : undefined} size="sm" />
                      <ArrowRight className="size-4 text-slate-400" aria-hidden />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {sessions.length > PAST_PAGE && <Pagination className="mt-4" page={page} pageSize={PAST_PAGE} total={sessions.length} onPageChange={setPage} />}
        </>
      )}
    </section>
  );
}
