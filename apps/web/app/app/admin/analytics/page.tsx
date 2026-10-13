"use client";

import { Button, PageHeader, Skeleton } from "@praxis/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { BarChart3, FileDown, RotateCcw, X } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Suspense } from "react";
import { DateRangePicker, daysAgo } from "@/components/admin/date-range";
import { ak } from "@/components/admin/keys";
import {
  ActiveLearnersCard,
  AnalyticsKpis,
  ComplianceCard,
  DepartmentsCard,
  EmployeeTable,
  SkillGapsCard,
  TopPerformersCard,
} from "@/components/admin/org-analytics";
import { CourseSelect, DepartmentSelect, type Option } from "@/components/admin/pickers";
import type { OrgAnalytics } from "@/components/admin/types";
import { LiveRegion, PageGate, useSetUrlParams, useUrlState } from "@/components/admin/ui";
import { ErrorState } from "@/components/common/error-state";
import { api } from "@/lib/api";
import { Can } from "@/lib/auth";

function AnalyticsSkeleton() {
  return (
    <div className="space-y-6" aria-busy aria-label="Loading analytics">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-32 rounded-2xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        <Skeleton className="h-96 rounded-2xl xl:col-span-3" />
        <Skeleton className="h-96 rounded-2xl xl:col-span-2" />
      </div>
      <Skeleton className="h-96 rounded-2xl" />
    </div>
  );
}

function AnalyticsPage() {
  const [dept, setDept] = useUrlState("department");
  const [course, setCourse] = useUrlState("course");
  const [startRaw] = useUrlState("start", daysAgo(89));
  const [endRaw] = useUrlState("end", new Date().toISOString().slice(0, 10));
  const setMany = useSetUrlParams();
  const start = startRaw === "all" ? "" : startRaw;
  const end = endRaw === "all" ? "" : endRaw;
  const [courseLabel, setCourseLabel] = React.useState<string | null>(null);
  const params = { department_id: dept || undefined, course_id: course || undefined, start: start || undefined, end: end || undefined };
  const q = useQuery({
    queryKey: ak.analytics.org(params),
    queryFn: ({ signal }) => api.get<OrgAnalytics>("/analytics/organisation", { signal, query: params }),
    placeholderData: keepPreviousData,
  });
  const courseOpt: Option | null = course ? { value: course, label: courseLabel ?? q.data?.courses.find((c) => c.course_id === course)?.title ?? "Selected course" } : null;
  const filtered = !!dept || !!course;

  return (
    <>
      <PageHeader
        icon={<BarChart3 />}
        eyebrow="Insight"
        title="Organisation analytics"
        description="Completion, compliance, skills and performance across your organisation."
        actions={
          <Can permission="reports.export">
            <Button asChild variant="secondary" leftIcon={<FileDown />}>
              <Link href="/app/admin/reports">Export reports</Link>
            </Button>
          </Can>
        }
      />
      <section aria-label="Filters" className="mb-6 flex flex-col gap-3 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-soft sm:p-4 lg:flex-row lg:items-center">
        <div className="grid grid-cols-1 flex-1 gap-3 sm:grid-cols-2">
          <DepartmentSelect value={dept || null} onChange={(v) => setDept(v ?? "")} noneLabel="All departments" placeholder="All departments" aria-label="Department" />
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <CourseSelect
                value={courseOpt}
                onChange={(o) => {
                  setCourse(o?.value ?? "");
                  setCourseLabel(o?.label ?? null);
                }}
                placeholder="All courses"
              />
            </div>
            {course && (
              <Button variant="ghost" size="icon-sm" aria-label="Clear course filter" onClick={() => setCourse("")}>
                <X />
              </Button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DateRangePicker
            value={{ start, end }}
            onChange={(r) => setMany({ start: r.start || "all", end: r.end || "all" })}
          />
          {filtered && (
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<RotateCcw />}
              onClick={() => setMany({ department: null, course: null })}
            >
              Reset
            </Button>
          )}
        </div>
      </section>
      <LiveRegion>{q.isFetching ? "Updating analytics…" : q.data ? "Analytics updated" : ""}</LiveRegion>

      {q.isLoading ? (
        <AnalyticsSkeleton />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} size="lg" />
      ) : (
        <div className={q.isFetching ? "space-y-6 opacity-70 transition-opacity" : "space-y-6 transition-opacity"}>
          <AnalyticsKpis data={q.data!} />
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
            <div className="xl:col-span-3">
              <ActiveLearnersCard data={q.data!} />
            </div>
            <div className="xl:col-span-2">
              <ComplianceCard data={q.data!} />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
            <div className="xl:col-span-3">
              <DepartmentsCard data={q.data!} />
            </div>
            <div className="xl:col-span-2">
              <TopPerformersCard people={q.data!.top_performers} />
            </div>
          </div>
          <SkillGapsCard gaps={q.data!.skill_gaps} />
          <EmployeeTable people={q.data!.employee_performance} />
        </div>
      )}
    </>
  );
}

export default function Page() {
  return (
    <PageGate permission="analytics.view">
      <Suspense fallback={<AnalyticsSkeleton />}>
        <AnalyticsPage />
      </Suspense>
    </PageGate>
  );
}
