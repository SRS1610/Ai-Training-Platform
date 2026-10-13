"use client";

import { Badge, Button, EmptyState, ProgressRing, Skeleton, bandMeta, categoryClasses, cn, colorClasses, toast } from "@praxis/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  BookOpen,
  Bot,
  CalendarRange,
  CheckCircle2,
  Circle,
  Compass,
  Gauge,
  GraduationCap,
  HelpCircle,
  type LucideIcon,
  MonitorPlay,
  Repeat,
  Sparkles,
  Target,
  ThumbsUp,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { api, errorMessage } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import { MiniSparkline, SkillRadar } from "./skill-radar";
import { targetHref } from "./meta";
import { lk } from "./query-keys";
import type { LearnerAnalytics, LearningPlan, MyCompetency, MyRecommendations, MySkill, RecommendationOut } from "./types";
import { SectionTitle } from "./visuals";

/** Plain-text preview of question/plan text that may contain markdown (bold, code, links). */
function stripMd(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|\*|~~)(\S(?:.*?\S)?)\1/g, "$2")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/* ------------------------------------------------------------------ proficiency bands */

const LEVELS = [
  { min: 95, band: "expert", label: "Expert" },
  { min: 85, band: "advanced", label: "Advanced" },
  { min: 70, band: "competent", label: "Competent" },
  { min: 50, band: "needs_improvement", label: "Developing" },
  { min: 0, band: "fail", label: "Emerging" },
] as const;

/** Proficiency (0–100) → level, using the platform's performance-band thresholds and colours. */
export function proficiencyLevel(p: number) {
  const l = LEVELS.find((x) => p >= x.min) ?? LEVELS[LEVELS.length - 1]!;
  const meta = bandMeta(l.band);
  return { ...l, color: meta.color };
}

function LevelChip({ p }: { p: number }) {
  const l = proficiencyLevel(p);
  const c = colorClasses(l.color);
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-semibold ring-1 ring-inset", c.soft, c.text, c.ring)}>{l.label}</span>;
}

/* ------------------------------------------------------------------ profile */

/** Trend direction from evidence scores: mean of the recent half vs the earlier half. */
function trendDelta(values: number[]): number | null {
  if (values.length < 4) return null;
  const mid = Math.floor(values.length / 2);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return mean(values.slice(mid)) - mean(values.slice(0, mid));
}

function CategoryFilter({ cats, value, onChange, className }: { cats: string[]; value: string | null; onChange: (c: string | null) => void; className?: string }) {
  return (
    <div className={cn("inline-flex shrink-0 rounded-lg bg-slate-100 p-0.5", className)} role="group" aria-label="Filter skills by category">
      {[null, ...cats].map((c) => (
        <button
          key={c ?? "all"}
          type="button"
          aria-pressed={value === c}
          onClick={() => onChange(c)}
          className={cn("rounded-md px-2.5 py-1 text-xs font-semibold transition focus-visible:focus-ring", value === c ? "bg-white text-slate-900 shadow-sm" : "text-slate-600")}
        >
          {c ?? "All"}
        </button>
      ))}
    </div>
  );
}

