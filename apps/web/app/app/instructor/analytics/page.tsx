"use client";

import { Badge, Button, DataTable, FilterBar, KpiTile, PageHeader, Progress, Skeleton, StatusPill, Tabs, TabsList, TabsTrigger, cn, type ColumnDef } from "@praxis/ui";
import { ColorBarChart, DonutChart } from "@praxis/ui/charts";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, BookOpen, CheckCircle2, GraduationCap, Inbox, PieChart, TrendingUp, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Suspense } from "react";
import { ErrorState, isNotDeployed } from "@/components/common/error-state";
import { DateRangeControl, ExportMenu, ak } from "@/components/analytics/course-analytics";
import { ChartCard, ChartDataTable, KpiSkeletonRow, num, pct, scaleClasses } from "@/components/analytics/kit";
import { useUrlState } from "@/components/grading/use-url-state";
import { api } from "@/lib/api";
import { Can, useAuth } from "@/lib/auth";

interface CourseRow {
  course_id: string;
  title: string;
  status: string;
  enrolments: number;
  completed: number;
  overdue: number;
  avg_final_score: number | null;
  avg_progress: number | null;
  completion_rate: number | null;
}

interface InstructorDashboard {
  stats: { courses_total: number; courses_published: number; total_enrolments: number; total_learners: number; average_completion_rate: number | null; pending_reviews: number };
  pending_reviews: number;
}

const KEYS = ["start", "end", "scope", "q"] as const;

