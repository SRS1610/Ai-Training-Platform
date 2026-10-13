"use client";

import { Avatar, Badge, Button, EmptyState, KpiTile, Skeleton, cn, toast } from "@praxis/ui";
import { TrendAreaChart } from "@praxis/ui/charts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Bell, BookOpen, Bot, Coins, Cpu, Gauge, Hash, Layers, RefreshCw, ShieldAlert, ShieldCheck, Sparkles, Users, Zap } from "lucide-react";
import * as React from "react";
import { ErrorState } from "@/components/common/error-state";
import { api } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import { ak } from "./keys";
import type { AIUsageOut } from "./types";
import { BarList, SectionCard, plural, fmtCompact, fmtNumber, fmtUsd, humanizeFeature, toastError } from "./ui";

/* ------------------------------------------------------------------ gauge */

export function budgetTone(pct: number | null | undefined): { stroke: string; text: string; label: string; bg: string } {
  const p = pct ?? 0;
  if (p >= 100) return { stroke: "#e11d48", text: "text-rose-700", label: "Budget exhausted", bg: "bg-rose-50" };
  if (p >= 90) return { stroke: "#f43f5e", text: "text-rose-700", label: "Critical", bg: "bg-rose-50" };
  if (p >= 75) return { stroke: "#f97316", text: "text-orange-700", label: "High", bg: "bg-orange-50" };
  if (p >= 50) return { stroke: "#f59e0b", text: "text-amber-800", label: "Watch", bg: "bg-amber-50" };
  return { stroke: "#10b981", text: "text-emerald-700", label: "Healthy", bg: "bg-emerald-50" };
}

