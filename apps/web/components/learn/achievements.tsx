"use client";

import { Avatar, Badge, SimpleSelect, Skeleton, Switch, Tabs, TabsList, TabsTrigger, cn, toast } from "@praxis/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Award,
  BookOpen,
  Cpu,
  Crown,
  EyeOff,
  Flame,
  Footprints,
  GraduationCap,
  Heart,
  Library,
  Lock,
  type LucideIcon,
  Medal,
  MonitorPlay,
  Rocket,
  ShieldCheck,
  Sparkles,
  Star,
  Target,
  Trophy,
  Users,
  Wrench,
  Zap,
} from "lucide-react";
import * as React from "react";
import { ErrorState } from "@/components/common/error-state";
import { api, errorMessage } from "@/lib/api";
import { usePermission } from "@/lib/auth";
import { formatDate, formatRelative } from "@/lib/format";
import { lk } from "./query-keys";
import type { Badge as BadgeT, Leaderboard } from "./types";
import { SectionTitle } from "./visuals";

const ICONS: Record<string, LucideIcon> = {
  flame: Flame,
  cpu: Cpu,
  "book-open": BookOpen,
  trophy: Trophy,
  award: Award,
  "graduation-cap": GraduationCap,
  footprints: Footprints,
  library: Library,
  wrench: Wrench,
  target: Target,
  star: Star,
  zap: Zap,
  rocket: Rocket,
  crown: Crown,
  heart: Heart,
  "shield-check": ShieldCheck,
  sparkles: Sparkles,
  medal: Medal,
  "monitor-play": MonitorPlay,
};

export function badgeIcon(name: string | null | undefined): LucideIcon {
  return ICONS[(name ?? "").toLowerCase()] ?? Medal;
}

const BADGE_GRADIENTS = [
  "from-amber-400 via-orange-500 to-rose-500",
  "from-violet-500 via-fuchsia-500 to-pink-500",
  "from-sky-400 via-blue-500 to-indigo-500",
  "from-emerald-400 via-teal-500 to-cyan-500",
  "from-rose-400 via-pink-500 to-fuchsia-500",
  "from-indigo-400 via-violet-500 to-purple-600",
];

function gradientFor(key: string) {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return BADGE_GRADIENTS[h % BADGE_GRADIENTS.length]!;
}

export interface BadgeProgress {
  value: number;
  target: number;
}

