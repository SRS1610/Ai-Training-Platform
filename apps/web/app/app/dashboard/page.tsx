"use client";

import type { LearnerDashboard } from "@praxis/types";
import { Alert, Skeleton } from "@praxis/ui";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { ErrorState, isNotDeployed } from "@/components/common/error-state";
import {
  CertificatesStrip,
  ContinueLearning,
  DashboardHero,
  DeadlinesTimeline,
  HeatmapCard,
  KpiRow,
  RecentActivity,
  Recommendations,
  SimulationResults,
  SkillsPanel,
  WelcomePanel,
} from "@/components/dashboard/sections";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { qk } from "@/lib/query-keys";

const EMPTY: LearnerDashboard = {
  stats: {
    courses_in_progress: 0,
    courses_completed: 0,
    certificates: 0,
    streak_days: 0,
    longest_streak: 0,
    average_score: null,
    learning_minutes_week: 0,
  },
  current_courses: [],
  upcoming_deadlines: [],
  simulation_results: [],
  skills: [],
  certificates: [],
  recommendations: [],
  recent_activity: [],
  activity_heatmap: [],
};

function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-busy aria-label="Loading dashboard">
      <Skeleton className="h-52 rounded-3xl" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-32 rounded-2xl" />
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-3">
        <Skeleton className="h-96 rounded-2xl xl:col-span-2" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    </div>
  );
}

function Dashboard() {
  const { user } = useAuth();
  const welcome = useSearchParams().get("welcome") === "1";
  const q = useQuery({
    queryKey: qk.dashboard.learner,
    queryFn: ({ signal }) => api.get<LearnerDashboard>("/dashboard/learner", { signal }),
  });

  if (q.isLoading) return <DashboardSkeleton />;
  const notDeployed = q.isError && isNotDeployed(q.error);
  if (q.isError && !notDeployed) return <ErrorState error={q.error} onRetry={() => q.refetch()} size="lg" />;

  const data: LearnerDashboard = { ...EMPTY, ...(q.data ?? {}), stats: { ...EMPTY.stats, ...(q.data?.stats ?? {}) } };
  const isNew = data.current_courses.length === 0 && data.stats.courses_completed === 0 && data.certificates.length === 0;
  const weeklyGoal = Number((user?.preferences as { weekly_goal_minutes?: number } | undefined)?.weekly_goal_minutes) || 120;

  return (
    <div className="space-y-6">
      {notDeployed && (
        <Alert tone="info" title="Your dashboard is warming up">
          Learning data will appear here as soon as the learning service is available.
        </Alert>
      )}
      <DashboardHero name={user?.full_name} data={data} weeklyGoal={weeklyGoal} welcome={welcome || isNew} />
      <KpiRow data={data} />

      {isNew ? (
        <>
          <WelcomePanel emailVerified={!!user?.email_verified} mfaEnabled={!!user?.mfa_enabled} />
          <div className="grid gap-6 lg:grid-cols-2">
            <Recommendations items={data.recommendations} />
            <HeatmapCard days={data.activity_heatmap} />
          </div>
        </>
      ) : (
        <>
          <div className="grid gap-6 xl:grid-cols-3">
            <ContinueLearning courses={data.current_courses} className="xl:col-span-2" />
            <DeadlinesTimeline items={data.upcoming_deadlines} />
          </div>
          <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
            <Recommendations items={data.recommendations} />
            <SkillsPanel skills={data.skills} />
            <SimulationResults results={data.simulation_results} />
          </div>
          <div className="grid gap-6 xl:grid-cols-3">
            <div className="xl:col-span-2">
              <HeatmapCard days={data.activity_heatmap} />
            </div>
            <RecentActivity items={data.recent_activity} />
          </div>
          <CertificatesStrip certificates={data.certificates} />
        </>
      )}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <Dashboard />
    </Suspense>
  );
}
