"use client";

import { KpiTile, Skeleton, cn, colorClasses, humanize, type CategoryColor } from "@praxis/ui";
import { ColorBarChart, DonutChart, TrendAreaChart } from "@praxis/ui/charts";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  Activity,
  Award,
  BookOpen,
  Bot,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  Coins,
  DollarSign,
  Gauge,
  GraduationCap,
  HardDrive,
  MessageSquare,
  MonitorPlay,
  Server,
  TrendingUp,
  UsersRound,
  Zap,
} from "lucide-react";
import * as React from "react";
import { DateRangePicker, daysAgo } from "@/components/admin/date-range";
import { ak } from "@/components/admin/keys";
import type { PlatformAnalytics } from "@/components/admin/types";
import { BarList, SectionCard, fmtBytes, fmtCents, fmtCompact, fmtNumber, fmtUsd, humanizeFeature } from "@/components/admin/ui";
import { ErrorState } from "@/components/common/error-state";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";

const PLAN_HEX: Record<string, string> = { free: "#14b8a6", individual: "#0ea5e9", professional: "#6366f1", business: "#8b5cf6", enterprise: "#d946ef" };

function ActivityTile({ icon: Icon, label, value, color }: { icon: typeof Activity; label: string; value: number; color: CategoryColor }) {
  const c = colorClasses(color);
  return (
    <div className={cn("flex items-center gap-3 rounded-2xl border bg-gradient-to-br p-3.5", c.border, c.tint)}>
      <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-white shadow-sm", c.gradient)}>
        <Icon className="size-5" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="font-display text-xl font-bold tabular-nums text-slate-900">{fmtCompact(value)}</p>
        <p className="truncate text-xs font-medium text-slate-600">{label}</p>
      </div>
    </div>
  );
}

