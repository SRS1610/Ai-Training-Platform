"use client";

import { Button, EmptyState, KpiTile, PageHeader, Skeleton, StreakFlame, cn } from "@praxis/ui";
import { useQuery } from "@tanstack/react-query";
import { Award, CalendarCheck2, Crown, History, Medal, Sparkles, Star, Trophy, Zap } from "lucide-react";
import Link from "next/link";
import { ErrorState } from "@/components/common/error-state";
import { type BadgeProgress, BadgeTile, LeaderboardPanel, PointsHistory } from "@/components/learn/achievements";
import { lk } from "@/components/learn/query-keys";
import type { BadgeList, Certificate, GamificationMe, MyEnrolment } from "@/components/learn/types";
import { SectionTitle } from "@/components/learn/visuals";
import { api } from "@/lib/api";

function LevelHero({ me }: { me: GamificationMe }) {
  const l = me.level;
  const pct = Math.max(0, Math.min(100, l.progress_pct));
  return (
    <section className="relative overflow-hidden rounded-3xl bg-brand-gradient p-6 text-white shadow-glow sm:p-8" aria-labelledby="level-title">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.16)_1px,transparent_0)] [background-size:22px_22px]" aria-hidden />
      <div className="pointer-events-none absolute -right-20 -top-24 size-80 rounded-full bg-white/10" aria-hidden />
      <div className="pointer-events-none absolute -bottom-28 left-1/4 size-72 rounded-full bg-white/[0.07]" aria-hidden />
      <div className="relative grid gap-6 lg:grid-cols-[auto_1fr_auto] lg:items-center">
        <div className="flex items-center gap-5">
          <div className="relative grid size-28 shrink-0 place-items-center" aria-hidden>
            <span className="absolute inset-0 rotate-45 rounded-[2rem] bg-white/15 ring-1 ring-white/30" />
            <span className="absolute inset-3 rotate-45 rounded-[1.4rem] bg-gradient-to-br from-amber-300 via-orange-400 to-rose-500 shadow-lift" />
            <span className="relative flex flex-col items-center leading-none">
              <span className="text-2xs font-bold uppercase tracking-widest text-white/90">Level</span>
              <span className="font-display text-4xl font-extrabold">{l.level}</span>
            </span>
          </div>
          <div className="lg:hidden">
            <p className="text-sm font-semibold text-indigo-100">Current level</p>
            <p className="font-display text-2xl font-bold">{l.name}</p>
          </div>
        </div>
        <div className="min-w-0">
          <p className="hidden text-sm font-semibold text-indigo-100 lg:block">Current level</p>
          <h1 id="level-title" className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
            <span className="hidden lg:inline">{l.name} · </span>
            {me.points.toLocaleString()} <span className="text-2xl font-semibold text-indigo-100">points</span>
          </h1>
          {l.next_level ? (
            <>
              <div
                className="mt-4 h-3 overflow-hidden rounded-full bg-white/20 ring-1 ring-white/25"
                role="progressbar"
                aria-label={`Progress to level ${l.next_level}`}
                aria-valuenow={Math.round(pct)}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div className="h-full rounded-full bg-gradient-to-r from-amber-300 via-orange-300 to-white transition-[width] duration-700" style={{ width: `${pct}%` }} />
              </div>
              <p className="mt-2 text-sm text-indigo-50">
                <strong className="font-semibold text-white">{l.points_to_next.toLocaleString()} points</strong> to level {l.next_level} · {l.next_level_name}
              </p>
            </>
          ) : (
            <p className="mt-3 flex items-center gap-2 text-sm text-indigo-50">
              <Crown className="size-4 text-amber-300" aria-hidden /> You&apos;ve reached the top level. Legendary.
            </p>
          )}
        </div>
        <div className="flex items-center gap-4 rounded-2xl bg-white/15 p-4 ring-1 ring-white/25">
          <span className="grid size-14 place-items-center rounded-2xl bg-white shadow-sm">
            <StreakFlame days={me.streak.current} size={40} />
          </span>
          <div>
            <p className="font-display text-2xl font-bold tabular-nums">
              {me.streak.current} <span className="text-base font-semibold">day{me.streak.current === 1 ? "" : "s"}</span>
            </p>
            <p className="text-xs text-indigo-50">
              {me.streak.active_today ? "Streak safe for today" : me.streak.current ? "Learn today to keep it going" : "Start a streak today"} · best {me.streak.longest}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function AchievementsPage() {
  const me = useQuery({ queryKey: lk.gamification.me, queryFn: ({ signal }) => api.get<GamificationMe>("/gamification/me", { signal }) });
  const badges = useQuery({ queryKey: lk.gamification.badges, queryFn: ({ signal }) => api.get<BadgeList>("/gamification/badges", { signal }) });
  const enrolments = useQuery({ queryKey: lk.enrolments.me, queryFn: ({ signal }) => api.get<MyEnrolment[]>("/enrolments/me", { signal }) });
  const certs = useQuery({ queryKey: lk.certificates.me, queryFn: ({ signal }) => api.get<Certificate[]>("/certificates/me", { signal }) });

  if (me.isLoading)
    return (
      <div className="space-y-6" aria-busy aria-label="Loading achievements">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-48 rounded-3xl" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-96 rounded-3xl" />
      </div>
    );
  if (me.isError || !me.data) return <ErrorState error={me.error} onRetry={() => me.refetch()} size="lg" />;
  const g = me.data;

  if (!g.enabled)
    return (
      <>
        <PageHeader title="Achievements" description="Points, levels, streaks and badges." icon={<Trophy />} />
        <EmptyState
          bordered
          size="lg"
          illustration="trophy"
          title="Achievements are turned off"
          description="Your organisation has switched off points, badges and leaderboards. Your learning progress and certificates are unaffected."
          action={
            <Button asChild variant="gradient" leftIcon={<Award />}>
              <Link href="/app/certificates">View certificates</Link>
            </Button>
          }
        />
      </>
    );

  const all = badges.data?.items ?? [...g.badges, ...g.available_badges];
  const earned = all.filter((b) => b.earned).sort((a, b) => (b.awarded_at ?? "").localeCompare(a.awarded_at ?? ""));
  const locked = all.filter((b) => !b.earned);
  const completedCourses = (enrolments.data ?? []).filter((e) => e.status === "completed").length;
  const certCount = certs.data?.length;
  const progressFor = (criteria: Record<string, unknown>): BadgeProgress | null => {
    const target = Number(criteria.count) || 0;
    if (!target) return null;
    switch (criteria.type) {
      case "points":
        return { value: g.points, target };
      case "streak_days":
        return { value: Math.max(g.streak.longest, g.streak.current), target };
      case "courses_completed":
        return enrolments.isSuccess ? { value: completedCourses, target } : null;
      case "certificates_earned":
        return certCount !== undefined ? { value: certCount, target } : null;
      default:
        return null;
    }
  };

  return (
    <>
      <PageHeader
        title="Achievements"
        description="Every lesson, quiz and simulation earns points. Level up, keep your streak alive and collect badges."
        icon={<Trophy />}
        actions={
          <Button asChild variant="secondary" leftIcon={<Award />}>
            <Link href="/app/certificates">Certificates</Link>
          </Button>
        }
      />

      <div className="space-y-6">
        <LevelHero me={g} />

        <section aria-label="Summary" className="stagger grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <KpiTile label="Total points" value={g.points.toLocaleString()} icon={<Zap />} color="violet" hint={`Level ${g.level.level} · ${g.level.name}`} />
          <KpiTile label="Badges" value={`${earned.length}/${all.length}`} icon={<Medal />} color="amber" hint={locked.length ? `${locked.length} still to unlock` : "Collection complete!"} />
          <KpiTile label="Longest streak" value={`${g.streak.longest}d`} icon={<CalendarCheck2 />} color="rose" hint={`Current: ${g.streak.current} day${g.streak.current === 1 ? "" : "s"}`} />
          <KpiTile label="Leaderboard rank" value={g.rank ? `#${g.rank}` : "—"} icon={<Star />} color="emerald" hint={g.rank ? "All-time in your organisation" : "Hidden or not ranked yet"} />
        </section>

        <div className="grid gap-6 xl:grid-cols-[1fr_24rem]">
          <div className="min-w-0 space-y-6">
            <section className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-soft sm:p-6" aria-labelledby="badges-earned">
              <SectionTitle id="badges-earned" icon={Medal} color="amber" title="Badges earned" description={earned.length ? `${earned.length} unlocked — nice collection` : "Your first badge is one lesson away"} />
              {badges.isError ? (
                <ErrorState error={badges.error} onRetry={() => badges.refetch()} size="sm" className="mt-4" />
              ) : badges.isLoading ? (
                <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 2xl:grid-cols-4">
                  {[0, 1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-52 rounded-3xl" />
                  ))}
                </div>
              ) : earned.length === 0 ? (
                <EmptyState size="sm" illustration="trophy" title="No badges yet" description="Complete your first lesson to earn “First Steps”." />
              ) : (
                <ul className="stagger mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 2xl:grid-cols-4">
                  {earned.map((b) => (
                    <li key={b.id}>
                      <BadgeTile badge={b} />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {locked.length > 0 && (
              <section className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-soft sm:p-6" aria-labelledby="badges-locked">
                <SectionTitle id="badges-locked" icon={Sparkles} color="violet" title="Still to unlock" description="What it takes to earn each one" />
                <ul className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 2xl:grid-cols-4">
                  {locked.map((b) => (
                    <li key={b.id}>
                      <BadgeTile badge={b} progress={progressFor(b.criteria as Record<string, unknown>)} />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          <aside className="min-w-0 space-y-6">
            <LeaderboardPanel />
            <section className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-soft sm:p-6" aria-labelledby="points-history">
              <SectionTitle id="points-history" icon={History} color="sky" title="Recent points" />
              <div className="mt-3">
                <PointsHistory items={g.recent_points} />
              </div>
            </section>
          </aside>
        </div>

        <p className={cn("flex items-center justify-center gap-2 text-center text-xs text-slate-500")}>
          <Zap className="size-3.5 text-amber-500" aria-hidden /> Lessons +10 · quizzes passed +50 · assignments passed +75 · simulations up to +150 · courses +200
        </p>
      </div>
    </>
  );
}