/** Semicircle budget gauge with threshold ticks. */
export function BudgetGauge({ pct, thresholds, size = 240, label, sub }: { pct: number | null; thresholds: number[]; size?: number; label: React.ReactNode; sub?: React.ReactNode }) {
  const v = Math.max(0, Math.min(100, pct ?? 0));
  const r = size / 2 - 16;
  const cx = size / 2;
  const cy = size / 2;
  const arc = (from: number, to: number) => {
    const a0 = Math.PI * (1 - from / 100);
    const a1 = Math.PI * (1 - to / 100);
    const x0 = cx + r * Math.cos(a0);
    const y0 = cy - r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy - r * Math.sin(a1);
    return `M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}`;
  };
  const tone = budgetTone(pct);
  const id = React.useId().replace(/:/g, "");
  return (
    <div className="relative mx-auto" style={{ width: size, height: size / 2 + 28 }} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v)} aria-label={`Budget used ${Math.round(v)}%`}>
      <svg width={size} height={size / 2 + 12} viewBox={`0 0 ${size} ${size / 2 + 12}`} aria-hidden>
        <defs>
          <linearGradient id={`g${id}`} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#10b981" />
            <stop offset="50%" stopColor="#f59e0b" />
            <stop offset="80%" stopColor="#f97316" />
            <stop offset="100%" stopColor="#f43f5e" />
          </linearGradient>
        </defs>
        <path d={arc(0, 100)} fill="none" stroke="#eef2f7" strokeWidth={18} strokeLinecap="round" />
        <path d={arc(0, 100)} fill="none" stroke={`url(#g${id})`} strokeOpacity={0.18} strokeWidth={18} strokeLinecap="round" />
        {v > 0 && <path d={arc(0, Math.max(0.5, v))} fill="none" stroke={tone.stroke} strokeWidth={18} strokeLinecap="round" className="transition-all duration-700" />}
        {thresholds.map((t) => {
          const a = Math.PI * (1 - t / 100);
          const x0 = cx + (r - 14) * Math.cos(a);
          const y0 = cy - (r - 14) * Math.sin(a);
          const x1 = cx + (r + 14) * Math.cos(a);
          const y1 = cy - (r + 14) * Math.sin(a);
          return <line key={t} x1={x0} y1={y0} x2={x1} y2={y1} stroke="#334155" strokeWidth={2} strokeOpacity={0.55} strokeDasharray="2 2" />;
        })}
      </svg>
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center text-center">
        <span className={cn("font-display text-4xl font-bold tabular-nums", tone.text)}>{label}</span>
        {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ dashboard */

const MODEL_COLORS = ["sky", "violet", "teal", "fuchsia", "amber", "indigo"] as const;

/** Usage rows label people as "Full Name <email>". */
function splitPerson(label: string | null | undefined): { name: string; email: string | null } {
  if (!label) return { name: "System / API", email: null };
  const m = label.match(/^(.*?)\s*<([^>]+)>\s*$/);
  return m ? { name: m[1] || m[2]!, email: m[2]! } : { name: label, email: null };
}

const METRICS = [
  { key: "cost_usd", label: "Spend", color: "#d946ef" },
  { key: "requests", label: "Requests", color: "#6366f1" },
  { key: "tokens", label: "Tokens", color: "#0ea5e9" },
] as const;

export function AIUsageDashboard() {
  const qc = useQueryClient();
  const usage = useQuery({ queryKey: ak.ai.usage, queryFn: ({ signal }) => api.get<AIUsageOut>("/ai/usage", { signal }), refetchInterval: 60_000 });
  const [metric, setMetric] = React.useState<(typeof METRICS)[number]["key"]>("cost_usd");
  const check = useMutation({
    mutationFn: () => api.post<{ new_alerts: number[] }>("/ai/budget/check"),
    onSuccess: (r) => {
      toast.success(r.new_alerts.length ? `New alert${r.new_alerts.length === 1 ? "" : "s"} at ${r.new_alerts.join("%, ")}%` : "Budget checked — no new alerts");
      qc.invalidateQueries({ queryKey: ak.ai.usage });
    },
    onError: (e) => toastError(e),
  });

  if (usage.isLoading)
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Skeleton className="h-80 rounded-2xl" />
          <Skeleton className="h-80 rounded-2xl lg:col-span-2" />
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Skeleton className="h-72 rounded-2xl" />
          <Skeleton className="h-72 rounded-2xl" />
          <Skeleton className="h-72 rounded-2xl" />
        </div>
      </div>
    );
  if (usage.isError) return <ErrorState error={usage.error} onRetry={() => usage.refetch()} />;
  const u = usage.data!;
  const b = u.budget;
  const tone = budgetTone(b.pct_used);
  const m = METRICS.find((x) => x.key === metric)!;
  const daily = u.daily.map((d) => ({ day: formatDate(d.date, { day: "numeric", month: "short" }), [m.label]: metric === "cost_usd" ? Number(d.cost_usd.toFixed(4)) : metric === "requests" ? d.requests : d.tokens }));
  const errorRate = u.totals.requests ? (u.totals.failures / u.totals.requests) * 100 : 0;

  return (
    <div className="space-y-6">
      {u.offline && (
        <div className="flex flex-col gap-3 rounded-2xl border border-sky-200 bg-gradient-to-r from-sky-50 via-indigo-50 to-violet-50 p-4 sm:flex-row sm:items-center">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-sky-400 to-indigo-500 text-white">
            <Bot className="size-5" aria-hidden />
          </span>
          <p className="text-sm text-slate-700">
            <strong className="font-semibold text-slate-900">Running on the offline demo provider.</strong> AI features work with deterministic, template-based answers at no cost. Choose a
            provider with a server key in Configuration to use a live model.
          </p>
        </div>
      )}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <SectionCard
          title="Monthly budget"
          description={`${formatDate(u.period_start, { month: "long", year: "numeric" })} · ${b.hard_limit ? "Hard limit on" : "Soft limit"}`}
          icon={Gauge}
          color="fuchsia"
          action={
            <Badge tone={b.pct_used === null ? "neutral" : (b.pct_used ?? 0) >= 90 ? "danger" : (b.pct_used ?? 0) >= 50 ? "warning" : "success"} dot>
              {b.budget_usd === null ? "No budget" : tone.label}
            </Badge>
          }
        >
          <BudgetGauge
            pct={b.pct_used}
            thresholds={b.alert_thresholds}
            label={b.pct_used === null ? fmtUsd(b.spent_usd) : `${Math.round(b.pct_used)}%`}
            sub={b.budget_usd === null ? "spent · no budget set" : `${fmtUsd(b.spent_usd)} of ${fmtUsd(b.budget_usd)}`}
          />
          <dl className="mt-4 grid grid-cols-2 gap-2 text-center">
            <div className={cn("rounded-xl p-2.5", tone.bg)}>
              <dt className="text-xs font-medium text-slate-600">Remaining</dt>
              <dd className="font-display text-lg font-bold tabular-nums text-slate-900">{fmtUsd(b.remaining_usd)}</dd>
            </div>
            <div className="rounded-xl bg-slate-50 p-2.5">
              <dt className="text-xs font-medium text-slate-600">Alerts at</dt>
              <dd className="text-sm font-semibold tabular-nums text-slate-900">{b.alert_thresholds.length ? b.alert_thresholds.map((t) => `${t}%`).join(" · ") : "Off"}</dd>
            </div>
          </dl>
          {b.hard_limit && (b.pct_used ?? 0) >= 100 && (
            <p className="mt-3 flex items-start gap-2 rounded-xl bg-rose-50 p-3 text-xs font-medium text-rose-800">
              <ShieldAlert className="size-4 shrink-0" aria-hidden />
              Hard limit reached — AI requests are blocked until next month or a higher budget.
            </p>
          )}
          <Button variant="ghost" size="sm" className="mt-3 w-full" leftIcon={<RefreshCw />} loading={check.isPending} onClick={() => check.mutate()}>
            Run budget check now
          </Button>
        </SectionCard>

        <div className="space-y-6 lg:col-span-2">
          <section aria-label="Usage totals" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <KpiTile label="Spend" value={fmtUsd(u.totals.cost_usd)} icon={<Coins />} color="fuchsia" hint="This month" />
            <KpiTile label="Requests" value={fmtCompact(u.totals.requests)} icon={<Zap />} color="indigo" hint={`${fmtNumber(u.totals.failures)} failed`} />
            <KpiTile label="Tokens" value={fmtCompact(u.totals.tokens_in + u.totals.tokens_out)} icon={<Hash />} color="sky" hint={`${fmtCompact(u.totals.tokens_in)} in · ${fmtCompact(u.totals.tokens_out)} out`} />
            <KpiTile label="Error rate" value={`${errorRate.toFixed(1)}%`} icon={<AlertTriangle />} color={errorRate > 5 ? "rose" : "emerald"} hint="Failed AI calls" />
          </section>
          <SectionCard
            title="Daily usage"
            description="This month, by day"
            icon={Sparkles}
            color="violet"
            action={
              <div className="inline-flex rounded-xl bg-slate-100 p-1" role="group" aria-label="Metric">
                {METRICS.map((x) => (
                  <button
                    key={x.key}
                    type="button"
                    aria-pressed={metric === x.key}
                    onClick={() => setMetric(x.key)}
                    className={cn("rounded-lg px-2.5 py-1 text-xs font-semibold transition-all focus-visible:focus-ring", metric === x.key ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900")}
                  >
                    {x.label}
                  </button>
                ))}
              </div>
            }
          >
            <TrendAreaChart
              data={daily}
              xKey="day"
              series={[{ key: m.label, color: m.color }]}
              height={220}
              valueFormatter={(v) => (metric === "cost_usd" ? fmtUsd(Number(v), { precise: true }) : fmtNumber(Number(v)))}
              aria-label={`Daily AI ${m.label.toLowerCase()} this month`}
            />
          </SectionCard>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <SectionCard title="Spend by feature" icon={Layers} color="indigo">
          <BarList
            data={u.by_feature.map((f) => ({ key: f.key ?? "unknown", label: humanizeFeature(f.key ?? f.label), value: f.cost_usd, display: fmtUsd(f.cost_usd), hint: plural(f.requests, "request") }))}
            empty="No AI usage yet this month"
          />
        </SectionCard>
        <SectionCard title="Spend by model" icon={Cpu} color="sky">
          <BarList
            data={u.by_model.map((x, i) => ({
              key: x.key ?? `m${i}`,
              label: <span className="font-mono text-[13px]">{x.label ?? x.key ?? "unknown"}</span>,
              value: x.cost_usd,
              display: fmtUsd(x.cost_usd),
              hint: `${plural(x.requests, "request")} · ${fmtCompact(x.tokens_in + x.tokens_out)} tokens`,
              color: MODEL_COLORS[i % MODEL_COLORS.length],
            }))}
            empty="No AI usage yet this month"
          />
        </SectionCard>
        <SectionCard title="Spend by course" icon={BookOpen} color="emerald">
          <BarList
            data={u.by_course.slice(0, 8).map((f) => ({ key: f.key ?? "none", label: f.label ?? "Outside a course", value: f.cost_usd, display: fmtUsd(f.cost_usd), hint: plural(f.requests, "request") }))}
            empty="No course-linked usage yet"
          />
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <SectionCard title="Top users" description="Highest AI spend this month" icon={Users} color="amber" className="lg:col-span-3">
          {!u.by_user.length ? (
            <EmptyState size="sm" illustration="inbox" title="No usage yet" description="When people use the AI tutor or generation features they'll appear here." />
          ) : (
            <ol className="divide-y divide-slate-100">
              {u.by_user.slice(0, 8).map((x, i) => {
                const who = splitPerson(x.label);
                return (
                <li key={x.key ?? i} className="flex items-center gap-3 py-2.5">
                  <span className={cn("grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold tabular-nums", i < 3 ? "bg-amber-100 text-amber-800" : "text-slate-500")}>{i + 1}</span>
                  <Avatar name={who.name} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-900">{who.name}</span>
                    {who.email && <span className="block truncate text-xs text-muted-foreground">{who.email}</span>}
                  </span>
                  <span className="hidden text-xs tabular-nums text-muted-foreground sm:block">{fmtNumber(x.requests)} req · {fmtCompact(x.tokens_in + x.tokens_out)} tokens</span>
                  <span className="w-20 text-right text-sm font-semibold tabular-nums text-slate-900">{fmtUsd(x.cost_usd)}</span>
                </li>
                );
              })}
            </ol>
          )}
        </SectionCard>
        <SectionCard title="Budget alerts" description="Raised when spend crosses a threshold" icon={Bell} color="rose" className="lg:col-span-2">
          {!u.alerts.length ? (
            <div className="space-y-4">
              <p className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-3 text-sm font-medium text-emerald-800">
                <ShieldCheck className="size-4 shrink-0" aria-hidden />
                No alerts this period — spend is within thresholds.
              </p>
              {b.budget_usd !== null && b.alert_thresholds.length > 0 && (
                <ul className="space-y-2.5" aria-label="Alert thresholds">
                  {b.alert_thresholds.map((t) => {
                    const tone = budgetTone(t);
                    const at = (b.budget_usd ?? 0) * (t / 100);
                    const progress = at > 0 ? Math.min(100, (b.spent_usd / at) * 100) : 0;
                    return (
                      <li key={t} className="flex items-center gap-3">
                        <span className={cn("w-12 shrink-0 rounded-lg px-1.5 py-1 text-center text-xs font-bold tabular-nums", tone.bg, tone.text)}>{t}%</span>
                        <span className="min-w-0 flex-1">
                          <span className="flex justify-between text-xs text-slate-600">
                            <span>Alert at {fmtUsd(at)}</span>
                            <span className="tabular-nums">{Math.round(progress)}% of the way</span>
                          </span>
                          <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-slate-100">
                            <span className="block h-full rounded-full" style={{ width: `${Math.max(2, progress)}%`, background: tone.stroke }} />
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ) : (
            <ul className="space-y-2">
              {u.alerts.map((a, i) => {
                const t = budgetTone(a.threshold);
                return (
                  <li key={i} className={cn("flex items-center gap-3 rounded-xl p-3", t.bg)}>
                    <span className={cn("font-display text-lg font-bold tabular-nums", t.text)}>{a.threshold}%</span>
                    <span className="min-w-0 flex-1 text-sm text-slate-700">
                      Spend reached {fmtUsd(a.spend_usd)}
                      <span className="block text-xs text-muted-foreground">{formatDateTime(a.created_at)}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