export function PlatformOverview() {
  const [range, setRange] = React.useState({ start: daysAgo(29), end: new Date().toISOString().slice(0, 10) });
  const params = { start: range.start || undefined, end: range.end || undefined };
  const q = useQuery({
    queryKey: ak.analytics.platform(params),
    queryFn: ({ signal }) => api.get<PlatformAnalytics>("/analytics/platform", { signal, query: params }),
    placeholderData: keepPreviousData,
  });

  if (q.isLoading)
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-2xl" />
          ))}
        </div>
        <div className="grid gap-6 xl:grid-cols-3">
          <Skeleton className="h-80 rounded-2xl xl:col-span-2" />
          <Skeleton className="h-80 rounded-2xl" />
        </div>
      </div>
    );
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} size="lg" />;
  const d = q.data!;
  const revenueByMonth = Object.values(
    d.revenue.by_month.reduce<Record<string, { month: string; Revenue: number }>>((acc, r) => {
      const label = formatDate(`${r.month}-01`, { month: "short", year: "2-digit" });
      acc[r.month] = { month: label, Revenue: (acc[r.month]?.Revenue ?? 0) + r.amount_cents / 100 };
      return acc;
    }, {}),
  );
  const signups = d.users.signups_by_day.map((r) => ({ day: formatDate(r.date, { day: "numeric", month: "short" }), Signups: r.signups }));
  const statusTotal = Object.values(d.api.status_counts).reduce((a, b) => a + b, 0);

  return (
    <div className={cn("space-y-6 transition-opacity", q.isFetching && "opacity-70")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {d.range.start ? `${formatDate(d.range.start)} – ${formatDate(d.range.end)}` : "All time"} · range applies to signups, revenue, activity and AI cost
        </p>
        <DateRangePicker value={range} onChange={setRange} />
      </div>

      <section aria-label="Platform totals" className="stagger grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <KpiTile label="Organisations" value={fmtNumber(d.organisations.total)} icon={<Building2 />} color="indigo" hint={`${d.organisations.active} active · ${d.organisations.suspended} suspended`} />
        <KpiTile label="Users" value={fmtCompact(d.users.total)} icon={<UsersRound />} color="sky" hint={`${fmtNumber(d.users.active_30d)} active in 30d`} delta={d.users.new_in_range ? { value: `+${fmtNumber(d.users.new_in_range)}`, direction: "up" } : undefined} />
        <KpiTile label="MRR (est.)" value={fmtCents(d.revenue.mrr_cents_estimate)} icon={<TrendingUp />} color="emerald" hint="Active & past-due subscriptions" />
        <KpiTile label="Revenue in range" value={fmtCents(d.revenue.paid_in_range_cents)} icon={<DollarSign />} color="teal" hint={`${fmtCents(d.revenue.total_paid_cents)} all time`} />
        <KpiTile label="Courses" value={fmtNumber(d.courses.total)} icon={<GraduationCap />} color="violet" hint={`${fmtNumber(d.courses.published)} published · ${fmtNumber(d.courses.ai_generated)} AI-built`} />
        <KpiTile label="AI cost" value={fmtUsd(d.ai_usage.cost_usd)} icon={<Bot />} color="fuchsia" hint={`${fmtCompact(d.ai_usage.requests)} requests · ${fmtNumber(d.ai_usage.errors)} errors`} />
      </section>

      <div className="grid gap-6 xl:grid-cols-3">
        <SectionCard title="Signups" description="New user accounts per day" icon={UsersRound} color="sky" className="xl:col-span-2">
          <TrendAreaChart data={signups} xKey="day" series={[{ key: "Signups", color: "#0ea5e9" }]} height={260} aria-label="User signups per day" />
        </SectionCard>
        <SectionCard title="Organisations by plan" icon={Building2} color="indigo">
          <DonutChart
            data={d.organisations.by_plan.map((p) => ({ name: humanize(p.plan_code), value: p.count, color: PLAN_HEX[p.plan_code] }))}
            centerLabel={fmtNumber(d.organisations.total)}
            centerSub="organisations"
            height={190}
            aria-label="Organisations by plan"
          />
          {d.organisations.by_kind.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5 border-t border-slate-100 pt-3">
              {d.organisations.by_kind.map((k) => (
                <span key={k.kind} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                  {humanize(k.kind)} · {k.count}
                </span>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <SectionCard title="Revenue by month" description="Paid invoices, last 12 months" icon={Coins} color="emerald" className="xl:col-span-2">
          {revenueByMonth.length ? (
            <ColorBarChart data={revenueByMonth} xKey="month" series={[{ key: "Revenue", color: "#10b981" }]} height={240} valueFormatter={(v) => fmtCents(Number(v) * 100)} aria-label="Revenue by month" />
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">No paid invoices yet.</p>
          )}
        </SectionCard>
        <SectionCard title="Subscriptions" description={`${fmtNumber(d.revenue.outstanding_invoices)} outstanding invoices`} icon={CheckCircle2} color="teal">
          <BarList
            data={Object.entries(d.revenue.subscriptions_by_status).map(([k, v]) => ({
              key: k,
              label: humanize(k),
              value: v,
              color: (k === "active" ? "emerald" : k === "trialing" ? "sky" : k === "past_due" ? "amber" : k === "canceled" ? "rose" : "violet") as CategoryColor,
            }))}
            empty="No subscriptions yet"
          />
        </SectionCard>
      </div>

      <SectionCard title="Learning activity" description="Across every organisation in the selected range" icon={Activity} color="violet">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
          <ActivityTile icon={BookOpen} label="Enrolments" value={d.activity.enrolments} color="indigo" />
          <ActivityTile icon={CheckCircle2} label="Completions" value={d.activity.completions} color="emerald" />
          <ActivityTile icon={ClipboardCheck} label="Assessment attempts" value={d.activity.attempts} color="amber" />
          <ActivityTile icon={GraduationCap} label="Submissions" value={d.activity.submissions} color="orange" />
          <ActivityTile icon={MonitorPlay} label="Simulation sessions" value={d.activity.simulation_sessions} color="violet" />
          <ActivityTile icon={Award} label="Certificates" value={d.activity.certificates} color="rose" />
          <ActivityTile icon={MessageSquare} label="Tutor messages" value={d.activity.tutor_messages} color="fuchsia" />
        </div>
      </SectionCard>

      <div className="grid gap-6 xl:grid-cols-3">
        <SectionCard title="AI cost by organisation" icon={Building2} color="fuchsia">
          <BarList data={d.ai_usage.by_organisation.slice(0, 8).map((o) => ({ key: o.organisation_id, label: o.name, value: o.cost_usd, display: fmtUsd(o.cost_usd), hint: `${fmtNumber(o.requests)} requests` }))} empty="No AI usage in range" />
        </SectionCard>
        <SectionCard title="AI cost by feature" icon={Zap} color="violet">
          {d.ai_usage.by_feature.length ? (
            <DonutChart data={d.ai_usage.by_feature.map((f) => ({ name: humanizeFeature(f.feature), value: Number(f.cost_usd.toFixed(4)) }))} valueFormatter={(v) => fmtUsd(Number(v), { precise: true })} height={180} aria-label="AI cost by feature" />
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">No AI usage in range</p>
          )}
        </SectionCard>
        <SectionCard title="AI cost by model" icon={Bot} color="sky">
          {d.ai_usage.by_model.length ? (
            <ul className="divide-y divide-slate-100">
              {d.ai_usage.by_model.map((m) => (
                <li key={`${m.provider}-${m.model}`} className="flex items-center gap-3 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-xs font-semibold text-slate-900">{m.model}</p>
                    <p className="text-xs text-muted-foreground">
                      {humanize(m.provider)} · {fmtCompact(m.tokens)} tokens
                    </p>
                  </div>
                  <span className="text-xs tabular-nums text-slate-500">{fmtNumber(m.requests)} req</span>
                  <span className="w-20 text-right font-semibold tabular-nums text-slate-900">{fmtUsd(m.cost_usd)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">No AI usage in range</p>
          )}
        </SectionCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <SectionCard title="Storage" description={`${fmtBytes(d.storage.total_bytes)} across ${fmtNumber(d.storage.files)} files`} icon={HardDrive} color="amber">
          <BarList data={d.storage.by_organisation.map((o) => ({ key: o.organisation_id, label: o.name, value: o.bytes, display: fmtBytes(o.bytes), hint: `${fmtNumber(o.files)} files` }))} empty="No files stored" />
          {d.storage.by_purpose.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5 border-t border-slate-100 pt-3">
              {d.storage.by_purpose.map((p) => (
                <span key={p.purpose} className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-900 ring-1 ring-inset ring-amber-200">
                  {humanize(p.purpose)} · {fmtBytes(p.bytes)}
                </span>
              ))}
            </div>
          )}
        </SectionCard>
        <SectionCard title="API usage" description={`${fmtCompact(d.api.requests_total)} requests since the API process started`} icon={Server} color="indigo" className="xl:col-span-2">
          <div className="grid gap-5 md:grid-cols-2">
            <div className="grid grid-cols-3 gap-2">
              {(["p50", "p95", "p99"] as const).map((k, i) => (
                <div key={k} className={cn("rounded-xl p-3 text-center", ["bg-emerald-50", "bg-amber-50", "bg-rose-50"][i])}>
                  <p className="text-xs font-semibold uppercase text-slate-600">{k}</p>
                  <p className="font-display text-xl font-bold tabular-nums text-slate-900">{fmtNumber(d.api.latency_ms[k], 1)}</p>
                  <p className="text-2xs text-slate-500">ms</p>
                </div>
              ))}
              <div className="col-span-3 space-y-1.5 pt-2">
                {Object.entries(d.api.status_counts)
                  .sort()
                  .map(([k, v]) => (
                    <div key={k} className="flex items-center gap-2 text-xs">
                      <span className="w-10 font-mono font-semibold text-slate-700">{k}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <div className={cn("h-full rounded-full", k.startsWith("2") ? "bg-emerald-500" : k.startsWith("3") ? "bg-sky-500" : k.startsWith("4") ? "bg-amber-500" : "bg-rose-500")} style={{ width: `${statusTotal ? (v / statusTotal) * 100 : 0}%` }} />
                      </div>
                      <span className="w-14 text-right tabular-nums text-slate-600">{fmtCompact(v)}</span>
                    </div>
                  ))}
              </div>
            </div>
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <Gauge className="size-3.5" aria-hidden /> Slowest routes (p95)
              </p>
              <BarList data={d.api.slowest_routes_p95.slice(0, 6).map((r) => ({ key: r.route, label: <span className="font-mono text-xs">{r.route}</span>, value: r.p95_ms, display: `${fmtNumber(r.p95_ms, 0)} ms` }))} empty="No traffic recorded yet" />
            </div>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