/** Medallion + text for one badge (earned = colourful, locked = muted with progress). */
export function BadgeTile({ badge, progress }: { badge: BadgeT; progress?: BadgeProgress | null }) {
  const Icon = badgeIcon(badge.icon);
  const earned = badge.earned;
  const pct = progress ? Math.min(100, (progress.value / Math.max(1, progress.target)) * 100) : null;
  const count = badge.earned_count ?? null;
  return (
    <article
      className={cn(
        "group relative flex h-full flex-col items-center rounded-3xl border p-5 text-center transition duration-300",
        earned ? "border-slate-200/80 bg-white shadow-soft hover:-translate-y-1 hover:shadow-lift" : "border-dashed border-slate-300 bg-slate-50/60",
      )}
      aria-label={`${badge.name} — ${earned ? "earned" : "locked"}`}
    >
      <div className="relative">
        {earned && <span className={cn("absolute inset-0 rounded-full bg-gradient-to-br opacity-40 blur-xl transition group-hover:opacity-60", gradientFor(badge.key))} aria-hidden />}
        <span
          className={cn(
            "relative grid size-20 place-items-center rounded-full ring-4",
            earned ? cn("bg-gradient-to-br text-white shadow-lift ring-white", gradientFor(badge.key)) : "bg-slate-200 text-slate-400 ring-slate-100",
          )}
          aria-hidden
        >
          <span className={cn("absolute inset-1.5 rounded-full border-2 border-dashed", earned ? "border-white/40" : "border-slate-300")} />
          <Icon className="size-8" />
        </span>
        {!earned && (
          <span className="absolute -bottom-1 -right-1 grid size-7 place-items-center rounded-full bg-white text-slate-500 shadow-soft ring-1 ring-slate-200" aria-hidden>
            <Lock className="size-3.5" />
          </span>
        )}
      </div>
      <h3 className={cn("mt-4 font-display text-sm font-bold", earned ? "text-slate-900" : "text-slate-700")}>{badge.name}</h3>
      <p className="mt-1 text-xs leading-relaxed text-slate-600">{badge.description}</p>
      <div className="mt-auto w-full pt-3">
        {earned ? (
          <p className="text-2xs font-semibold text-emerald-700">Earned {badge.awarded_at ? formatDate(badge.awarded_at) : ""}</p>
        ) : pct !== null && progress ? (
          <div>
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-200" role="meter" aria-label={`${badge.name} progress`} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full rounded-full bg-gradient-to-r from-brand-500 to-fuchsia-500" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-1 text-2xs font-semibold tabular-nums text-slate-600">
              {Math.min(progress.value, progress.target).toLocaleString()} / {progress.target.toLocaleString()}
            </p>
          </div>
        ) : (
          <p className="text-2xs font-semibold text-slate-500">Locked</p>
        )}
        {count !== null && (
          <p className="mt-1 inline-flex items-center gap-1 text-2xs text-slate-500">
            <Users className="size-3" aria-hidden />
            {count ? `Earned by ${count} ${count === 1 ? "person" : "people"}` : "Be the first to earn it"}
          </p>
        )}
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ leaderboard */

const PERIODS = [
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "all", label: "All time" },
] as const;

const PODIUM = [
  { ring: "ring-amber-300", chip: "bg-gradient-to-br from-amber-300 to-amber-500 text-amber-950", label: "1st" },
  { ring: "ring-slate-300", chip: "bg-gradient-to-br from-slate-200 to-slate-400 text-slate-900", label: "2nd" },
  { ring: "ring-orange-300", chip: "bg-gradient-to-br from-orange-300 to-orange-500 text-orange-950", label: "3rd" },
];

interface DepartmentLite {
  id: string;
  name: string;
}

export function LeaderboardPanel() {
  const qc = useQueryClient();
  const canDepartments = usePermission("users.view");
  const [period, setPeriod] = React.useState<"week" | "month" | "all">("week");
  const [department, setDepartment] = React.useState<string | null>(null);
  const q = useQuery({
    queryKey: lk.gamification.leaderboard(period, department),
    queryFn: ({ signal }) => api.get<Leaderboard>("/gamification/leaderboard", { signal, query: { period, department_id: department ?? undefined, limit: 20 } }),
  });
  const depts = useQuery({
    queryKey: ["departments", "list"],
    queryFn: ({ signal }) => api.get<DepartmentLite[]>("/departments", { signal }),
    enabled: canDepartments,
    staleTime: 300_000,
  });
  const optOut = useMutation({
    mutationFn: (opt_out: boolean) => api.put<{ opt_out: boolean }>("/gamification/me/leaderboard-opt-out", { opt_out }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["gamification", "leaderboard"] });
      qc.invalidateQueries({ queryKey: lk.gamification.me });
      toast.success(r.opt_out ? "You're hidden from the leaderboard" : "You're back on the leaderboard", {
        description: r.opt_out ? "You still earn points and badges privately." : undefined,
      });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const data = q.data;
  const opted = data?.me?.opted_out ?? false;
  const meInList = data?.entries.some((e) => e.is_me);
  const switchId = React.useId();

  if (data && !data.enabled)
    return (
      <section className="rounded-3xl border border-dashed border-slate-300 bg-slate-50/60 p-6 text-center" aria-label="Leaderboard">
        <Users className="mx-auto size-8 text-slate-400" aria-hidden />
        <p className="mt-2 font-semibold text-slate-900">The leaderboard is turned off</p>
        <p className="mt-1 text-sm text-slate-600">Your organisation has disabled leaderboards. Your points and badges are still tracked privately.</p>
      </section>
    );

  return (
    <section className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-soft sm:p-6" aria-labelledby="lb-title">
      <SectionTitle id="lb-title" icon={Trophy} color="amber" title="Leaderboard" description="Points earned in your organisation" />
      <div className="mt-4 flex flex-col gap-3">
        <Tabs value={period} onValueChange={(v) => setPeriod(v as typeof period)}>
          <TabsList aria-label="Leaderboard period" className="w-full">
            {PERIODS.map((p) => (
              <TabsTrigger key={p.value} value={p.value} className="flex-1">
                {p.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {canDepartments && (depts.data?.length ?? 0) > 0 && (
          <SimpleSelect
            className="h-9"
            aria-label="Filter by department"
            value={department ?? "all"}
            onValueChange={(v) => setDepartment(v === "all" ? null : v)}
            options={[{ value: "all", label: "All departments" }, ...(depts.data ?? []).map((d) => ({ value: d.id, label: d.name }))]}
          />
        )}
      </div>

      <div className="mt-4" aria-live="polite" aria-busy={q.isFetching}>
        {q.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12 rounded-xl" />
            ))}
          </div>
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} size="sm" />
        ) : !data || data.entries.length === 0 ? (
          <p className="rounded-2xl bg-slate-50 p-5 text-center text-sm text-slate-600">No points earned in this period yet — be the first!</p>
        ) : (
          <ol className={cn("space-y-1.5 transition-opacity", q.isFetching && "opacity-70")}>
            {data.entries.map((e) => {
              const podium = e.rank <= 3 ? PODIUM[e.rank - 1] : null;
              return (
                <li
                  key={e.user_id}
                  className={cn(
                    "flex items-center gap-3 rounded-2xl px-3 py-2 transition",
                    e.is_me ? "bg-gradient-to-r from-brand-50 via-violet-50 to-fuchsia-50 ring-1 ring-brand-200" : "hover:bg-slate-50",
                  )}
                  aria-current={e.is_me ? "true" : undefined}
                >
                  <span
                    className={cn(
                      "grid size-8 shrink-0 place-items-center rounded-full font-display text-xs font-bold tabular-nums",
                      podium ? podium.chip : "bg-slate-100 text-slate-600",
                    )}
                    aria-label={`Rank ${e.rank}`}
                  >
                    {e.rank}
                  </span>
                  <Avatar name={e.full_name} src={e.avatar_url ?? undefined} size="sm" className={cn(podium && cn("ring-2", podium.ring))} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-900">
                      {e.full_name}
                      {e.is_me && <span className="ml-1.5 text-xs font-medium text-brand-700">(you)</span>}
                    </span>
                    <span className="block text-2xs text-slate-500">Level {e.level}</span>
                  </span>
                  <span className="shrink-0 font-display text-sm font-bold tabular-nums text-slate-900">
                    {e.points.toLocaleString()} <span className="text-2xs font-semibold text-slate-500">pts</span>
                  </span>
                </li>
              );
            })}
            {data.me && !meInList && !opted && data.me.rank !== null && (
              <li className="flex items-center gap-3 rounded-2xl border border-dashed border-brand-200 bg-brand-50/50 px-3 py-2">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-white font-display text-xs font-bold text-brand-700 ring-1 ring-brand-200">{data.me.rank}</span>
                <span className="flex-1 text-sm font-semibold text-slate-900">You</span>
                <span className="font-display text-sm font-bold tabular-nums text-slate-900">{data.me.points.toLocaleString()} pts</span>
              </li>
            )}
          </ol>
        )}
      </div>

      <div className="mt-5 flex items-start gap-3 rounded-2xl bg-slate-50 p-3.5">
        <Switch id={switchId} checked={opted} disabled={optOut.isPending || !data} onCheckedChange={(v) => optOut.mutate(v)} aria-describedby={`${switchId}-hint`} />
        <div className="min-w-0">
          <label htmlFor={switchId} className="flex cursor-pointer items-center gap-1.5 text-sm font-semibold text-slate-900">
            <EyeOff className="size-4 text-slate-500" aria-hidden /> Hide me from the leaderboard
          </label>
          <p id={`${switchId}-hint`} className="text-xs text-slate-600">
            {opted ? "You're hidden from other learners. Your points and badges still count." : "Others can see your name, level and points here."}
          </p>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ points history */

const REASON_LABEL: Record<string, string> = {
  lesson_completed: "Lesson completed",
  assessment_passed: "Assessment passed",
  assignment_passed: "Assignment passed",
  course_completed: "Course completed",
  certificate_issued: "Certificate earned",
  simulation_completed: "Simulation completed",
  badge_awarded: "Badge awarded",
  manual: "Bonus points",
};

const REASON_ICON: Record<string, LucideIcon> = {
  lesson_completed: BookOpen,
  assessment_passed: Target,
  assignment_passed: Wrench,
  course_completed: GraduationCap,
  certificate_issued: Award,
  simulation_completed: MonitorPlay,
};

const REASON_COLOR: Record<string, string> = {
  lesson_completed: "bg-sky-50 text-sky-600",
  assessment_passed: "bg-emerald-50 text-emerald-600",
  assignment_passed: "bg-amber-50 text-amber-600",
  course_completed: "bg-violet-50 text-violet-600",
  certificate_issued: "bg-orange-50 text-orange-600",
  simulation_completed: "bg-fuchsia-50 text-fuchsia-600",
};

export function PointsHistory({ items }: { items: { points: number; reason: string; created_at: string }[] }) {
  if (!items.length) return <p className="rounded-2xl bg-slate-50 p-5 text-center text-sm text-slate-600">Complete lessons, quizzes and simulations to start earning points.</p>;
  return (
    <ol className="space-y-1">
      {items.map((p, i) => {
        const Icon = REASON_ICON[p.reason] ?? Sparkles;
        return (
          <li key={i} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-slate-50">
            <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", REASON_COLOR[p.reason] ?? "bg-indigo-50 text-indigo-600")}>
              <Icon className="size-4" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-slate-800">{REASON_LABEL[p.reason] ?? p.reason.replace(/_/g, " ")}</span>
              <span className="block text-2xs text-slate-500">{formatRelative(p.created_at)}</span>
            </span>
            <Badge tone={p.points >= 0 ? "success" : "danger"} size="sm" className="tabular-nums">
              {p.points >= 0 ? "+" : ""}
              {p.points}
            </Badge>
          </li>
        );
      })}
    </ol>
  );
}