function Overview() {
  const router = useRouter();
  const [state, set] = useUrlState(KEYS);
  const { canAny } = useAuth();
  const scope = state.scope === "all" ? "all" : "mine";
  const range = { start: state.start, end: state.end };

  const courses = useQuery({
    queryKey: ak.courses(range),
    queryFn: ({ signal }) => api.get<{ items: CourseRow[] }>("/analytics/courses", { signal, query: range }),
  });
  const dash = useQuery({
    queryKey: ak.dashboard(scope),
    queryFn: ({ signal }) => api.get<InstructorDashboard>("/dashboard/instructor", { signal, query: { scope } }),
    enabled: canAny(["courses.edit", "submissions.review"]),
  });

  const items = React.useMemo(() => courses.data?.items ?? [], [courses.data]);
  const filtered = items.filter((c) => !state.q || c.title.toLowerCase().includes(state.q.toLowerCase()));
  const top = [...items].filter((c) => c.enrolments > 0).sort((a, b) => b.enrolments - a.enrolments).slice(0, 8);
  const totals = items.reduce(
    (a, c) => ({ enrol: a.enrol + c.enrolments, done: a.done + c.completed, overdue: a.overdue + c.overdue }),
    { enrol: 0, done: 0, overdue: 0 },
  );
  const inProgress = Math.max(0, totals.enrol - totals.done - totals.overdue);
  const s = dash.data?.stats;

  const columns = React.useMemo<ColumnDef<CourseRow, unknown>[]>(
    () => [
      {
        accessorKey: "title",
        header: "Course",
        cell: ({ row }) => (
          <Link href={`/app/instructor/analytics/${row.original.course_id}${state.start || state.end ? `?start=${state.start ?? ""}&end=${state.end ?? ""}` : ""}`} className="font-semibold text-slate-900 hover:text-brand-700 focus-visible:focus-ring" onClick={(e) => e.stopPropagation()}>
            {row.original.title}
          </Link>
        ),
      },
      { accessorKey: "status", header: "Status", cell: ({ row }) => <StatusPill status={row.original.status} size="sm" /> },
      { accessorKey: "enrolments", header: "Enrolled", meta: { cellClassName: "tabular-nums" } },
      {
        accessorKey: "completion_rate",
        header: "Completion",
        cell: ({ row }) => (
          <div className="flex min-w-36 items-center gap-2">
            <Progress value={row.original.completion_rate ?? 0} size="sm" color="emerald" className="flex-1" aria-label={`Completion ${pct(row.original.completion_rate)}`} />
            <span className="w-11 text-right text-xs font-semibold tabular-nums">{pct(row.original.completion_rate)}</span>
          </div>
        ),
      },
      { accessorKey: "avg_progress", header: "Avg progress", cell: ({ row }) => <span className="tabular-nums">{pct(row.original.avg_progress)}</span> },
      {
        accessorKey: "avg_final_score",
        header: "Avg score",
        cell: ({ row }) => <span className={cn("rounded-md px-2 py-0.5 text-xs font-bold tabular-nums", scaleClasses(row.original.avg_final_score, [50, 70, 85]))}>{num(row.original.avg_final_score)}</span>,
      },
      {
        accessorKey: "overdue",
        header: "Overdue",
        cell: ({ row }) => (row.original.overdue ? <Badge tone="danger" size="sm">{row.original.overdue}</Badge> : <span className="text-slate-400">0</span>),
      },
    ],
    [state.start, state.end],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        description="Course, question and simulation insights — find what to fix in your training."
        icon={<BarChart3 />}
        actions={
          <Can permission="reports.export">
            <ExportMenu type="organisation" body={{ start_date: state.start ?? null, end_date: state.end ?? null }} label="Organisation report" />
          </Can>
        }
      />

      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-soft sm:flex-row sm:items-center sm:justify-between">
        <DateRangeControl start={state.start} end={state.end} onChange={(r) => set({ start: r.start, end: r.end })} />
        {dash.data && (
          <Tabs value={scope} onValueChange={(v) => set({ scope: v === "all" ? "all" : undefined })}>
            <TabsList aria-label="Course scope for summary">
              <TabsTrigger value="mine">My courses</TabsTrigger>
              <TabsTrigger value="all">All courses</TabsTrigger>
            </TabsList>
          </Tabs>
        )}
      </div>

      {dash.isLoading ? (
        <KpiSkeletonRow n={5} />
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
          <KpiTile label="Courses" value={s ? s.courses_total : items.length} icon={<GraduationCap />} color="indigo" hint={s ? `${s.courses_published} published` : undefined} />
          <KpiTile label="Enrolments" value={s ? s.total_enrolments : totals.enrol} icon={<BookOpen />} color="sky" hint={`${totals.done} completed in range`} />
          <KpiTile label="Learners" value={s ? s.total_learners : "—"} icon={<Users />} color="violet" hint={scope === "mine" ? "In your courses" : "Across all courses"} />
          <KpiTile label="Avg completion" value={pct(s?.average_completion_rate ?? (totals.enrol ? (totals.done / totals.enrol) * 100 : null))} icon={<CheckCircle2 />} color="emerald" />
          <KpiTile
            label="Pending reviews"
            value={s?.pending_reviews ?? "—"}
            icon={<Inbox />}
            color="rose"
            footer={
              <Button size="xs" variant="soft" asChild>
                <Link href="/app/instructor/grading">Open grading</Link>
              </Button>
            }
          />
        </div>
      )}

      {courses.isError && !isNotDeployed(courses.error) ? (
        <ErrorState error={courses.error} onRetry={() => courses.refetch()} />
      ) : (
        <>
          <div className="grid gap-6 xl:grid-cols-3">
            <ChartCard className="xl:col-span-2" title="Completion & score by course" description="Top courses by enrolment in the selected range" icon={TrendingUp} color="emerald">
              {courses.isLoading ? (
                <Skeleton className="h-72 rounded-xl" />
              ) : top.length ? (
                <>
                  <ColorBarChart
                    aria-label="Completion rate and average score by course"
                    data={top.map((c) => ({ name: c.title.length > 16 ? `${c.title.slice(0, 15).trimEnd()}…` : c.title, completion: c.completion_rate ?? 0, score: c.avg_final_score ?? 0 }))}
                    xKey="name"
                    series={[
                      { key: "completion", label: "Completion %", color: "#10b981" },
                      { key: "score", label: "Avg score", color: "#6366f1" },
                    ]}
                    showLegend
                    height={300}
                    valueFormatter={(v) => `${Number(v).toFixed(0)}`}
                  />
                  <ChartDataTable caption="Completion and score by course" columns={["Course", "Enrolled", "Completion %", "Avg score"]} rows={top.map((c) => [c.title, c.enrolments, num(c.completion_rate), num(c.avg_final_score)])} />
                </>
              ) : (
                <p className="py-16 text-center text-sm text-muted-foreground">No enrolments in this range.</p>
              )}
            </ChartCard>
            <ChartCard title="Enrolment status" description="All courses in range" icon={PieChart} color="violet">
              {courses.isLoading ? (
                <Skeleton className="h-56 rounded-xl" />
              ) : totals.enrol ? (
                <DonutChart
                  aria-label="Enrolment status"
                  data={[
                    { name: "Completed", value: totals.done, color: "#10b981" },
                    { name: "In progress", value: inProgress, color: "#0ea5e9" },
                    { name: "Overdue", value: totals.overdue, color: "#f43f5e" },
                  ]}
                  centerLabel={totals.enrol}
                  centerSub="enrolments"
                />
              ) : (
                <p className="py-16 text-center text-sm text-muted-foreground">No enrolments yet.</p>
              )}
            </ChartCard>
          </div>

          <section aria-labelledby="courses-heading" className="space-y-3">
            <h2 id="courses-heading" className="font-display text-lg font-semibold text-slate-900">
              Courses
            </h2>
            <DataTable
              aria-label="Course analytics"
              columns={columns}
              data={filtered}
              loading={courses.isLoading}
              onRowClick={(r) => router.push(`/app/instructor/analytics/${r.course_id}${state.start || state.end ? `?start=${state.start ?? ""}&end=${state.end ?? ""}` : ""}`)}
              toolbar={<FilterBar search={state.q ?? ""} onSearchChange={(q) => set({ q })} searchPlaceholder="Search courses…" />}
              empty={{ title: "No courses", description: "Create a course to start collecting analytics." }}
              pageSize={10}
            />
          </section>
        </>
      )}
    </div>
  );
}

export default function AnalyticsPage() {
  return (
    <Suspense fallback={<KpiSkeletonRow />}>
      <Overview />
    </Suspense>
  );
}
