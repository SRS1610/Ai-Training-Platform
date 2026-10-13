"use client";

import type { Page } from "@praxis/types";
import {
  Badge,
  BandChip,
  Breadcrumbs,
  Button,
  Card,
  DataTable,
  EmptyState,
  KpiTile,
  Progress,
  StatusPill,
  Tabs,
  TabsList,
  TabsTrigger,
  bandMeta,
  cn,
  colorClasses,
  type ColumnDef,
} from "@praxis/ui";
import { ColorBarChart, DonutChart, SkillRadarChart } from "@praxis/ui/charts";
import { useQuery } from "@tanstack/react-query";
import { AlertOctagon, BarChart3, Clock, Flame, Gauge, ListOrdered, PencilRuler, Radar, Target, Timer, Trophy, Users, Workflow } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { ErrorState } from "@/components/common/error-state";
import { useMemberName } from "@/components/grading/history-integrity";
import { sk, type DraftOut, type SessionSummary, type SimPhase, type SimulationOut } from "@/components/sim-builder/types";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDateTime, formatMinutes } from "@/lib/format";
import { ChartCard, ChartDataTable, FunnelBars, KpiSkeletonRow, num } from "./kit";
import { ReplaySheet } from "./replay-sheet";

export interface SimAnalytics {
  simulation_id: string;
  attempts: number;
  learners: number;
  active: number;
  completed: number;
  abandoned: number;
  expired: number;
  completion_rate: number;
  pass_rate: number;
  score: { average: number | null; median: number | null; min: number | null; max: number | null };
  dimensions: { id: string; name: string; average_percent: number | null; median_percent: number | null }[];
  band_distribution: Record<string, number>;
  common_mistakes: { action_id: string; label: string; classification: string; count: number }[];
  average_sim_minutes: number | null;
  average_real_minutes: number | null;
  phase_reach: Record<string, number>;
  phase_dropoff: Record<string, number>;
}

const bandKey = (b: string) => b.toLowerCase().replace(/[\s-]+/g, "_");
const BAND_RANK = ["expert", "advanced", "competent", "needs_improvement", "fail"];

function LearnerCell({ id }: { id: string }) {
  const name = useMemberName(id);
  return <span className="font-medium text-slate-900">{name === "Staff member" ? `Learner ${id.slice(0, 6)}` : name}</span>;
}

function SessionsTable({ simId, onOpen }: { simId: string; onOpen: (id: string) => void }) {
  const [pagination, setPagination] = React.useState({ pageIndex: 0, pageSize: 10 });
  const q = useQuery({
    queryKey: sk.sessions(simId, pagination),
    queryFn: ({ signal }) => api.get<Page<SessionSummary>>(`/simulations/${simId}/sessions`, { signal, query: { page: pagination.pageIndex + 1, page_size: pagination.pageSize } }),
    placeholderData: (p) => p,
  });
  const columns = React.useMemo<ColumnDef<SessionSummary, unknown>[]>(
    () => [
      { id: "learner", header: "Learner", cell: ({ row }) => <LearnerCell id={row.original.user_id} />, enableSorting: false },
      { accessorKey: "attempt_number", header: "Attempt", meta: { cellClassName: "tabular-nums" } },
      { accessorKey: "status", header: "Status", cell: ({ row }) => <StatusPill status={row.original.status} size="sm" /> },
      { accessorKey: "phase", header: "Phase", cell: ({ row }) => <span className="font-mono text-xs">{row.original.phase}</span> },
      { accessorKey: "action_count", header: "Actions", meta: { cellClassName: "tabular-nums" } },
      { accessorKey: "sim_minutes_elapsed", header: "Sim time", cell: ({ row }) => <span className="tabular-nums">{formatMinutes(row.original.sim_minutes_elapsed)}</span> },
      {
        accessorKey: "total_score",
        header: "Score",
        cell: ({ row }) =>
          row.original.total_score === null || row.original.total_score === undefined ? (
            <span className="text-slate-400">—</span>
          ) : (
            <span className="flex items-center gap-2">
              <span className={cn("font-bold tabular-nums", row.original.passed ? "text-emerald-700" : "text-rose-700")}>{row.original.total_score.toFixed(1)}</span>
              {row.original.band && <BandChip band={row.original.band} size="sm" />}
            </span>
          ),
      },
      { accessorKey: "started_at", header: "Started", cell: ({ row }) => <span className="whitespace-nowrap text-xs">{formatDateTime(row.original.started_at)}</span> },
    ],
    [],
  );
  return (
    <DataTable
      aria-label="Simulation sessions"
      columns={columns}
      data={q.data?.items ?? []}
      loading={q.isLoading}
      total={q.data?.total ?? 0}
      pagination={pagination}
      onPaginationChange={setPagination}
      onRowClick={(r) => onOpen(r.id)}
      columnToggle={false}
      empty={{ title: "No sessions yet", description: "Sessions appear here once learners play the published simulation." }}
      rowActions={[{ label: "Open replay", onSelect: (r) => onOpen(r.id) }]}
    />
  );
}

