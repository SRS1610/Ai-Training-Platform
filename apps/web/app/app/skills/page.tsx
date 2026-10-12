"use client";

import { Button, EmptyState, KpiTile, PageHeader, Skeleton, toast } from "@praxis/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Award, BadgeCheck, Gauge, Library, RefreshCw, ShieldCheck, Target } from "lucide-react";
import Link from "next/link";
import { ErrorState, isNotDeployed } from "@/components/common/error-state";
import { lk } from "@/components/learn/query-keys";
import { Competencies, PlanCard, PlanSkeleton, RecommendationsPanel, SkillProfile, WeakAreas, proficiencyLevel } from "@/components/learn/skills-sections";
import type { LearnerAnalytics, LearningPlan, MyRecommendations, MySkills } from "@/components/learn/types";
import { SectionTitle } from "@/components/learn/visuals";
import { api, errorMessage } from "@/lib/api";

export default function SkillsPage() {
  const qc = useQueryClient();
  const skills = useQuery({ queryKey: lk.skills.me, queryFn: ({ signal }) => api.get<MySkills>("/skills/me", { signal }) });
  const recs = useQuery({ queryKey: lk.recommendations.me, queryFn: ({ signal }) => api.get<MyRecommendations>("/recommendations/me", { signal }) });
  const plan = useQuery({ queryKey: lk.recommendations.plan, queryFn: ({ signal }) => api.get<LearningPlan>("/recommendations/me/plan", { signal }), staleTime: 5 * 60_000 });
  const analytics = useQuery({ queryKey: lk.analytics.me, queryFn: ({ signal }) => api.get<LearnerAnalytics>("/analytics/learner/me", { signal }) });

  const refresh = useMutation({
    mutationFn: () => api.post<MyRecommendations>("/recommendations/me/refresh"),
    onSuccess: (d) => {
      qc.setQueryData(lk.recommendations.me, d);
      qc.invalidateQueries({ queryKey: lk.recommendations.plan });
      toast.success("Recommendations refreshed", { description: `${d.items.length} suggestion${d.items.length === 1 ? "" : "s"} based on your latest results.` });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const list = skills.data?.skills ?? [];
  const comps = skills.data?.competencies ?? [];
  const avg = list.length ? Math.round(list.reduce((a, s) => a + s.proficiency, 0) / list.length) : null;
  const strong = list.filter((s) => s.proficiency >= 85).length;
  const attained = comps.filter((c) => c.attained).length;
  const trends = Object.fromEntries((recs.data?.skills ?? []).map((s) => [s.skill_id, s.trend]));

  return (
    <>
      <PageHeader
        title="Skills"
        description="Your competency profile, a personalised plan and exactly where to focus next."
        icon={<Target />}
        actions={
          <Button variant="secondary" leftIcon={<RefreshCw />} loading={refresh.isPending} onClick={() => refresh.mutate()}>
            Refresh recommendations
          </Button>
        }
      />

      <section aria-label="Summary" className="stagger mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <KpiTile label="Skills tracked" value={skills.isLoading ? "—" : list.length} icon={<Gauge />} color="teal" hint="With assessed evidence" />
        <KpiTile
          label="Average proficiency"
          value={skills.isLoading ? "—" : avg === null ? "—" : `${avg}%`}
          icon={<Target />}
          color="violet"
          hint={avg === null ? "No evidence yet" : proficiencyLevel(avg).label}
        />
        <KpiTile label="Advanced or better" value={skills.isLoading ? "—" : strong} icon={<BadgeCheck />} color="emerald" hint="Skills at 85% or above" />
        <KpiTile label="Competencies" value={skills.isLoading ? "—" : comps.length ? `${attained}/${comps.length}` : "—"} icon={<ShieldCheck />} color="amber" hint={comps.length ? "Attained" : "None defined yet"} />
      </section>

      <div className="space-y-6">
        {skills.isError ? (
          <ErrorState error={skills.error} onRetry={() => skills.refetch()} />
        ) : skills.isLoading ? (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-5" aria-busy aria-label="Loading skills">
            <Skeleton className="h-[26rem] rounded-3xl lg:col-span-2" />
            <Skeleton className="h-[26rem] rounded-3xl lg:col-span-3" />
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            bordered
            size="lg"
            illustration="chart"
            title="Your skill profile starts with your first result"
            description="Quizzes, assignments and simulations all add evidence to the skills they cover. Complete one and your profile appears here."
            action={
              <Button asChild variant="gradient" leftIcon={<Library />}>
                <Link href="/app/learning">Continue learning</Link>
              </Button>
            }
          />
        ) : (
          <SkillProfile skills={list} trends={trends} />
        )}

        {plan.isLoading ? (
          <PlanSkeleton />
        ) : plan.isError ? (
          isNotDeployed(plan.error) ? null : <ErrorState error={plan.error} onRetry={() => plan.refetch()} size="sm" />
        ) : plan.data && (plan.data.steps.length > 0 || plan.data.summary) ? (
          <PlanCard plan={plan.data} recs={recs.data?.items ?? []} />
        ) : null}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {recs.isError ? (
            <ErrorState error={recs.error} onRetry={() => recs.refetch()} size="sm" />
          ) : (
            <RecommendationsPanel data={recs.data} loading={recs.isLoading} refreshing={refresh.isPending} onRefresh={() => refresh.mutate()} />
          )}
          {analytics.isLoading ? (
            <Skeleton className="h-96 rounded-3xl" />
          ) : analytics.isError ? (
            <ErrorState error={analytics.error} onRetry={() => analytics.refetch()} size="sm" />
          ) : analytics.data ? (
            <WeakAreas data={analytics.data} />
          ) : null}
        </div>

        <section aria-labelledby="comp-title" className="space-y-4">
          <SectionTitle
            id="comp-title"
            icon={Award}
            color="amber"
            title="Competency attainment"
            description="Competencies combine several skills, each with a target level"
          />
          {skills.isLoading ? <Skeleton className="h-40 rounded-3xl" /> : skills.isError ? null : <Competencies items={comps} />}
        </section>
      </div>
    </>
  );
}