export function SkillProfile({ skills, trends }: { skills: MySkill[]; trends: Record<string, (number | null)[]> }) {
  const [cat, setCat] = React.useState<string | null>(null);
  const cats = [...new Set(skills.map((s) => s.category).filter(Boolean))] as string[];
  const sorted = [...skills].sort((a, b) => b.proficiency - a.proficiency);
  const shown = cat ? sorted.filter((s) => s.category === cat) : sorted;
  // Stable identity so Recharts doesn't replay its entrance animation on unrelated re-renders.
  const radarKey = sorted
    .slice(0, 10)
    .map((s) => `${s.skill_id}:${Math.round(s.proficiency)}`)
    .join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const radar = React.useMemo(() => sorted.slice(0, 10).map((s) => ({ subject: s.name, value: Math.round(s.proficiency), benchmark: 70 })), [radarKey]);
  const strongest = sorted[0];
  const weakest = sorted[sorted.length - 1];

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
      <section className="min-w-0 rounded-3xl border border-slate-200/80 bg-white p-5 shadow-soft sm:p-6 lg:col-span-2 lg:self-start" aria-labelledby="skill-radar">
        <SectionTitle id="skill-radar" icon={Compass} color="violet" title="Skill profile" description="Your proficiency against the 70% competence line" />
        <figure className="mt-2">
          {radar.length >= 3 ? (
            <SkillRadar data={radar} height={340} label={`Radar chart of skill proficiency: ${radar.map((r) => `${r.subject} ${r.value}%`).join(", ")}`} />
          ) : (
            <div className="grid h-64 place-items-center text-sm text-slate-500">Add a few more skills to see your profile shape.</div>
          )}
          <figcaption className="mt-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-slate-600">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-4 rounded-full bg-indigo-500" aria-hidden /> Proficiency
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-4 border-t-2 border-dashed border-amber-500" aria-hidden /> Competent (70%)
            </span>
          </figcaption>
          {strongest && weakest && strongest !== weakest && (
            <p className="mt-3 rounded-2xl bg-slate-50 p-3 text-center text-sm text-slate-700">
              Strongest in <strong className="text-emerald-700">{strongest.name}</strong> ({Math.round(strongest.proficiency)}%) · most room to grow in{" "}
              <strong className="text-amber-800">{weakest.name}</strong> ({Math.round(weakest.proficiency)}%)
            </p>
          )}
        </figure>
      </section>

      <section className="min-w-0 rounded-3xl border border-slate-200/80 bg-white p-5 shadow-soft sm:p-6 lg:col-span-3" aria-labelledby="skill-list">
        <SectionTitle
          id="skill-list"
          icon={Gauge}
          color="teal"
          title="Proficiency by skill"
          description="From quizzes, assignments and simulations"
          action={cats.length > 1 ? <CategoryFilter cats={cats} value={cat} onChange={setCat} className="hidden sm:inline-flex" /> : undefined}
        />
        {cats.length > 1 && <CategoryFilter cats={cats} value={cat} onChange={setCat} className="mt-4 sm:hidden" />}
        <ul className="mt-5 space-y-4">
          {shown.map((s) => {
            const l = proficiencyLevel(s.proficiency);
            const c = colorClasses(l.color);
            const trend = (trends[s.skill_id] ?? []).filter((v): v is number => typeof v === "number");
            const delta = trendDelta(trend);
            const cc = categoryClasses(s.category ?? s.name);
            return (
              <li key={s.skill_id} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 sm:grid-cols-[minmax(0,1fr)_5.5rem_auto]">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn("size-2 shrink-0 rounded-full", cc.solid)} aria-hidden />
                    <span className="truncate text-sm font-semibold text-slate-900">{s.name}</span>
                    <LevelChip p={s.proficiency} />
                  </div>
                  <div
                    className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100"
                    role="meter"
                    aria-label={`${s.name} proficiency`}
                    aria-valuenow={Math.round(s.proficiency)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div className={cn("h-full rounded-full bg-gradient-to-r", c.gradient)} style={{ width: `${Math.max(2, s.proficiency)}%` }} />
                  </div>
                  <p className="mt-1 text-2xs text-slate-500">
                    {s.evidence_count} piece{s.evidence_count === 1 ? "" : "s"} of evidence{s.last_assessed_at ? ` · last assessed ${formatRelative(s.last_assessed_at)}` : ""}
                  </p>
                </div>
                <div className="hidden sm:block">{trend.length >= 2 ? <MiniSparkline data={trend} color={c.hex} height={30} /> : null}</div>
                <div className="text-right">
                  <p className="font-display text-lg font-bold tabular-nums text-slate-900">{Math.round(s.proficiency)}%</p>
                  {delta !== null && Math.abs(delta) >= 3 ? (
                    <p className={cn("flex items-center justify-end gap-0.5 text-2xs font-semibold", delta > 0 ? "text-emerald-700" : "text-rose-700")}>
                      {delta > 0 ? <TrendingUp className="size-3" aria-hidden /> : <TrendingDown className="size-3" aria-hidden />}
                      {delta > 0 ? "+" : ""}
                      {Math.round(delta)}
                      <span className="sr-only"> points across recent evidence</span>
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ plan */

const ACTIVITY_ICON: Record<string, LucideIcon> = {
  lesson: BookOpen,
  practice: Repeat,
  assessment: HelpCircle,
  quiz: HelpCircle,
  simulation: MonitorPlay,
  course: GraduationCap,
};
const WEEK_COLORS = ["indigo", "sky", "emerald", "amber", "rose", "fuchsia", "teal", "orange", "violet"] as const;

export function PlanCard({ plan, recs }: { plan: LearningPlan; recs: RecommendationOut[] }) {
  const byTarget = new Map(recs.filter((r) => r.target_id).map((r) => [r.target_id!, r]));
  const dir = plan.difficulty_adjustment?.direction;
  return (
    <section className="rounded-3xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 p-px shadow-soft" aria-labelledby="plan-title">
      <div className="rounded-[calc(1.5rem-1px)] bg-white p-5 sm:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-brand-gradient text-white shadow-glow">
            <CalendarRange className="size-6" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="plan-title" className="font-display text-lg font-bold text-slate-900">
                Your personalised plan
              </h2>
              <Badge tone="violet" size="sm">
                {plan.generated_by === "ai" ? <Bot aria-hidden /> : <Sparkles aria-hidden />}
                {plan.generated_by === "ai" ? (plan.offline ? "AI (offline mode)" : "AI-generated") : "Rule-based"}
              </Badge>
              {plan.pace && (
                <Badge tone="neutral" size="sm">
                  Pace: {plan.pace}
                </Badge>
              )}
              {plan.avg_score !== null && (
                <Badge tone="info" size="sm">
                  Avg score {Math.round(plan.avg_score)}%
                </Badge>
              )}
            </div>
            <p className="mt-2 text-[15px] leading-relaxed text-slate-700">{plan.summary}</p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-2xl bg-emerald-50/70 p-4 ring-1 ring-emerald-100">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-700">
              <ThumbsUp className="size-3.5" aria-hidden /> Strengths
            </p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {plan.strengths.length ? (
                plan.strengths.map((s) => (
                  <li key={s} className="rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200">
                    {s}
                  </li>
                ))
              ) : (
                <li className="text-sm text-slate-600">Complete more graded work to surface strengths.</li>
              )}
            </ul>
          </div>
          <div className="rounded-2xl bg-amber-50/70 p-4 ring-1 ring-amber-100">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-amber-800">
              <Target className="size-3.5" aria-hidden /> Focus areas
            </p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {plan.focus_areas.length ? (
                plan.focus_areas.map((s) => (
                  <li key={s} className="rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-amber-900 ring-1 ring-amber-200">
                    {s}
                  </li>
                ))
              ) : (
                <li className="text-sm text-slate-600">No weak areas right now — nice.</li>
              )}
            </ul>
          </div>
          <div className="rounded-2xl bg-sky-50/70 p-4 ring-1 ring-sky-100">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-sky-700">
              {dir === "harder" ? <TrendingUp className="size-3.5" aria-hidden /> : dir === "easier" ? <TrendingDown className="size-3.5" aria-hidden /> : <Gauge className="size-3.5" aria-hidden />}
              Difficulty: {dir === "harder" ? "step it up" : dir === "easier" ? "ease off" : "keep steady"}
            </p>
            <p className="mt-2 text-sm text-slate-700">{plan.difficulty_adjustment?.reason || "Keep your current difficulty."}</p>
          </div>
        </div>

        {plan.steps.length > 0 && (
          <ol className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Weekly steps">
            {plan.steps.map((step, i) => {
              const c = colorClasses(WEEK_COLORS[i % WEEK_COLORS.length]!);
              return (
                <li key={`${step.week}-${i}`} className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white">
                  <div className={cn("h-1 bg-gradient-to-r", c.gradient)} aria-hidden />
                  <div className="p-4">
                    <div className="flex items-center gap-2">
                      <span className={cn("grid size-8 place-items-center rounded-lg bg-gradient-to-br font-display text-xs font-bold text-white", c.gradient)}>W{step.week}</span>
                      <p className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">{step.focus}</p>
                    </div>
                    <ul className="mt-3 space-y-1.5">
                      {step.activities.map((act, j) => {
                        const Icon = ACTIVITY_ICON[act.type] ?? Sparkles;
                        const rec = act.target_id ? byTarget.get(act.target_id) : undefined;
                        const href = act.target_id ? (rec ? targetHref(rec) : targetHref({ type: act.type, target_id: act.target_id })) : null;
                        const inner = (
                          <>
                            <Icon className={cn("mt-0.5 size-4 shrink-0", c.icon)} aria-hidden />
                            <span className="min-w-0 flex-1">
                              <span className="line-clamp-2 text-sm text-slate-800">{stripMd(act.title)}</span>
                            </span>
                            {href && <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-brand-600" aria-hidden />}
                          </>
                        );
                        return (
                          <li key={j}>
                            {href && !href.endsWith("/app/catalog") ? (
                              <Link href={href} className="group -mx-1.5 flex items-start gap-2 rounded-lg px-1.5 py-1 transition hover:bg-slate-50 focus-visible:focus-ring" title={act.reason}>
                                {inner}
                              </Link>
                            ) : (
                              <div className="flex items-start gap-2 px-0 py-1" title={act.reason}>
                                {inner}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}

export function PlanSkeleton() {
  return (
    <div className="space-y-4 rounded-3xl border border-slate-200/80 bg-white p-6 shadow-soft" aria-busy aria-label="Building your plan">
      <div className="flex items-center gap-3">
        <Skeleton className="size-12 rounded-2xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-4 w-full" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
      <p className="flex items-center gap-2 text-sm text-slate-500">
        <Sparkles className="size-4 text-fuchsia-500 motion-safe:animate-pulse" aria-hidden /> Building your plan from your recent results…
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ recommendations */

const REC_META: Record<string, { icon: LucideIcon; color: Parameters<typeof colorClasses>[0]; label: string }> = {
  lesson: { icon: BookOpen, color: "sky", label: "Review lesson" },
  practice: { icon: Repeat, color: "emerald", label: "Practice" },
  simulation: { icon: MonitorPlay, color: "violet", label: "Simulation" },
  course: { icon: GraduationCap, color: "indigo", label: "Course" },
  revision_plan: { icon: CalendarRange, color: "fuchsia", label: "Revision plan" },
};

function RecommendationRow({ r }: { r: RecommendationOut }) {
  const qc = useQueryClient();
  const meta = REC_META[r.kind] ?? { icon: Sparkles, color: "indigo" as const, label: r.kind.replace(/_/g, " ") };
  const c = colorClasses(meta.color);
  const href = targetHref(r);
  const dismiss = useMutation({
    mutationFn: () => api.post<RecommendationOut>(`/recommendations/${r.id}/dismiss`),
    onSuccess: () => {
      qc.setQueryData<MyRecommendations>(lk.recommendations.me, (old) => (old ? { ...old, items: old.items.filter((x) => x.id !== r.id) } : old));
      toast.success("Recommendation dismissed", { description: "We'll use that to tune future suggestions." });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const skill = typeof r.data?.skill === "string" ? (r.data.skill as string) : null;
  const isPlan = r.kind === "revision_plan";
  return (
    <li className="group relative flex gap-3 rounded-2xl border border-slate-200 bg-white p-3.5 transition hover:border-slate-300 hover:shadow-soft">
      <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-white shadow-sm", c.gradient)}>
        <meta.icon className="size-[18px]" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={cn("text-2xs font-semibold uppercase tracking-wider", c.text)}>{meta.label}</span>
          {skill && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-2xs font-semibold text-slate-700">{skill}</span>}
        </div>
        {isPlan ? (
          <p className="mt-0.5 text-sm font-semibold text-slate-900">{r.title}</p>
        ) : (
          <Link href={href} className="mt-0.5 block text-sm font-semibold text-slate-900 after:absolute after:inset-0 hover:text-brand-700 focus-visible:outline-none">
            {r.title}
          </Link>
        )}
        <p className="mt-0.5 line-clamp-2 text-xs text-slate-600">{stripMd(r.reason)}</p>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        className="relative z-10 shrink-0 self-start text-slate-400 hover:text-slate-700"
        aria-label={`Dismiss: ${r.title}`}
        loading={dismiss.isPending}
        onClick={() => dismiss.mutate()}
      >
        <X />
      </Button>
    </li>
  );
}

export function RecommendationsPanel({ data, loading, refreshing, onRefresh }: { data: MyRecommendations | undefined; loading: boolean; refreshing: boolean; onRefresh: () => void }) {
  const items = [...(data?.items ?? [])].sort((a, b) => b.priority - a.priority);
  const [showAll, setShowAll] = React.useState(false);
  const shown = showAll ? items : items.slice(0, 6);
  return (
    <section className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-soft sm:p-6" aria-labelledby="recs-title">
      <SectionTitle
        id="recs-title"
        icon={Sparkles}
        color="fuchsia"
        title="Recommended next"
        description="Picked from your weakest skills and recent mistakes"
        action={
          <Button variant="ghost" size="sm" onClick={onRefresh} loading={refreshing}>
            Refresh
          </Button>
        }
      />
      <div className="mt-4" aria-live="polite">
        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 rounded-2xl" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState size="sm" illustration="rocket" title="No recommendations right now" description="Complete a quiz, assignment or simulation and we'll suggest what to do next." />
        ) : (
          <>
            <ul className="space-y-2">
              {shown.map((r) => (
                <RecommendationRow key={r.id} r={r} />
              ))}
            </ul>
            {items.length > 6 && (
              <Button variant="link" size="sm" className="mt-2" onClick={() => setShowAll((s) => !s)}>
                {showAll ? "Show fewer" : `Show all ${items.length}`}
              </Button>
            )}
          </>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ weak areas */

export function WeakAreas({ data }: { data: LearnerAnalytics }) {
  const bySkill = [...data.weak_areas.by_skill].filter((w) => w.incorrect > 0).sort((a, b) => (b.error_rate ?? 0) - (a.error_rate ?? 0)).slice(0, 6);
  const tags = [...data.weak_areas.by_tag].filter((w) => w.incorrect > 0).slice(0, 12);
  const missed = data.weak_areas.most_missed_questions.slice(0, 4);
  if (!bySkill.length && !tags.length && !missed.length)
    return (
      <section className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-soft sm:p-6">
        <SectionTitle icon={Target} color="rose" title="Weak areas" />
        <EmptyState size="sm" illustration="trophy" title="No weak areas detected" description="You haven't missed any questions recently. Keep it up!" />
      </section>
    );
  return (
    <section className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-soft sm:p-6" aria-labelledby="weak-title">
      <SectionTitle id="weak-title" icon={Target} color="rose" title="Weak areas" description="Where your answers go wrong most often" />
      {bySkill.length > 0 && (
        <ul className="mt-5 space-y-3" aria-label="Error rate by skill">
          {bySkill.map((w) => {
            const rate = w.error_rate ?? 0;
            return (
              <li key={w.skill_id}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate font-medium text-slate-800">{w.skill}</span>
                  <span className="shrink-0 text-xs text-slate-500">
                    <span className={cn("font-semibold tabular-nums", rate >= 50 ? "text-rose-700" : rate >= 25 ? "text-amber-800" : "text-slate-700")}>{Math.round(rate)}% missed</span> · {w.incorrect}/{w.answered}
                  </span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100" role="meter" aria-label={`${w.skill} error rate`} aria-valuenow={Math.round(rate)} aria-valuemin={0} aria-valuemax={100}>
                  <div className={cn("h-full rounded-full bg-gradient-to-r", rate >= 50 ? "from-rose-400 to-rose-600" : rate >= 25 ? "from-amber-400 to-orange-500" : "from-sky-400 to-indigo-500")} style={{ width: `${Math.max(3, rate)}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {tags.length > 0 && (
        <div className="mt-5">
          <p className="text-2xs font-semibold uppercase tracking-wider text-slate-500">Topics to revisit</p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {tags.map((t) => {
              const c = categoryClasses(t.tag);
              return (
                <li key={t.tag} className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset", c.soft, c.text, c.ring)}>
                  #{t.tag}
                  <span className="tabular-nums opacity-80">{Math.round(t.error_rate ?? 0)}%</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {missed.length > 0 && (
        <div className="mt-5">
          <p className="text-2xs font-semibold uppercase tracking-wider text-slate-500">Most-missed questions</p>
          <ul className="mt-2 space-y-2">
            {missed.map((q) => (
              <li key={q.question_id} className="flex gap-3 rounded-xl bg-rose-50/50 p-3 ring-1 ring-rose-100">
                <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-white font-display text-2xs font-bold text-rose-700 ring-1 ring-rose-200">
                  {q.incorrect}×
                </span>
                <p className="line-clamp-2 text-sm text-slate-700">{q.prompt ? stripMd(q.prompt) : "Question"}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ competencies */

export function Competencies({ items }: { items: MyCompetency[] }) {
  if (!items.length)
    return (
      <EmptyState
        bordered
        size="sm"
        illustration="shield"
        title="No competency frameworks yet"
        description="When your organisation defines competencies (groups of skills with target levels), you'll see your attainment here."
      />
    );
  return (
    <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {items.map((c, i) => {
        const color = c.attained ? "emerald" : (["indigo", "sky", "violet", "amber", "fuchsia", "teal"] as const)[i % 6]!;
        const cc = colorClasses(color);
        return (
          <li key={c.id} className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-soft">
            <div className="flex items-start gap-4">
              <ProgressRing value={c.progress_pct} size={64} stroke={7} color={color} aria-label={`${c.name}: ${Math.round(c.progress_pct)}% of requirements met`} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-display text-base font-semibold text-slate-900">{c.name}</h3>
                  {c.attained ? (
                    <Badge tone="success" size="sm">
                      <CheckCircle2 aria-hidden /> Attained
                    </Badge>
                  ) : (
                    <Badge tone="neutral" size="sm">
                      In progress
                    </Badge>
                  )}
                </div>
                {c.description && <p className="mt-1 line-clamp-2 text-sm text-slate-600">{c.description}</p>}
              </div>
            </div>
            <ul className="mt-4 space-y-2">
              {c.requirements.map((r) => (
                <li key={r.skill_id} className="text-sm">
                  <div className="flex items-center gap-2">
                    {r.met ? <CheckCircle2 className="size-4 shrink-0 text-emerald-600" aria-hidden /> : <Circle className="size-4 shrink-0 text-slate-300" aria-hidden />}
                    <span className="min-w-0 flex-1 truncate text-slate-800">{r.skill_name ?? "Skill"}</span>
                    <span className="shrink-0 text-xs tabular-nums text-slate-500">
                      {Math.round(r.proficiency)} / {Math.round(r.min_level)}
                    </span>
                    <span className="sr-only">{r.met ? "met" : "not yet met"}</span>
                  </div>
                  <div className="ml-6 mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                    <div className={cn("h-full rounded-full", r.met ? "bg-emerald-500" : cc.solid)} style={{ width: `${Math.min(100, (r.proficiency / Math.max(1, r.min_level)) * 100)}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}
