"use client";

import { Breadcrumbs, Button, Card, EmptyState, KpiTile, StatusPill, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, cn } from "@praxis/ui";
import { DonutChart } from "@praxis/ui/charts";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, BarChart3, BookOpen, CalendarClock, CheckCircle2, ClipboardCheck, FileQuestion, Gauge, Layers, MonitorPlay, PieChart, Timer, TrendingDown, Users } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Suspense } from "react";
import { ErrorState } from "@/components/common/error-state";
import {
  AssignmentDistribution,
  AtRiskLearners,
  DateRangeControl,
  ExportMenu,
  ModuleFunnel,
  MostFailed,
  QuestionTable,
  SimulationResults,
  ak,
  type CourseAnalytics,
  type PerformanceRow,
} from "@/components/analytics/course-analytics";
import { ChartCard, KpiSkeletonRow, num, pct, scaleClasses } from "@/components/analytics/kit";
import { useUrlState } from "@/components/grading/use-url-state";
import { api } from "@/lib/api";
import { Can } from "@/lib/auth";
import { formatMinutes } from "@/lib/format";

const KEYS = ["start", "end"] as const;

function CourseDrilldown() {
  const { courseId } = useParams<{ courseId: string }>();
  const [state, set] = useUrlState(KEYS);
  const range = { start: state.start, end: state.end };
  const q = useQuery({
    queryKey: ak.course(courseId, range),
    queryFn: ({ signal }) => api.get<CourseAnalytics>(`/analytics/courses/${courseId}`, { signal, query: range }),
  });
  const perf = useQuery({
    queryKey: ak.org({ course_id: courseId, ...range }),
    queryFn: ({ signal }) => api.get<{ employee_performance: PerformanceRow[] }>("/analytics/organisation", { signal, query: { course_id: courseId, ...range } }),
  });

  const title = q.data?.course.title ?? "Course";
  const header = (
    <div className="space-y-4">
      <Breadcrumbs linkComponent={Link} items={[{ label: "Analytics", href: "/app/instructor/analytics" }, { label: title }]} />
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-emerald-500 via-teal-500 to-sky-500 text-white shadow-glow">
            <BarChart3 className="size-6" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">Course analytics</p>
            <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{title}</h1>
            {q.data && (
              <div className="mt-1.5 flex items-center gap-2 text-sm text-muted-foreground">
                <StatusPill status={q.data.course.status} size="sm" />
                {state.start || state.end ? `${state.start ?? "…"} → ${state.end ?? "today"}` : "All time"}
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" leftIcon={<ArrowLeft />} asChild>
            <Link href="/app/instructor/analytics">All courses</Link>
          </Button>
          <Can permission="reports.export">
            <ExportMenu type="course" body={{ course_id: courseId, start_date: state.start ?? null, end_date: state.end ?? null }} label="Course report" />
          </Can>
        </div>
      </header>
      <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-soft">
        <DateRangeControl start={state.start} end={state.end} onChange={(r) => set({ start: r.start, end: r.end })} />
      </div>
    </div>
  );

  if (q.isLoading)
    return (
      <div className="space-y-6">
        {header}
        <KpiSkeletonRow />
      </div>
    );
  if (q.isError || !q.data)
    return (
      <div className="space-y-6">
        {header}
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </div>
    );

  const d = q.data;
  const e = d.enrolments;
  const base = Math.max(0, (e.total ?? 0) - (e.withdrawn ?? 0));
  const statusData = [
    { name: "Completed", value: e.completed ?? 0, color: "#10b981" },
    { name: "In progress", value: e.in_progress ?? 0, color: "#0ea5e9" },
    { name: "Not started", value: e.not_started ?? 0, color: "#94a3b8" },
    { name: "Withdrawn", value: e.withdrawn ?? 0, color: "#f59e0b" },
  ].filter((x) => x.value > 0);
  const flaggedQ = d.questions.filter((x) => x.needs_review).length;

  return (
    <div className="space-y-6">
      {header}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <KpiTile label="Enrolled" value={base} icon={<Users />} color="indigo" hint={`${e.withdrawn ?? 0} withdrawn`} />
        <KpiTile label="Completion rate" value={pct(e.completion_rate)} icon={<CheckCircle2 />} color="emerald" hint={`${e.completed} completed`} />
        <KpiTile label="Avg progress" value={pct(e.avg_progress)} icon={<TrendingDown className="rotate-180" />} color="sky" />
        <KpiTile label="Avg final score" value={num(e.avg_final_score)} icon={<Gauge />} color="amber" hint="Completed enrolments" />
        <KpiTile label="Overdue" value={e.overdue ?? 0} icon={<CalendarClock />} color="rose" hint="Past due, not complete" />
        <KpiTile
          label="Time to complete"
          value={e.avg_days_to_complete !== null ? `${num(e.avg_days_to_complete)}d` : "—"}
          icon={<Timer />}
          color="teal"
          hint={e.avg_time_spent_seconds ? `${formatMinutes(e.avg_time_spent_seconds / 60)} learning time` : undefined}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <ChartCard className="xl:col-span-2" title="Completion funnel" description="Learners who completed every lesson in each module — expand a module for lesson-level drop-off" icon={Layers} color="indigo">
          <ModuleFunnel funnel={d.funnel} base={base} />
        </ChartCard>
        <ChartCard title="Enrolment status" icon={PieChart} color="violet">
          {statusData.length ? <DonutChart aria-label="Enrolment status" data={statusData} centerLabel={e.total} centerSub="enrolments" /> : <EmptyState size="sm" illustration="learning" title="No enrolments in range" />}
        </ChartCard>
      </div>

      <ChartCard title="Assessments" description="Graded attempts in the selected range" icon={FileQuestion} color="sky">
        {d.assessments.length ? (
          <div className="overflow-x-auto rounded-2xl border border-slate-200 scrollbar-thin">
            <Table aria-label="Assessment results">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Assessment</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead className="text-right">Attempts</TableHead>
                  <TableHead className="text-right">Learners</TableHead>
                  <TableHead className="text-right">Avg %</TableHead>
                  <TableHead className="text-right">Pass rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.assessments.map((a) => (
                  <TableRow key={a.assessment_id}>
                    <TableCell className="font-medium text-slate-900">{a.title}</TableCell>
                    <TableCell className="text-xs capitalize text-slate-600">{a.kind}</TableCell>
                    <TableCell className="text-right tabular-nums">{a.attempts}</TableCell>
                    <TableCell className="text-right tabular-nums">{a.learners}</TableCell>
                    <TableCell className="text-right">
                      <span className={cn("rounded-md px-2 py-0.5 text-xs font-bold tabular-nums", scaleClasses(a.avg_percentage, [50, 70, 85]))}>{pct(a.avg_percentage)}</span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className={cn("rounded-md px-2 py-0.5 text-xs font-bold tabular-nums", scaleClasses(a.pass_rate, [40, 60, 80]))}>{pct(a.pass_rate)}</span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <EmptyState size="sm" illustration="chart" title="No assessments in this course" />
        )}
      </ChartCard>

      <div className="grid gap-6 xl:grid-cols-3">
        <ChartCard
          className="xl:col-span-2"
          title="Question difficulty"
          description="Item analysis across graded attempts"
          icon={BarChart3}
          color="indigo"
          action={
            flaggedQ ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 ring-1 ring-inset ring-rose-200">
                <AlertTriangle className="size-3.5" aria-hidden /> {flaggedQ} to review
              </span>
            ) : undefined
          }
        >
          <QuestionTable rows={d.questions} />
        </ChartCard>
        <ChartCard title="Most failed questions" description="Ranked by incorrect answers" icon={TrendingDown} color="rose">
          <MostFailed rows={d.most_failed_questions} />
        </ChartCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <ChartCard title="Assignment scores" description="Final score distribution" icon={ClipboardCheck} color="amber">
          <AssignmentDistribution assignments={d.assignments} />
        </ChartCard>
        <ChartCard className="xl:col-span-2" title="Learners needing attention" description="Overdue, or averaging below the pass mark in this course" icon={Users} color="orange">
          {perf.isError ? <ErrorState error={perf.error} onRetry={() => perf.refetch()} size="sm" /> : <AtRiskLearners rows={perf.data?.employee_performance ?? []} loading={perf.isLoading} />}
        </ChartCard>
      </div>

      <ChartCard title="Simulation results" description="Scores and bands in range; dimension breakdown is all-time" icon={MonitorPlay} color="violet">
        <SimulationResults sims={d.simulations} />
      </ChartCard>

      {d.funnel.length === 0 && d.assessments.length === 0 && (
        <Card className="p-6">
          <EmptyState illustration="learning" title="Nothing to analyse yet" description="Add modules, lessons and assessments to this course to unlock analytics." action={<Button asChild variant="soft"><Link href={`/app/instructor/courses/${courseId}`}><BookOpen className="mr-1 size-4" aria-hidden />Open course</Link></Button>} />
        </Card>
      )}
    </div>
  );
}

export default function CourseAnalyticsPage() {
  return (
    <Suspense fallback={<KpiSkeletonRow />}>
      <CourseDrilldown />
    </Suspense>
  );
}
