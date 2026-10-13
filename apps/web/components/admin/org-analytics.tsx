"use client";

import {
  Avatar,
  Badge,
  DataTable,
  EmptyState,
  KpiTile,
  Progress,
  ProgressRing,
  cn,
  colorClasses,
  type CategoryColor,
  type ColumnDef,
} from "@praxis/ui";
import { ColorBarChart, Sparkline, TrendAreaChart } from "@praxis/ui/charts";
import {
  Activity,
  AlarmClock,
  Award,
  BookOpen,
  CheckCircle2,
  Clock,
  Crown,
  Gauge,
  Medal,
  ShieldCheck,
  Target,
  TrendingUp,
  Trophy,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { formatDate } from "@/lib/format";
import type { ComplianceByCourse, EmployeePerformance, OrgAnalytics, SkillGap } from "./types";
import { SectionCard, StackedBar, fmtDuration, fmtNumber, fmtPct } from "./ui";

/* ------------------------------------------------------------------ KPIs */

export function AnalyticsKpis({ data }: { data: OrgAnalytics }) {
  const s = data.summary;
  return (
    <section aria-label="Key metrics" className="stagger grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4 xl:grid-cols-8">
      <KpiTile label="Members" value={fmtNumber(s.members)} icon={<UsersRound />} color="sky" className="xl:col-span-2" hint={`${fmtNumber(s.active_learners_30d)} active in 30 days`} />
      <KpiTile label="Enrolments" value={fmtNumber(s.enrolments)} icon={<BookOpen />} color="indigo" className="xl:col-span-2" hint={`${fmtNumber(s.in_progress)} in progress`} />
      <KpiTile label="Completion rate" value={fmtPct(s.completion_rate)} icon={<CheckCircle2 />} color="emerald" className="xl:col-span-2" hint={`${fmtNumber(s.completed)} completed`} />
      <KpiTile label="Avg. final score" value={s.avg_final_score === null ? "—" : `${Math.round(s.avg_final_score)}%`} icon={<Target />} color="violet" className="xl:col-span-2" hint="Across completed courses" />
      <KpiTile label="Hours learned" value={fmtNumber(s.hours_learned, 1)} icon={<Clock />} color="fuchsia" className="xl:col-span-2" hint="Time in courses" />
      <KpiTile label="Certificates" value={fmtNumber(s.certificates_issued)} icon={<Award />} color="amber" className="xl:col-span-2" hint="Issued in range" />
      <KpiTile label="Overdue" value={fmtNumber(s.overdue)} icon={<AlarmClock />} color="rose" className="xl:col-span-2" hint="Past due, not completed" />
      <KpiTile
        label="Compliance"
        value={fmtPct(data.compliance.compliance_rate)}
        icon={<ShieldCheck />}
        color="teal"
        className="xl:col-span-2"
        hint="Assigned & completed on time"
      />
    </section>
  );
}

/* ------------------------------------------------------------------ compliance */

function complianceColor(rate: number | null): CategoryColor {
  if (rate === null) return "indigo";
  if (rate >= 90) return "emerald";
  if (rate >= 75) return "teal";
  if (rate >= 50) return "amber";
  return "rose";
}

function CourseCompliance({ row }: { row: ComplianceByCourse }) {
  return (
    <li className="py-3">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <p className="min-w-0 truncate text-sm font-medium text-slate-900">{row.title}</p>
        <span className={cn("shrink-0 text-sm font-semibold tabular-nums", colorClasses(complianceColor(row.compliance_rate)).text)}>{fmtPct(row.compliance_rate)}</span>
      </div>
      <StackedBar
        height="h-2"
        showLegend={false}
        segments={[
          { key: "ot", label: "On time", value: row.completed_on_time, color: "emerald" },
          { key: "late", label: "Late", value: row.completed_late, color: "amber" },
          { key: "od", label: "Overdue", value: row.overdue, color: "rose" },
          { key: "p", label: "Pending", value: row.pending, color: "sky" },
        ]}
      />
    </li>
  );
}

export function ComplianceCard({ data }: { data: OrgAnalytics }) {
  const c = data.compliance;
  const color = complianceColor(c.compliance_rate);
  return (
    <SectionCard title="Compliance" description="Assigned training with a due date: completed on time vs overdue." icon={ShieldCheck} color="teal" className="h-full">
      {!c.assigned ? (
        <EmptyState size="sm" illustration="shield" title="No assigned training with due dates" description="Assign courses with a due date to track compliance." />
      ) : (
        <div className="space-y-5">
          <div className="flex flex-col items-center gap-5 sm:flex-row">
            <ProgressRing value={c.compliance_rate ?? 0} size={128} stroke={12} color={color} aria-label="Compliance rate" sublabel="on time" />
            <dl className="grid w-full flex-1 grid-cols-2 gap-2">
              {[
                { k: "On time", v: c.completed_on_time, cls: "bg-emerald-50 text-emerald-800" },
                { k: "Late", v: c.completed_late, cls: "bg-amber-50 text-amber-800" },
                { k: "Overdue", v: c.overdue, cls: "bg-rose-50 text-rose-800" },
                { k: "Pending", v: c.pending, cls: "bg-sky-50 text-sky-800" },
              ].map((x) => (
                <div key={x.k} className={cn("rounded-xl px-3 py-2", x.cls)}>
                  <dt className="text-xs font-medium">{x.k}</dt>
                  <dd className="font-display text-xl font-bold tabular-nums text-slate-900">{fmtNumber(x.v)}</dd>
                </div>
              ))}
            </dl>
          </div>
          <StackedBar
            segments={[
              { key: "ot", label: "On time", value: c.completed_on_time, color: "emerald" },
              { key: "late", label: "Late", value: c.completed_late, color: "amber" },
              { key: "od", label: "Overdue", value: c.overdue, color: "rose" },
              { key: "p", label: "Pending", value: c.pending, color: "sky" },
            ]}
          />
          {c.by_course.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">By course</p>
              <ul className="divide-y divide-slate-100">
                {c.by_course.slice(0, 6).map((r) => (
                  <CourseCompliance key={r.course_id} row={r} />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ trend + departments */

export function ActiveLearnersCard({ data }: { data: OrgAnalytics }) {
  const rows = data.active_learners_trend.map((r) => ({ day: formatDate(r.date, { day: "numeric", month: "short" }), "Active learners": r.active_learners, Hours: Math.round((r.seconds / 3600) * 10) / 10 }));
  const peak = Math.max(0, ...data.active_learners_trend.map((r) => r.active_learners));
  const avg = data.active_learners_trend.length ? data.active_learners_trend.reduce((a, r) => a + r.active_learners, 0) / data.active_learners_trend.length : 0;
  const totalHours = data.active_learners_trend.reduce((a, r) => a + r.seconds, 0) / 3600;
  const busiest = data.active_learners_trend.reduce<(typeof data.active_learners_trend)[number] | null>((b, r) => (r.active_learners > (b?.active_learners ?? 0) ? r : b), null);
  const reach = data.summary.members ? (data.summary.active_learners_30d / data.summary.members) * 100 : null;
  return (
    <SectionCard
      title="Active learners"
      description="Distinct learners with activity each day (last 30 days)"
      icon={Activity}
      color="indigo"
      className="h-full"
      action={
        <div className="flex gap-2">
          <Badge tone="brand" size="sm">
            Peak {peak}
          </Badge>
          <Badge tone="info" size="sm">
            Avg {avg.toFixed(1)}
          </Badge>
        </div>
      }
    >
      <TrendAreaChart
        data={rows}
        xKey="day"
        series={[{ key: "Active learners", color: "#6366f1" }]}
        height={240}
        aria-label={`Active learners per day, peak ${peak}, average ${avg.toFixed(1)}`}
      />
      <dl className="mt-5 grid grid-cols-1 gap-3 border-t border-slate-100 pt-5 sm:grid-cols-3">
        <div className="rounded-2xl bg-gradient-to-br from-fuchsia-50 to-white p-3 ring-1 ring-inset ring-fuchsia-100">
          <dt className="text-xs font-medium text-fuchsia-800">Hours learned · 30 days</dt>
          <dd className="font-display text-xl font-bold tabular-nums text-slate-900">{fmtNumber(totalHours, 1)}</dd>
          <Sparkline data={rows.map((r) => r.Hours)} color="#d946ef" height={28} className="mt-1" />
        </div>
        <div className="rounded-2xl bg-gradient-to-br from-sky-50 to-white p-3 ring-1 ring-inset ring-sky-100">
          <dt className="text-xs font-medium text-sky-800">Busiest day</dt>
          <dd className="font-display text-xl font-bold tabular-nums text-slate-900">{busiest ? formatDate(busiest.date, { weekday: "short", day: "numeric", month: "short" }) : "—"}</dd>
          <p className="text-xs text-muted-foreground">{busiest ? `${busiest.active_learners} learners active` : "No activity yet"}</p>
        </div>
        <div className="rounded-2xl bg-gradient-to-br from-emerald-50 to-white p-3 ring-1 ring-inset ring-emerald-100">
          <dt className="text-xs font-medium text-emerald-800">Reach · 30 days</dt>
          <dd className="font-display text-xl font-bold tabular-nums text-slate-900">{reach === null ? "—" : `${Math.round(reach)}%`}</dd>
          <p className="text-xs text-muted-foreground">
            {fmtNumber(data.summary.active_learners_30d)} of {fmtNumber(data.summary.members)} members learned
          </p>
        </div>
      </dl>
    </SectionCard>
  );
}

export function DepartmentsCard({ data }: { data: OrgAnalytics }) {
  const rows = data.departments.map((d) => ({
    department: d.department,
    "Completion %": d.completion_rate ?? 0,
    "Avg score %": d.avg_final_score ?? 0,
  }));
  return (
    <SectionCard title="Department performance" description="Completion rate and average final score by department" icon={TrendingUp} color="emerald" className="h-full">
      {!rows.length ? (
        <EmptyState size="sm" illustration="chart" title="No departments yet" description="Assign members to departments to compare them." />
      ) : (
        <div className="space-y-4">
          <ColorBarChart
            data={rows}
            xKey="department"
            series={[
              { key: "Completion %", color: "#10b981" },
              { key: "Avg score %", color: "#8b5cf6" },
            ]}
            height={Math.max(220, rows.length * 56)}
            layout="horizontal"
            showLegend
            valueFormatter={(v) => `${v}%`}
            aria-label="Department completion rate and average score"
          />
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <caption className="sr-only">Department breakdown</caption>
              <thead className="text-xs uppercase tracking-wider text-slate-500">
                <tr className="border-b border-slate-100">
                  <th scope="col" className="py-2 text-left font-semibold">Department</th>
                  <th scope="col" className="py-2 text-right font-semibold">Members</th>
                  <th scope="col" className="py-2 text-right font-semibold">Enrolments</th>
                  <th scope="col" className="py-2 text-right font-semibold">Completed</th>
                  <th scope="col" className="py-2 text-right font-semibold">Overdue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {data.departments.map((d) => (
                  <tr key={d.department_id ?? "none"}>
                    <th scope="row" className="py-2 text-left font-medium text-slate-800">{d.department}</th>
                    <td className="py-2 text-right tabular-nums">{d.members}</td>
                    <td className="py-2 text-right tabular-nums">{d.enrolments}</td>
                    <td className="py-2 text-right tabular-nums text-emerald-700">{d.completed}</td>
                    <td className={cn("py-2 text-right tabular-nums", d.overdue ? "font-semibold text-rose-700" : "text-slate-500")}>{d.overdue}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ skill gaps heatmap */

function heat(gap: number | null) {
  const g = gap ?? 0;
  if (g <= 0) return "bg-emerald-100 text-emerald-900";
  if (g <= 5) return "bg-teal-100 text-teal-900";
  if (g <= 15) return "bg-amber-100 text-amber-900";
  if (g <= 30) return "bg-orange-100 text-orange-900";
  return "bg-rose-100 text-rose-900";
}

/** Share of all learners meeting the level — the coverage heat scale. */
function coverageHeat(rate: number | null) {
  const r = rate ?? 0;
  if (r >= 80) return "bg-emerald-100 text-emerald-900";
  if (r >= 60) return "bg-teal-100 text-teal-900";
  if (r >= 40) return "bg-amber-100 text-amber-900";
  if (r >= 20) return "bg-orange-100 text-orange-900";
  return "bg-rose-100 text-rose-900";
}

export function SkillGapsCard({ gaps }: { gaps: SkillGap[] }) {
  return (
    <SectionCard title="Skill gaps" description="Competency requirements vs average learner proficiency — biggest gaps first." icon={Gauge} color="rose">
      {!gaps.length ? (
        <EmptyState size="sm" illustration="chart" title="No competency requirements yet" description="Define competencies with minimum skill levels to see where your people need support." />
      ) : (
        <div className="space-y-3">
          <div className="relative overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[640px] border-separate border-spacing-y-1 text-sm">
              <caption className="sr-only">Skill gaps by competency and skill</caption>
              <thead className="text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th scope="col" className="px-3 py-1 text-left font-semibold">Competency · skill</th>
                  <th scope="col" className="px-3 py-1 text-center font-semibold">Required</th>
                  <th scope="col" className="px-3 py-1 text-center font-semibold">Avg level</th>
                  <th scope="col" className="px-3 py-1 text-center font-semibold">Gap</th>
                  <th scope="col" className="px-3 py-1 text-center font-semibold">Assessed</th>
                  <th scope="col" className="px-3 py-1 text-center font-semibold">Meeting level</th>
                  <th scope="col" className="px-3 py-1 text-center font-semibold">Below</th>
                </tr>
              </thead>
              <tbody>
                {[...gaps]
                  .sort((a, b) => (b.gap ?? 0) - (a.gap ?? 0) || (a.coverage_rate ?? 0) - (b.coverage_rate ?? 0))
                  .slice(0, 15)
                  .map((g) => (
                  <tr key={`${g.competency_id}-${g.skill_id}`}>
                    <th scope="row" className="rounded-l-xl bg-slate-50 px-3 py-2 text-left font-normal">
                      <span className="block font-medium text-slate-900">{g.skill ?? "Unknown skill"}</span>
                      <span className="block text-xs text-muted-foreground">{g.competency}</span>
                    </th>
                    <td className="bg-slate-50 px-3 py-2 text-center tabular-nums text-slate-700">{Math.round(g.min_level)}</td>
                    <td className="bg-slate-50 px-3 py-2">
                      <div className="mx-auto w-24">
                        <Progress value={g.avg_proficiency ?? 0} size="sm" color={(g.avg_proficiency ?? 0) >= g.min_level ? "emerald" : "amber"} aria-label={`Average proficiency ${g.avg_proficiency ?? 0}`} />
                        <p className="mt-0.5 text-center text-xs tabular-nums text-slate-600">{fmtNumber(g.avg_proficiency, 1)}</p>
                      </div>
                    </td>
                    <td className={cn("px-3 py-2 text-center font-semibold tabular-nums", heat(g.gap))}>{g.gap ? `−${fmtNumber(g.gap, 1)}` : "None"}</td>
                    <td className="bg-slate-50 px-3 py-2 text-center tabular-nums text-slate-700">
                      {g.assessed} / {g.learners}
                    </td>
                    <td className={cn("px-3 py-2 text-center font-semibold tabular-nums", coverageHeat(g.coverage_rate))}>{fmtPct(g.coverage_rate)}</td>
                    <td className="rounded-r-xl bg-slate-50 px-3 py-2 text-center tabular-nums text-slate-700">
                      {g.below} / {g.learners}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            Gap compares the average level of assessed learners with the requirement; <em>Meeting level</em> is the share of all learners at or above it.
          </p>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600" aria-label="Heat legend">
            <li className="flex items-center gap-1.5"><span className="size-3 rounded bg-emerald-100 ring-1 ring-emerald-200" aria-hidden />On target · ≥ 80%</li>
            <li className="flex items-center gap-1.5"><span className="size-3 rounded bg-teal-100 ring-1 ring-teal-200" aria-hidden />≤ 5 pts · ≥ 60%</li>
            <li className="flex items-center gap-1.5"><span className="size-3 rounded bg-amber-100 ring-1 ring-amber-200" aria-hidden />≤ 15 pts · ≥ 40%</li>
            <li className="flex items-center gap-1.5"><span className="size-3 rounded bg-orange-100 ring-1 ring-orange-200" aria-hidden />≤ 30 pts · ≥ 20%</li>
            <li className="flex items-center gap-1.5"><span className="size-3 rounded bg-rose-100 ring-1 ring-rose-200" aria-hidden />&gt; 30 pts · &lt; 20%</li>
          </ul>
        </div>
      )}
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ people */

const MEDALS = [
  { ring: "from-amber-300 to-yellow-500", text: "text-amber-800", bg: "bg-amber-50", label: "1st" },
  { ring: "from-slate-300 to-slate-400", text: "text-slate-700", bg: "bg-slate-50", label: "2nd" },
  { ring: "from-orange-300 to-orange-500", text: "text-orange-800", bg: "bg-orange-50", label: "3rd" },
];

export function TopPerformersCard({ people }: { people: EmployeePerformance[] }) {
  return (
    <SectionCard title="Top performers" description="Most courses completed, then highest scores" icon={Trophy} color="amber" className="h-full">
      {!people.length ? (
        <EmptyState size="sm" illustration="trophy" title="No completions yet" description="Top performers appear once people complete courses." />
      ) : (
        <ol className="space-y-2.5">
          {people.map((p, i) => {
            const m = MEDALS[i];
            return (
              <li key={p.user_id} className={cn("flex items-center gap-3 rounded-2xl p-2.5", m ? m.bg : "bg-white")}>
                <span className={cn("grid size-8 shrink-0 place-items-center rounded-full bg-gradient-to-br text-xs font-bold text-white shadow-sm", m ? m.ring : "from-indigo-400 to-violet-500")}>
                  {i === 0 ? <Crown className="size-4" aria-label="1st" /> : i < 3 ? <Medal className="size-4" aria-label={m?.label} /> : i + 1}
                </span>
                <Avatar name={p.full_name} size="sm" />
                <Link href={`/app/admin/users/${p.user_id}`} className="min-w-0 flex-1 rounded focus-visible:focus-ring">
                  <span className="block truncate text-sm font-semibold text-slate-900 hover:text-brand-700">{p.full_name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{p.department ?? p.job_title ?? p.email}</span>
                </Link>
                <div className="text-right">
                  <p className="text-sm font-semibold tabular-nums text-slate-900">{p.completed} done</p>
                  <p className="text-xs tabular-nums text-muted-foreground">{p.avg_final_score === null ? "—" : `${Math.round(p.avg_final_score)}% avg`}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </SectionCard>
  );
}

function ScoreCell({ v }: { v: number | null }) {
  if (v === null || v === undefined) return <span className="text-slate-400">—</span>;
  const tone = v >= 85 ? "text-emerald-700" : v >= 70 ? "text-sky-700" : v >= 50 ? "text-amber-800" : "text-rose-700";
  return <span className={cn("font-semibold tabular-nums", tone)}>{Math.round(v)}%</span>;
}

export function EmployeeTable({ people }: { people: EmployeePerformance[] }) {
  const columns = React.useMemo<ColumnDef<EmployeePerformance, unknown>[]>(
    () => [
      {
        accessorKey: "full_name",
        header: "Employee",
        meta: { label: "Employee" },
        cell: ({ row }) => (
          <Link href={`/app/admin/users/${row.original.user_id}`} className="flex min-w-[13rem] items-center gap-3 rounded focus-visible:focus-ring">
            <Avatar name={row.original.full_name} size="sm" />
            <span className="min-w-0">
              <span className="block truncate font-semibold text-slate-900 hover:text-brand-700">{row.original.full_name}</span>
              <span className="block truncate text-xs text-muted-foreground">{row.original.job_title ?? row.original.email}</span>
            </span>
          </Link>
        ),
      },
      { accessorKey: "department", header: "Department", meta: { label: "Department" }, cell: ({ row }) => <span className="text-slate-700">{row.original.department ?? "—"}</span> },
      {
        accessorKey: "completion_rate",
        header: "Completion",
        meta: { label: "Completion" },
        sortingFn: (a, b) => (a.original.completion_rate ?? -1) - (b.original.completion_rate ?? -1),
        cell: ({ row }) => (
          <div className="w-32">
            <div className="mb-1 flex justify-between text-xs">
              <span className="tabular-nums text-slate-600">
                {row.original.completed}/{row.original.enrolments}
              </span>
              <span className="font-semibold tabular-nums text-slate-900">{fmtPct(row.original.completion_rate)}</span>
            </div>
            <Progress value={row.original.completion_rate ?? 0} size="xs" color="emerald" aria-label="Completion rate" />
          </div>
        ),
      },
      {
        accessorKey: "overdue",
        header: "Overdue",
        meta: { label: "Overdue" },
        cell: ({ row }) =>
          row.original.overdue ? (
            <Badge tone="danger" size="sm">
              {row.original.overdue}
            </Badge>
          ) : (
            <span className="text-slate-400">0</span>
          ),
      },
      { accessorKey: "avg_final_score", header: "Course score", meta: { label: "Course score" }, sortingFn: (a, b) => (a.original.avg_final_score ?? -1) - (b.original.avg_final_score ?? -1), cell: ({ row }) => <ScoreCell v={row.original.avg_final_score} /> },
      { accessorKey: "avg_assessment_pct", header: "Assessments", meta: { label: "Assessments" }, sortingFn: (a, b) => (a.original.avg_assessment_pct ?? -1) - (b.original.avg_assessment_pct ?? -1), cell: ({ row }) => <ScoreCell v={row.original.avg_assessment_pct} /> },
      { accessorKey: "avg_simulation_score", header: "Simulations", meta: { label: "Simulations" }, sortingFn: (a, b) => (a.original.avg_simulation_score ?? -1) - (b.original.avg_simulation_score ?? -1), cell: ({ row }) => <ScoreCell v={row.original.avg_simulation_score} /> },
      { accessorKey: "time_spent_seconds", header: "Time", meta: { label: "Time" }, cell: ({ row }) => <span className="whitespace-nowrap tabular-nums text-slate-700">{fmtDuration(row.original.time_spent_seconds)}</span> },
    ],
    [],
  );
  return (
    <DataTable
      aria-label="Employee performance"
      columns={columns}
      data={people}
      getRowId={(r) => r.user_id}
      pageSize={10}
      empty={{ title: "No employee data", description: "Performance appears as people enrol and complete training." }}
      toolbar={
        <div>
          <h2 className="font-display text-base font-semibold text-slate-900">Employee performance</h2>
          <p className="text-xs text-muted-foreground">Top 50 by completions in the selected range. Sort any column.</p>
        </div>
      }
    />
  );
}