export function SimulationAnalyticsView({ id }: { id: string }) {
  const { canAny } = useAuth();
  const canSessions = canAny(["simulations.manage", "submissions.review"]);
  const canBuild = canAny(["simulations.manage"]);
  const [chart, setChart] = React.useState<"bars" | "radar">("bars");
  const [replay, setReplay] = React.useState<string | null>(null);
  const sim = useQuery({ queryKey: sk.detail(id), queryFn: ({ signal }) => api.get<SimulationOut>(`/simulations/${id}`, { signal }) });
  const q = useQuery({ queryKey: sk.analytics(id), queryFn: ({ signal }) => api.get<SimAnalytics>(`/simulations/${id}/analytics`, { signal }) });
  // Phase names + scenario order for the drop-off funnel (falls back to IDs sorted by reach).
  const draft = useQuery({
    queryKey: sk.draft(id),
    queryFn: ({ signal }) => api.get<DraftOut>(`/simulations/${id}/draft`, { signal }),
    staleTime: 5 * 60_000,
    retry: false,
    enabled: canBuild,
  });
  const passMark = Number((draft.data?.definition as { scoring?: { pass_mark?: number } } | undefined)?.scoring?.pass_mark ?? 70);
  const phaseMeta = React.useMemo(() => {
    const def = (draft.data?.definition ?? null) as { initial_phase?: string; phases?: SimPhase[] } | null;
    const phases = def?.phases ?? [];
    const byId = new Map(phases.map((p) => [p.id, p]));
    const order: string[] = [];
    const todo = def?.initial_phase ? [def.initial_phase] : [];
    while (todo.length) {
      const cur = todo.shift()!;
      if (order.includes(cur) || !byId.has(cur)) continue;
      order.push(cur);
      const p = byId.get(cur)!;
      todo.push(...(p.transitions ?? []), ...(p.auto_advance ?? []).map((x) => x.to));
    }
    for (const p of phases) if (!order.includes(p.id)) order.push(p.id);
    return { order, name: (pid: string) => byId.get(pid)?.name ?? pid };
  }, [draft.data]);

  const header = (
    <>
      <Breadcrumbs
        linkComponent={Link}
        className="mb-3"
        items={
          canBuild
            ? [{ label: "Simulation builder", href: "/app/instructor/simulations" }, { label: sim.data?.title ?? "Simulation", href: `/app/instructor/simulations/${id}` }, { label: "Analytics" }]
            : [{ label: "Analytics", href: "/app/instructor/analytics" }, { label: sim.data?.title ?? "Simulation" }]
        }
      />
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-500 text-white shadow-glow">
            <BarChart3 className="size-6" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">Simulation analytics</p>
            <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{sim.data?.title ?? "…"}</h1>
            <p className="mt-1 text-sm text-muted-foreground">How learners perform, where they struggle and which mistakes they make.</p>
          </div>
        </div>
        {canBuild && (
          <Button variant="secondary" leftIcon={<PencilRuler />} asChild>
            <Link href={`/app/instructor/simulations/${id}`}>Open builder</Link>
          </Button>
        )}
      </header>
    </>
  );

  if (q.isLoading)
    return (
      <div>
        {header}
        <KpiSkeletonRow />
      </div>
    );
  if (q.isError || !q.data)
    return (
      <div>
        {header}
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </div>
    );

  const a = q.data;
  const dims = a.dimensions.filter((d) => d.average_percent !== null);
  const bands = Object.entries(a.band_distribution)
    .sort(([x], [y]) => BAND_RANK.indexOf(bandKey(x)) - BAND_RANK.indexOf(bandKey(y)))
    .map(([name, value]) => ({ name: bandMeta(bandKey(name)).label === name ? name : bandMeta(bandKey(name)).label, value, color: colorClasses(bandMeta(bandKey(name)).color).hex }));
  const rank = (pid: string) => {
    const i = phaseMeta.order.indexOf(pid);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  const reach = Object.entries(a.phase_reach).sort((x, y) => rank(x[0]) - rank(y[0]) || y[1] - x[1]);
  const maxMistake = Math.max(1, ...a.common_mistakes.map((m) => m.count));
  const statusRows = [
    { k: "Completed", v: a.completed, c: "bg-emerald-500" },
    { k: "In progress", v: a.active, c: "bg-sky-500" },
    { k: "Abandoned", v: a.abandoned, c: "bg-amber-500" },
    { k: "Expired", v: a.expired, c: "bg-rose-500" },
  ];

  return (
    <div className="space-y-6">
      <div>{header}</div>

      {a.attempts === 0 ? (
        <Card>
          <EmptyState
            size="lg"
            illustration="chart"
            title="No attempts yet"
            description={sim.data?.published_version ? "Once learners start this simulation, scores, mistakes and drop-off appear here." : "Publish the simulation so learners can start playing it."}
            action={
              canBuild ? (
                <Button variant="gradient" asChild>
                  <Link href={`/app/instructor/simulations/${id}`}>{sim.data?.published_version ? "Back to the builder" : "Open builder to publish"}</Link>
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            <KpiTile label="Attempts" value={a.attempts} icon={<Workflow />} color="indigo" hint={`${a.active} in progress`} />
            <KpiTile label="Learners" value={a.learners} icon={<Users />} color="sky" hint={`${(a.attempts / Math.max(1, a.learners)).toFixed(1)} attempts each`} />
            <KpiTile label="Completion rate" value={`${Math.round(a.completion_rate * 100)}%`} icon={<Target />} color="emerald" hint={`${a.completed} completed`} />
            <KpiTile label="Pass rate" value={`${Math.round(a.pass_rate * 100)}%`} icon={<Trophy />} color="violet" hint="Of completed runs" />
            <KpiTile label="Average score" value={num(a.score.average)} icon={<Gauge />} color="amber" hint={`Median ${num(a.score.median)} · range ${num(a.score.min, 0)}–${num(a.score.max, 0)}`} />
            <KpiTile label="Avg time" value={a.average_sim_minutes !== null ? formatMinutes(a.average_sim_minutes) : "—"} icon={<Timer />} color="teal" hint={a.average_real_minutes !== null ? `${formatMinutes(a.average_real_minutes)} real time` : "Simulated minutes"} />
          </div>

          <div className="grid gap-6 xl:grid-cols-3">
            <ChartCard
              className="xl:col-span-2"
              title="Performance by dimension"
              description="Average % of each scoring dimension across completed runs"
              icon={chart === "bars" ? BarChart3 : Radar}
              color="indigo"
              action={
                <Tabs value={chart} onValueChange={(v) => setChart(v as "bars" | "radar")}>
                  <TabsList aria-label="Chart type">
                    <TabsTrigger value="bars">Bars</TabsTrigger>
                    <TabsTrigger value="radar">Radar</TabsTrigger>
                  </TabsList>
                </Tabs>
              }
            >
              {dims.length === 0 ? (
                <EmptyState size="sm" illustration="chart" title="No completed runs yet" />
              ) : chart === "bars" ? (
                <ColorBarChart
                  aria-label="Average percent per dimension"
                  data={dims.map((d) => ({ name: d.name, average: d.average_percent ?? 0, median: d.median_percent ?? 0 }))}
                  xKey="name"
                  layout="horizontal"
                  colorByIndex
                  series={[{ key: "average", label: "Average %" }]}
                  height={Math.max(220, dims.length * 48)}
                  valueFormatter={(v) => `${Number(v).toFixed(0)}%`}
                />
              ) : (
                <>
                  <SkillRadarChart aria-label={`Dimension radar: average per dimension against the ${passMark}% pass target`} data={dims.map((d) => ({ subject: d.name, value: d.average_percent ?? 0, benchmark: passMark }))} height={300} />
                  <ul className="mt-1 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-xs font-medium text-slate-600" aria-label="Legend">
                    <li className="inline-flex items-center gap-1.5">
                      <svg width="22" height="8" aria-hidden>
                        <line x1="0" y1="4" x2="22" y2="4" stroke="#6366f1" strokeWidth="3" />
                      </svg>
                      Average
                    </li>
                    <li className="inline-flex items-center gap-1.5">
                      <svg width="22" height="8" aria-hidden>
                        <line x1="0" y1="4" x2="22" y2="4" stroke="#f59e0b" strokeWidth="2" strokeDasharray="4 3" />
                      </svg>
                      Pass target ({passMark}%)
                    </li>
                  </ul>
                </>
              )}
              {dims.length > 0 && (
                <ChartDataTable caption="Dimension averages" columns={["Dimension", "Average %", "Median %"]} rows={dims.map((d) => [d.name, num(d.average_percent), num(d.median_percent)])} />
              )}
            </ChartCard>
            <ChartCard title="Band distribution" description="Completed runs by performance band" icon={Trophy} color="violet">
              {bands.length ? (
                <DonutChart aria-label="Band distribution" data={bands} centerLabel={a.completed} centerSub="runs" height={200} />
              ) : (
                <EmptyState size="sm" illustration="trophy" title="No bands yet" />
              )}
            </ChartCard>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <ChartCard title="Phase reach & drop-off" description="How many attempts reached each phase, and where unsuccessful runs stopped" icon={ListOrdered} color="sky">
              {reach.length ? (
                <FunnelBars
                  aria-label="Phase reach"
                  max={a.attempts}
                  rows={reach.map(([p, n]) => ({
                    key: p,
                    label: (
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-xs font-semibold text-slate-800">{phaseMeta.name(p)}</span>
                        {phaseMeta.name(p) !== p && <span className="truncate font-mono text-2xs text-slate-500">{p}</span>}
                      </span>
                    ),
                    value: n,
                    sub: a.phase_dropoff[p] ? <span className="font-semibold text-rose-700">−{a.phase_dropoff[p]} stopped</span> : null,
                  }))}
                  valueLabel={(v) => `${v} · ${Math.round((v / Math.max(1, a.attempts)) * 100)}%`}
                />
              ) : (
                <EmptyState size="sm" illustration="chart" title="No phase data" />
              )}
              <div className="mt-5">
                <p className="mb-1.5 text-xs font-semibold text-slate-600">Session outcomes</p>
                <div className="flex h-3 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={statusRows.map((r) => `${r.k}: ${r.v}`).join(", ")}>
                  {statusRows.map((r) => (
                    <div key={r.k} className={r.c} style={{ width: `${(r.v / Math.max(1, a.attempts)) * 100}%` }} />
                  ))}
                </div>
                <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                  {statusRows.map((r) => (
                    <li key={r.k} className="flex items-center gap-1.5">
                      <span className={cn("size-2 rounded-full", r.c)} aria-hidden />
                      {r.k} <span className="font-semibold tabular-nums text-slate-900">{r.v}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </ChartCard>
            <ChartCard title="Common mistakes" description="Most frequent incorrect and critical actions" icon={AlertOctagon} color="rose">
              {a.common_mistakes.length ? (
                <ol className="space-y-2.5">
                  {a.common_mistakes.slice(0, 10).map((m, i) => (
                    <li key={`${m.action_id}-${m.classification}`} className="flex items-center gap-3">
                      <span className="w-5 text-right text-xs font-bold tabular-nums text-slate-400">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-medium text-slate-800" title={m.action_id}>
                            {m.label}
                          </p>
                          <Badge tone={m.classification === "critical" ? "danger" : "warning"} size="sm">
                            {m.classification === "critical" && <Flame aria-hidden />}
                            {m.classification}
                          </Badge>
                        </div>
                        <Progress value={(m.count / maxMistake) * 100} color={m.classification === "critical" ? "rose" : "amber"} size="xs" className="mt-1" aria-label={`${m.label}: ${m.count} times`} />
                      </div>
                      <span className="w-10 text-right text-sm font-bold tabular-nums text-slate-900">{m.count}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <EmptyState size="sm" illustration="trophy" title="No mistakes recorded" description="Nobody has taken an incorrect or critical action yet." />
              )}
            </ChartCard>
          </div>
        </>
      )}

      {canSessions && (
        <section aria-labelledby="sessions-heading" className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 id="sessions-heading" className="font-display text-lg font-semibold text-slate-900">
                Sessions
              </h2>
              <p className="flex items-center gap-1 text-sm text-muted-foreground">
                <Clock className="size-3.5" aria-hidden /> Click a session to replay every action and state change.
              </p>
            </div>
          </div>
          <SessionsTable simId={id} onOpen={setReplay} />
        </section>
      )}
      <ReplaySheet sessionId={replay} onOpenChange={(o) => !o && setReplay(null)} />
    </div>
  );
}
