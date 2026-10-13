"use client";

import {
  Alert,
  BandChip,
  Breadcrumbs,
  Button,
  CATEGORY_COLORS,
  Card,
  cn,
  colorClasses,
  EmptyState,
  Kbd,
  Skeleton,
  StatusPill,
  bandMeta,
  toast,
} from "@praxis/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  BadgeCheck,
  Clock,
  Crosshair,
  Eye,
  EyeOff,
  Flag,
  Gauge,
  GraduationCap,
  Lightbulb,
  ListChecks,
  PlayCircle,
  RotateCcw,
  ScrollText,
  Target,
  Timer,
  UserRound,
  Users,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { ErrorState } from "@/components/common/error-state";
import { Markdown } from "@/components/common/markdown";
import { ApiError, errorMessage } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import { EnteringEnvironment } from "./entering";
import { aggregateAttempts, fetchBriefing, fetchMySessions, fetchSimulation, simKeys, startSession } from "./queries";
import { DifficultyMeter } from "./sim-card";
import { EnvironmentIllustration, environmentLabel, industryMeta, panelColor, toolIcon } from "./theme";
import type { SimBriefing } from "./types";
import { CharacterAvatar } from "./workspace/chat-panel";

export function SimulationBriefing({ id }: { id: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const sim = useQuery({ queryKey: simKeys.detail(id), queryFn: ({ signal }) => fetchSimulation(id, signal) });
  const brief = useQuery({
    queryKey: simKeys.briefing(id),
    queryFn: ({ signal }) => fetchBriefing(id, signal),
    enabled: sim.data?.status === "published",
    retry: false,
  });
  const mine = useQuery({
    queryKey: simKeys.mySessions({ simulation_id: id }),
    queryFn: ({ signal }) => fetchMySessions({ simulation_id: id, page_size: 200 }, signal),
  });
  const sessions = React.useMemo(() => mine.data?.items ?? [], [mine.data]);
  const stats = aggregateAttempts(sessions).get(id);

  const [entering, setEntering] = React.useState(false);
  const [ready, setReady] = React.useState(false);
  const [blocked, setBlocked] = React.useState<string | null>(null);

  async function start() {
    setEntering(true);
    setReady(false);
    const started = Date.now();
    try {
      const s = await startSession(id);
      setReady(true);
      qc.invalidateQueries({ queryKey: ["simulation-sessions"] });
      qc.setQueryData(simKeys.session(s.id), s);
      const wait = Math.max(0, 1500 - (Date.now() - started));
      setTimeout(() => router.push(`/app/simulations/session/${s.id}${s.resumed ? "" : "?fresh=1"}`), wait);
    } catch (err) {
      setEntering(false);
      if (err instanceof ApiError && err.code === "attempt_limit") setBlocked(err.message);
      else if (err instanceof ApiError && err.status === 402) setBlocked("Your organisation's plan doesn't include simulations. Ask an administrator to upgrade.");
      toast.error(errorMessage(err));
    }
  }

  if (sim.isError) {
    // 404 (unknown/other org) and 422 (malformed id) both mean there's nothing to brief.
    if (sim.error instanceof ApiError && (sim.error.status === 404 || sim.error.status === 422))
      return (
        <EmptyState
          size="lg"
          illustration="search"
          title="Simulation not found"
          description="This simulation doesn't exist, isn't published yet, or isn't available to your organisation."
          action={
            <Button asChild variant="secondary">
              <Link href="/app/simulations">Back to simulations</Link>
            </Button>
          }
        />
      );
    return <ErrorState error={sim.error} onRetry={() => sim.refetch()} size="lg" />;
  }
  if (sim.isLoading || !sim.data)
    return (
      <div className="space-y-6" aria-busy aria-label="Loading simulation">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-72 rounded-3xl" />
        <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
          <Skeleton className="h-96 rounded-2xl" />
          <Skeleton className="h-80 rounded-2xl" />
        </div>
      </div>
    );

  const s = sim.data;
  const b = brief.data;
  const ind = industryMeta(s.industry);
  const IndIcon = ind.icon;
  const used = stats?.attempts ?? 0;
  const remaining = s.max_attempts ? Math.max(0, s.max_attempts - used) : null;
  const outOfAttempts = remaining === 0 && !stats?.active;
  const reviewSession = stats?.best ?? stats?.latest ?? null;
  const briefLoading = brief.isLoading && s.status === "published";

  const startCard = (
          <Card className="overflow-hidden">
            <div className={cn("bg-gradient-to-br p-5", ind.classes.tint)}>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                {stats?.active ? "Attempt in progress" : outOfAttempts ? "All attempts used" : `Attempt ${used + 1}${s.max_attempts ? ` of ${s.max_attempts}` : ""}`}
              </p>
              <p className="mt-1 font-display text-lg font-semibold text-slate-900">
                {stats?.active ? "Resume where you left off" : outOfAttempts ? "Review your debrief" : "Ready when you are"}
              </p>
              {stats?.best?.band && (
                <p className="mt-2 flex items-center gap-2 text-sm text-slate-600">
                  Best so far <BandChip band={stats.best.band} size="sm" />
                  <span className="font-semibold tabular-nums text-slate-900">{Math.round(stats.best.total_score ?? 0)}</span>
                </p>
              )}
            </div>
            <div className="space-y-3 p-5">
              {blocked || outOfAttempts ? (
                <Alert tone="warning" title="You can't start a new attempt">
                  {blocked ?? `You've used all ${s.max_attempts} attempts for this simulation.`}
                </Alert>
              ) : null}
              {s.status !== "published" && (
                <Alert tone="info" title="Not published">
                  Publish this simulation in the builder before starting a session.
                </Alert>
              )}
              {outOfAttempts && reviewSession ? (
                <Button variant="gradient" size="lg" block asChild rightIcon={<ArrowRight />}>
                  <Link href={`/app/simulations/session/${reviewSession.id}`}>{stats?.best ? "View best result" : "View results"}</Link>
                </Button>
              ) : (
                <Button
                  variant="gradient"
                  size="lg"
                  block
                  onClick={start}
                  loading={entering}
                  disabled={outOfAttempts || !!blocked || s.status !== "published"}
                  leftIcon={stats?.active ? <PlayCircle /> : undefined}
                  rightIcon={stats?.active ? undefined : <ArrowRight />}
                >
                  {stats?.active ? "Resume simulation" : used > 0 ? "Start new attempt" : "Start simulation"}
                </Button>
              )}
              {!outOfAttempts && (
                <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                  <Lightbulb className="size-3.5 text-amber-500" aria-hidden />
                  Tip: press <Kbd>?</Kbd> in the workspace for shortcuts
                </p>
              )}
            </div>
          </Card>
  );

  return (
    <div className="pb-6">
      <Breadcrumbs linkComponent={Link} className="mb-4" items={[{ label: "Simulations", href: "/app/simulations" }, { label: s.title }]} />

      {/* Hero */}
      <section className="relative overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-soft">
        <div className={cn("absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r", ind.classes.gradient)} aria-hidden />
        <div className="grid items-stretch lg:grid-cols-[1.25fr_1fr]">
          <div className="flex flex-col gap-5 p-6 sm:p-8">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset", ind.classes.soft, ind.classes.text, ind.classes.ring)}>
                <IndIcon className="size-3.5" aria-hidden />
                {ind.label}
              </span>
              <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{environmentLabel(s.environment_type)}</span>
              {s.status !== "published" && <StatusPill status={s.status} size="sm" />}
              {b?.tags
                .filter((t) => t !== "flagship")
                .slice(0, 4)
                .map((t) => (
                  <span key={t} className="hidden rounded-full bg-white px-2 py-0.5 text-2xs font-medium text-slate-600 ring-1 ring-inset ring-slate-200 sm:inline">
                    #{t}
                  </span>
                ))}
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-brand-700">Simulation briefing</p>
              <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{s.title}</h1>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">{s.description}</p>
            </div>
            <dl className="mt-auto grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Fact icon={Gauge} color="sky" label="Difficulty" value={<DifficultyMeter difficulty={s.difficulty} className="text-sm text-slate-900" />} />
              <Fact icon={Clock} color="teal" label="Estimated" value={`~${s.estimated_minutes} min`} />
              <Fact icon={GraduationCap} color="violet" label="Mode" value={s.is_graded ? "Graded" : "Practice"} />
              <Fact icon={RotateCcw} color="amber" label="Attempts" value={s.max_attempts ? `${used} of ${s.max_attempts}` : `${used} · unlimited`} />
            </dl>
          </div>
          <div className="relative hidden min-h-[16rem] lg:block">
            <EnvironmentIllustration environment={s.environment_type} industry={s.industry} className="absolute inset-0 size-full" />
          </div>
        </div>
      </section>

      <div className="mt-4 lg:hidden">{startCard}</div>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          {/* Role + briefing */}
          <Card className="p-5 sm:p-6">
            <SectionTitle icon={ScrollText} color="indigo" title="Your mission" />
            {briefLoading ? (
              <div className="mt-4 space-y-2">
                <Skeleton className="h-16 w-full rounded-2xl" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-11/12" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ) : b?.briefing ? (
              <div className="mt-4 space-y-4">
                {b.learner_role && (
                  <div className="flex items-center gap-3 rounded-2xl bg-gradient-to-r from-indigo-50 via-violet-50 to-white p-3 ring-1 ring-indigo-100">
                    <span className="grid size-10 place-items-center rounded-xl bg-brand-gradient text-white shadow-sm">
                      <UserRound className="size-5" aria-hidden />
                    </span>
                    <div>
                      <p className="text-2xs font-semibold uppercase tracking-wider text-indigo-700">You are playing</p>
                      <p className="font-semibold text-slate-900">{b.learner_role}</p>
                    </div>
                  </div>
                )}
                <Markdown className="text-[15px]">{b.briefing}</Markdown>
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                Your full briefing — who you are, who is involved and what’s at stake — opens the moment you enter the environment. Simulated time
                doesn’t start until you take your first action, so you’ll have time to read it.
              </p>
            )}
          </Card>

          {/* Objectives */}
          {!!b?.objectives.length && (
            <Card className="p-5 sm:p-6">
              <SectionTitle icon={Target} color="emerald" title="Objectives" />
              <ol className="mt-4 grid gap-3 sm:grid-cols-2">
                {b.objectives.map((o, i) => {
                  const c = colorClasses(CATEGORY_COLORS[(i + 2) % CATEGORY_COLORS.length]!);
                  return (
                    <li key={i} className="flex items-start gap-3 rounded-2xl border border-slate-100 bg-slate-50/60 p-3.5">
                      <span className={cn("grid size-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br text-xs font-bold text-white shadow-sm", c.gradient)}>{i + 1}</span>
                      <span className="text-sm text-slate-700">{o}</span>
                    </li>
                  );
                })}
              </ol>
            </Card>
          )}

          {/* People + tools */}
          {b && (b.characters.length > 0 || b.tools.length > 0) && <Environment briefing={b} />}

          {/* Scoring */}
          <Card className="p-5 sm:p-6">
            <SectionTitle icon={Crosshair} color="violet" title="How you're scored" />
            {briefLoading ? (
              <div className="mt-5 space-y-3">
                <Skeleton className="h-3 w-full rounded-full" />
                <Skeleton className="h-24 w-full rounded-2xl" />
              </div>
            ) : b?.dimensions.length ? (
              <Scoring briefing={b} />
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                A deterministic engine scores what you actually do across weighted dimensions such as technical accuracy, process, communication,
                decision making and efficiency. You’ll see the full breakdown in your debrief.
              </p>
            )}
          </Card>

          {/* Rules */}
          <Card className="p-5 sm:p-6">
            <SectionTitle icon={ListChecks} color="amber" title="Rules of engagement" />
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              <Rule icon={s.is_graded ? EyeOff : Eye} color={s.is_graded ? "violet" : "emerald"} title={s.is_graded ? "Graded attempt" : "Practice mode"}>
                {s.is_graded
                  ? "Feedback on individual actions is hidden until your debrief. The AI tutor switches to hints while this simulation is in progress."
                  : "You'll get instant feedback on each action as you work."}
              </Rule>
              <Rule icon={Timer} color="teal" title="Simulated clock">
                {b?.target_minutes
                  ? `Aim to resolve within ${b.target_minutes} simulated minutes. Each action costs time; real time doesn't count.`
                  : "Each action costs simulated time; real time doesn't count. Efficient, purposeful work scores higher."}
              </Rule>
              <Rule icon={RotateCcw} color="sky" title="Attempts">
                {s.max_attempts ? `${remaining} of ${s.max_attempts} attempts remaining. An unfinished attempt resumes where you left off.` : "Unlimited attempts. An unfinished attempt resumes where you left off."}
              </Rule>
              <Rule icon={Flag} color="rose" title="Consequences">
                People react to what you do — patience runs out, issues escalate and new problems can appear.
                {b?.critical_cap != null ? ` A critical mistake caps your score at ${b.critical_cap}.` : " Critical mistakes cap your score."}
              </Rule>
            </ul>
          </Card>
        </div>

        {/* Start rail */}
        <aside className="space-y-4 lg:sticky lg:top-24">
          <div className="hidden lg:block">{startCard}</div>

          {sessions.length > 0 && (
            <Card className="p-5">
              <h2 className="text-sm font-semibold text-slate-900">Your attempts</h2>
              <ul className="mt-3 space-y-1">
                {sessions.slice(0, 5).map((x) => (
                  <li key={x.id}>
                    <Link
                      href={`/app/simulations/session/${x.id}`}
                      className="flex items-center justify-between gap-3 rounded-xl px-2.5 py-2 text-sm transition-colors hover:bg-slate-50 focus-visible:focus-ring"
                    >
                      <span className="min-w-0">
                        <span className="block font-medium text-slate-800">Attempt {x.attempt_number}</span>
                        <span className="block text-xs text-muted-foreground">{formatRelative(x.completed_at ?? x.started_at)}</span>
                      </span>
                      {x.status === "active" ? (
                        <StatusPill status="in_progress" label="In progress" size="sm" />
                      ) : x.band ? (
                        <span className="flex items-center gap-2">
                          <span className="font-semibold tabular-nums text-slate-900">{Math.round(x.total_score ?? 0)}</span>
                          <BandChip band={x.band} size="sm" />
                        </span>
                      ) : (
                        <StatusPill status={x.status} size="sm" />
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {!!b?.phases.length && (
            <Card className="p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <BadgeCheck className="size-4 text-emerald-600" aria-hidden />
                Workflow
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">The professional process you’ll be assessed against.</p>
              <ol className="mt-3">
                {b.phases.map((p, i) => {
                  const c = colorClasses(CATEGORY_COLORS[i % CATEGORY_COLORS.length]!);
                  return (
                    <li key={p} className="relative flex items-center gap-3 pb-3 last:pb-0">
                      {i < b.phases.length - 1 && <span className="absolute left-[11px] top-6 h-[calc(100%-1rem)] w-0.5 bg-slate-200" aria-hidden />}
                      <span className={cn("relative grid size-6 shrink-0 place-items-center rounded-full bg-gradient-to-br text-2xs font-bold text-white shadow-sm", c.gradient)}>{i + 1}</span>
                      <span className="text-sm text-slate-700">{p}</span>
                    </li>
                  );
                })}
              </ol>
            </Card>
          )}
        </aside>
      </div>

      <EnteringEnvironment open={entering} ready={ready} title={s.title} environment={s.environment_type} industry={s.industry} />
    </div>
  );
}

/* ------------------------------------------------------------------ environment: people + tools */

function Environment({ briefing: b }: { briefing: SimBriefing }) {
  return (
    <Card className="p-5 sm:p-6">
      <div className="grid gap-6 md:grid-cols-2">
        {b.characters.length > 0 && (
          <div>
            <SectionTitle icon={Users} color="fuchsia" title="Who you'll work with" />
            <ul className="mt-4 space-y-2">
              {b.characters.map((c) => (
                <li key={c.name} className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-2.5 shadow-sm">
                  <CharacterAvatar c={{ id: c.name, name: c.name, avatar: null }} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-slate-900">{c.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{c.role}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {b.tools.length > 0 && (
          <div>
            <SectionTitle icon={Wrench} color="teal" title="Tools at your disposal" />
            <ul className="mt-4 space-y-2">
              {b.tools.map((t) => {
                const Icon = toolIcon(t.icon);
                const c = colorClasses(panelColor(t.icon === "monitor" ? "system_info" : t.icon === "message" ? "chat" : t.icon, t.name));
                return (
                  <li key={t.name} className="flex items-start gap-3 rounded-2xl border border-slate-100 bg-white p-2.5 shadow-sm">
                    <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-white shadow-sm", c.gradient)}>
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-slate-900">{t.name}</span>
                      {t.description && <span className="block text-xs text-muted-foreground">{t.description}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ scoring model */

function Scoring({ briefing: b }: { briefing: SimBriefing }) {
  const total = b.dimensions.reduce((a, d) => a + d.weight, 0) || 1;
  const bands = [...b.bands].sort((x, y) => x.min - y.min);
  return (
    <div className="mt-5 space-y-6">
      <div>
        <div className="flex h-3 overflow-hidden rounded-full" role="img" aria-label={`Weights: ${b.dimensions.map((d) => `${d.name} ${d.weight}%`).join(", ")}`}>
          {b.dimensions.map((d, i) => (
            <span key={d.id} className={cn(colorClasses(CATEGORY_COLORS[i % CATEGORY_COLORS.length]!).solid, "border-r-2 border-white last:border-r-0")} style={{ width: `${(d.weight / total) * 100}%` }} />
          ))}
        </div>
        <ul className="mt-4 grid gap-2.5 sm:grid-cols-2">
          {b.dimensions.map((d, i) => {
            const c = colorClasses(CATEGORY_COLORS[i % CATEGORY_COLORS.length]!);
            return (
              <li key={d.id} className="rounded-xl px-3 py-2.5 ring-1 ring-inset ring-slate-100">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-sm font-medium text-slate-800">
                    <span className={cn("size-2.5 rounded-full", c.solid)} aria-hidden />
                    {d.name}
                  </span>
                  <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold tabular-nums", c.soft, c.text)}>{d.weight}%</span>
                </div>
                {d.description && <p className="mt-1 pl-[18px] text-xs text-muted-foreground">{d.description}</p>}
              </li>
            );
          })}
        </ul>
      </div>

      {bands.length > 0 && (
        <div>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-2xs font-semibold uppercase tracking-wider text-slate-500">Performance bands</h3>
            <p className="text-xs text-slate-600">
              Pass mark <span className="font-semibold tabular-nums text-slate-900">{b.pass_mark}</span>
              {b.target_minutes ? (
                <>
                  {" "}
                  · time target <span className="font-semibold tabular-nums text-slate-900">{b.target_minutes} min</span>
                </>
              ) : null}
            </p>
          </div>
          <div className="relative pt-1">
            <div className="flex h-9 overflow-hidden rounded-xl ring-1 ring-inset ring-slate-200">
              {bands.map((band, i) => {
                const next = bands[i + 1]?.min ?? 100;
                const c = colorClasses(bandMeta(band.name).color);
                const width = Math.max(0, next - band.min);
                return (
                  <div key={band.name} className={cn("flex min-w-0 items-center justify-center border-r border-white/80 px-1 last:border-r-0", c.soft)} style={{ width: `${width}%` }} title={`${bandMeta(band.name).label}: ${band.min}–${next}`}>
                    <span className={cn("truncate text-2xs font-semibold", c.text)}>{width >= 10 ? bandMeta(band.name).label : ""}</span>
                  </div>
                );
              })}
            </div>
            {/* pass mark marker */}
            <div className="pointer-events-none absolute inset-y-0" style={{ left: `${b.pass_mark}%` }} aria-hidden>
              <div className="h-full w-0.5 -translate-x-1/2 rounded-full bg-slate-900" />
            </div>
            <div className="mt-1.5 flex justify-between font-mono text-2xs tabular-nums text-slate-500" aria-hidden>
              <span>0</span>
              <span>100</span>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {[...bands].reverse().map((band) => (
              <span key={band.name} className="inline-flex items-center gap-1.5">
                <BandChip band={band.name} size="sm" />
                <span className="text-2xs tabular-nums text-slate-500">≥ {band.min}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ small parts */

function Fact({ icon: Icon, color, label, value }: { icon: React.ElementType; color: Parameters<typeof colorClasses>[0]; label: string; value: React.ReactNode }) {
  const c = colorClasses(color);
  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3">
      <dt className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-slate-500">
        <Icon className={cn("size-3.5", c.icon)} aria-hidden />
        {label}
      </dt>
      <dd className="mt-1 text-sm font-semibold text-slate-900">{value}</dd>
    </div>
  );
}

function SectionTitle({ icon: Icon, color, title }: { icon: React.ElementType; color: Parameters<typeof colorClasses>[0]; title: string }) {
  const c = colorClasses(color);
  return (
    <h2 className="flex items-center gap-3 font-display text-base font-semibold tracking-tight text-slate-900">
      <span className={cn("grid size-9 place-items-center rounded-xl", c.soft, c.icon)}>
        <Icon className="size-[18px]" aria-hidden />
      </span>
      {title}
    </h2>
  );
}

function Rule({ icon: Icon, color, title, children }: { icon: React.ElementType; color: Parameters<typeof colorClasses>[0]; title: string; children: React.ReactNode }) {
  const c = colorClasses(color);
  return (
    <li className="flex gap-3 rounded-2xl border border-slate-100 p-3.5">
      <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", c.soft, c.icon)}>
        <Icon className="size-4" aria-hidden />
      </span>
      <div>
        <p className="text-sm font-semibold text-slate-900">{title}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{children}</p>
      </div>
    </li>
  );
}
