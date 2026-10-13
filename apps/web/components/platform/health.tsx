"use client";

import { Badge, Button, Skeleton, Switch, cn } from "@praxis/ui";
import { DonutChart } from "@praxis/ui/charts";
import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, Bot, Building2, CheckCircle2, Clock, Cpu, Database, Gauge, HardDrive, Layers, RefreshCw, Server, UsersRound, XCircle } from "lucide-react";
import * as React from "react";
import { ak } from "@/components/admin/keys";
import type { HealthOut, MetricsSnapshot } from "@/components/admin/types";
import { BarList, SectionCard, fmtBytes, fmtCompact, fmtDuration, fmtNumber, humanizeFeature } from "@/components/admin/ui";
import { ErrorState } from "@/components/common/error-state";
import { api } from "@/lib/api";

type Tone = "ok" | "warn" | "bad" | "unknown";

const TONE: Record<Tone, { dot: string; ring: string; bg: string; text: string; label: string }> = {
  ok: { dot: "bg-emerald-500", ring: "ring-emerald-200", bg: "from-emerald-50", text: "text-emerald-700", label: "Healthy" },
  warn: { dot: "bg-amber-500", ring: "ring-amber-200", bg: "from-amber-50", text: "text-amber-800", label: "Degraded" },
  bad: { dot: "bg-rose-500", ring: "ring-rose-200", bg: "from-rose-50", text: "text-rose-700", label: "Down" },
  unknown: { dot: "bg-slate-400", ring: "ring-slate-200", bg: "from-slate-50", text: "text-slate-600", label: "Unknown" },
};

function toneOf(status: unknown): Tone {
  const s = String(status ?? "").toLowerCase();
  if (s === "ok" || s === "healthy") return "ok";
  if (s === "degraded" || s === "warn") return "warn";
  if (s === "error" || s === "unavailable" || s === "down") return "bad";
  return "unknown";
}

function latencyTone(ms: number | undefined, good: number, warn: number): Tone {
  if (ms === undefined || ms === null) return "unknown";
  return ms <= good ? "ok" : ms <= warn ? "warn" : "bad";
}

function StatusDot({ tone, pulse }: { tone: Tone; pulse?: boolean }) {
  return (
    <span className="relative inline-flex size-3" aria-hidden>
      {pulse && tone === "ok" && <span className={cn("absolute inline-flex size-full rounded-full opacity-60 motion-safe:animate-ping", TONE[tone].dot)} />}
      <span className={cn("relative inline-flex size-3 rounded-full", TONE[tone].dot)} />
    </span>
  );
}

function ComponentCard({ icon: Icon, title, tone, value, unit, detail }: { icon: typeof Database; title: string; tone: Tone; value: React.ReactNode; unit?: string; detail?: React.ReactNode }) {
  const t = TONE[tone];
  return (
    <div className={cn("rounded-2xl border border-slate-200/80 bg-gradient-to-br to-white p-4 shadow-soft ring-1 ring-inset", t.bg, t.ring)}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <Icon className="size-4 text-slate-500" aria-hidden />
          {title}
        </span>
        <span className={cn("inline-flex items-center gap-1.5 text-xs font-semibold", t.text)}>
          <StatusDot tone={tone} />
          {t.label}
        </span>
      </div>
      <p className="mt-3 font-display text-2xl font-bold tabular-nums text-slate-900">
        {value}
        {unit && <span className="ml-1 text-sm font-medium text-slate-500">{unit}</span>}
      </p>
      {detail && <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>}
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = { "2": "#10b981", "3": "#0ea5e9", "4": "#f59e0b", "5": "#f43f5e" };

export function SystemHealth() {
  const [auto, setAuto] = React.useState(true);
  const q = useQuery({
    queryKey: ak.platform.health,
    queryFn: ({ signal }) => api.get<HealthOut>("/platform/health", { signal }),
    refetchInterval: auto ? 10_000 : false,
    refetchIntervalInBackground: false,
  });
  if (q.isLoading)
    return (
      <div className="space-y-6">
        <Skeleton className="h-28 rounded-2xl" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} size="lg" />;
  const h = q.data!;
  const m = h.metrics as unknown as MetricsSnapshot;
  const overall = toneOf(h.status);
  const db = h.database as { status?: string; latency_ms?: number; error?: string };
  const redis = h.redis as { status?: string; latency_ms?: number; error?: string };
  const queue = h.queue as Record<string, number | string>;
  const queues = Object.entries(queue).filter(([k]) => k !== "status") as [string, number][];
  const depth = queues.reduce((a, [, v]) => a + Number(v || 0), 0);
  const ai = h.ai as { calls_24h?: number; errors_24h?: number; errors_since_start?: number };
  const storage = h.storage as { bytes?: number; files?: number };
  const aiErrorRate = ai.calls_24h ? ((ai.errors_24h ?? 0) / ai.calls_24h) * 100 : 0;
  const statusEntries = Object.entries(m.status_counts ?? {}).sort();
  const errors5xx = statusEntries.filter(([k]) => k.startsWith("5")).reduce((a, [, v]) => a + v, 0);

  return (
    <div className="space-y-6">
      <section
        aria-label="Overall status"
        className={cn(
          "relative flex flex-col gap-4 overflow-hidden rounded-3xl p-6 text-white shadow-glow sm:flex-row sm:items-center",
          overall === "ok" ? "bg-gradient-to-r from-emerald-700 via-teal-700 to-sky-700" : overall === "warn" ? "bg-gradient-to-r from-amber-700 via-orange-700 to-rose-700" : "bg-gradient-to-r from-rose-700 via-rose-600 to-fuchsia-700",
        )}
      >
        <div className="pointer-events-none absolute inset-0 bg-grid-faint opacity-20 [background-size:24px_24px]" aria-hidden />
        <span className="relative grid size-14 shrink-0 place-items-center rounded-2xl bg-white/20 ring-1 ring-white/30 backdrop-blur">
          {overall === "ok" ? <CheckCircle2 className="size-7" aria-hidden /> : overall === "warn" ? <AlertTriangle className="size-7" aria-hidden /> : <XCircle className="size-7" aria-hidden />}
        </span>
        <div className="relative flex-1" aria-live="polite">
          <p className="text-xs font-semibold uppercase tracking-wider text-white/85">System status</p>
          <p className="font-display text-2xl font-bold">{overall === "ok" ? "All systems operational" : overall === "warn" ? "Degraded performance" : "Service disruption"}</p>
          <p className="text-sm text-white/90">
            API up {fmtDuration(m.uptime_seconds)} · {fmtCompact(m.requests_total)} requests served · updated {q.dataUpdatedAt ? new Date(q.dataUpdatedAt).toLocaleTimeString() : "—"}
          </p>
        </div>
        <div className="relative flex items-center gap-3 rounded-2xl bg-white/15 px-3 py-2 ring-1 ring-white/25">
          <label htmlFor="health-auto-refresh" className="flex items-center gap-2 text-sm font-medium">
            <Switch id="health-auto-refresh" checked={auto} onCheckedChange={setAuto} aria-label="Auto-refresh every 10 seconds" className="data-[state=checked]:bg-white/40" />
            Auto-refresh
          </label>
          <Button size="icon-sm" variant="white" aria-label="Refresh now" onClick={() => q.refetch()} disabled={q.isFetching}>
            <RefreshCw className={cn(q.isFetching && "animate-spin")} />
          </Button>
        </div>
      </section>

      <section aria-label="Components" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ComponentCard icon={Database} title="Database" tone={db.status === "ok" ? latencyTone(db.latency_ms, 25, 150) : toneOf(db.status)} value={db.latency_ms !== undefined ? fmtNumber(db.latency_ms, 1) : "—"} unit="ms" detail={db.error ?? "Round-trip SELECT 1"} />
        <ComponentCard icon={Server} title="Redis" tone={redis.status === "ok" ? latencyTone(redis.latency_ms, 10, 80) : toneOf(redis.status)} value={redis.latency_ms !== undefined ? fmtNumber(redis.latency_ms, 1) : "—"} unit={redis.latency_ms !== undefined ? "ms" : undefined} detail={redis.error ?? "PING latency"} />
        <ComponentCard
          icon={Layers}
          title="Job queues"
          tone={queue.status === "ok" ? (depth > 500 ? "bad" : depth > 50 ? "warn" : "ok") : toneOf(queue.status)}
          value={fmtNumber(depth)}
          unit="jobs waiting"
          detail={queues.length ? queues.map(([k, v]) => `${k}: ${v}`).join(" · ") : "Queue depth unavailable"}
        />
        <ComponentCard icon={Bot} title="AI providers" tone={aiErrorRate > 10 ? "bad" : aiErrorRate > 2 ? "warn" : "ok"} value={`${aiErrorRate.toFixed(1)}%`} unit="errors (24h)" detail={`${fmtNumber(ai.calls_24h)} calls · ${fmtNumber(ai.errors_24h)} failed · ${fmtNumber(ai.errors_since_start)} since start`} />
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <SectionCard title="Request latency" description="Since the API process started" icon={Gauge} color="indigo">
          <div className="grid grid-cols-3 gap-2">
            {(["p50", "p95", "p99"] as const).map((k) => {
              const v = m.latency_ms?.[k];
              const t = latencyTone(v, k === "p50" ? 100 : 400, k === "p50" ? 300 : 1200);
              return (
                <div key={k} className={cn("rounded-2xl bg-gradient-to-br to-white p-3 text-center ring-1 ring-inset", TONE[t].bg, TONE[t].ring)}>
                  <p className="text-xs font-semibold uppercase text-slate-600">{k}</p>
                  <p className={cn("font-display text-2xl font-bold tabular-nums", TONE[t].text)}>{fmtNumber(v, 0)}</p>
                  <p className="text-2xs text-slate-500">ms</p>
                </div>
              );
            })}
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl bg-slate-50 p-3">
              <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Activity className="size-3.5" aria-hidden /> Requests
              </dt>
              <dd className="font-semibold tabular-nums text-slate-900">{fmtNumber(m.requests_total)}</dd>
            </div>
            <div className={cn("rounded-xl p-3", errors5xx ? "bg-rose-50" : "bg-slate-50")}>
              <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <XCircle className="size-3.5" aria-hidden /> 5xx errors
              </dt>
              <dd className={cn("font-semibold tabular-nums", errors5xx ? "text-rose-700" : "text-slate-900")}>{fmtNumber(errors5xx)}</dd>
            </div>
          </dl>
        </SectionCard>
        <SectionCard title="Status code mix" icon={Activity} color="emerald">
          {statusEntries.length ? (
            <DonutChart
              data={statusEntries.map(([k, v]) => ({ name: k, value: v, color: STATUS_COLORS[k[0] ?? ""] ?? "#8b5cf6" }))}
              centerLabel={fmtCompact(m.requests_total)}
              centerSub="requests"
              height={180}
              aria-label="HTTP status code mix"
            />
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">No requests recorded yet</p>
          )}
        </SectionCard>
        <SectionCard title="Slowest routes" description="95th percentile latency" icon={Clock} color="amber">
          <BarList
            data={(m.slowest_routes_p95 ?? []).slice(0, 7).map((r) => ({
              key: r.route,
              label: <span className="font-mono text-xs">{r.route}</span>,
              value: r.p95_ms,
              display: `${fmtNumber(r.p95_ms, 0)} ms`,
              color: r.p95_ms > 1000 ? "rose" : r.p95_ms > 400 ? "amber" : "emerald",
            }))}
            empty="No traffic recorded yet"
          />
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <SectionCard title="AI calls by feature" description="Since the API process started" icon={Cpu} color="fuchsia">
          <BarList data={Object.entries(m.ai_calls ?? {}).map(([k, v]) => ({ key: k, label: humanizeFeature(k), value: v }))} empty="No AI calls yet" />
        </SectionCard>
        <SectionCard title="Storage" icon={HardDrive} color="sky">
          <p className="font-display text-3xl font-bold tabular-nums text-slate-900">{fmtBytes(storage.bytes ?? 0)}</p>
          <p className="text-sm text-muted-foreground">{fmtNumber(storage.files)} files stored</p>
        </SectionCard>
        <SectionCard title="Tenants" icon={Building2} color="violet">
          <div className="flex items-center gap-6">
            <div>
              <p className="font-display text-3xl font-bold tabular-nums text-slate-900">{fmtNumber(h.totals.organisations)}</p>
              <p className="text-sm text-muted-foreground">organisations</p>
            </div>
            <div>
              <p className="flex items-center gap-1.5 font-display text-3xl font-bold tabular-nums text-slate-900">
                <UsersRound className="size-6 text-sky-500" aria-hidden />
                {fmtCompact(h.totals.users)}
              </p>
              <p className="text-sm text-muted-foreground">users</p>
            </div>
          </div>
          <Badge tone="neutral" className="mt-4">
            Metrics are per API process and reset on restart
          </Badge>
        </SectionCard>
      </div>
    </div>
  );
}
