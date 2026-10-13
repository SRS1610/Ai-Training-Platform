"use client";

import type {
  ActivityItem,
  CertificateSummary,
  CurrentCourse,
  LearnerDashboard,
  Recommendation,
  SimulationResult,
  SkillProficiency,
  UpcomingDeadline,
} from "@praxis/types";
import {
  Badge,
  BandChip,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CategoryBadge,
  EmptyState,
  KpiTile,
  Progress,
  ProgressRing,
  StreakFlame,
  bandMeta,
  categoryClasses,
  cn,
  colorClasses,
  colorFor,
  humanize,
} from "@praxis/ui";
import { ActivityHeatmap, SkillRadarChart } from "@praxis/ui/charts";
import {
  ArrowRight,
  Award,
  BookOpen,
  Bot,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Code2,
  FileText,
  Gauge,
  HelpCircle,
  Layers,
  MonitorPlay,
  PlayCircle,
  QrCode,
  Sparkles,
  Target,
  Theater,
  Timer,
  TrendingUp,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { daysUntil, firstName, formatDate, formatMinutes, formatRelative, greeting } from "@/lib/format";

/* ------------------------------------------------------------------ helpers */

const LESSON_ICONS: Record<string, LucideIcon> = {
  video: PlayCircle,
  text: FileText,
  pdf: FileText,
  code: Code2,
  flashcards: Layers,
  scenario: Theater,
  quiz: HelpCircle,
  assessment: HelpCircle,
  assignment: ClipboardCheck,
  simulation: MonitorPlay,
};

export function lessonIcon(type: string | null | undefined): LucideIcon {
  return LESSON_ICONS[(type ?? "").toLowerCase()] ?? BookOpen;
}

function courseHref(c: CurrentCourse) {
  return c.next_lesson ? `/app/learn/${c.course_id}/lesson/${c.next_lesson.id}` : `/app/learn/${c.course_id}`;
}

function DueChip({ date, status }: { date: string | null | undefined; status?: string }) {
  const d = daysUntil(date);
  if (d === null) return null;
  const overdue = d < 0 || status === "overdue";
  const soon = !overdue && d <= 3;
  const label = overdue ? `Overdue ${Math.abs(d)}d` : d === 0 ? "Due today" : d === 1 ? "Due tomorrow" : `Due in ${d}d`;
  return (
    <Badge tone={overdue ? "danger" : soon ? "warning" : "info"} size="sm">
      <CalendarClock aria-hidden />
      {label}
    </Badge>
  );
}

function SectionCard({
  title,
  icon,
  color = "indigo",
  action,
  children,
  className,
  description,
}: {
  title: React.ReactNode;
  icon: LucideIcon;
  color?: Parameters<typeof colorClasses>[0];
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  description?: React.ReactNode;
}) {
  const c = colorClasses(color);
  const Icon = icon;
  return (
    <Card className={cn("flex min-w-0 flex-col", className)}>
      <CardHeader className="min-w-0">
        <div className="flex min-w-0 items-center gap-3">
          <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", c.soft, c.icon)}>
            <Icon className="size-[18px]" aria-hidden />
          </span>
          <div className="min-w-0">
            <CardTitle as="h2" className="break-words">
              {title}
            </CardTitle>
            {description && <p className="break-words text-xs text-muted-foreground">{description}</p>}
          </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </CardHeader>
      <CardContent className="min-w-0 flex-1">{children}</CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ hero */

export function DashboardHero({
  name,
  data,
  weeklyGoal,
  welcome,
}: {
  name: string | undefined;
  data: LearnerDashboard;
  weeklyGoal: number;
  welcome?: boolean;
}) {
  const s = data.stats;
  const resume = data.current_courses.find((c) => c.next_lesson) ?? data.current_courses[0];
  const goalPct = Math.min(100, Math.round((s.learning_minutes_week / Math.max(1, weeklyGoal)) * 100));
  return (
    <section
      aria-labelledby="dash-greeting"
      className="relative overflow-hidden rounded-3xl bg-brand-gradient p-6 text-white shadow-glow sm:p-8"
    >
      <div className="pointer-events-none absolute inset-0 bg-grid-faint opacity-30 [background-size:32px_32px]" aria-hidden />
      <div className="pointer-events-none absolute -right-10 -top-16 size-72 rounded-full bg-fuchsia-400/30 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute -bottom-24 left-1/3 size-72 rounded-full bg-sky-400/25 blur-3xl" aria-hidden />
      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 max-w-2xl">
          <p className="text-sm font-medium text-indigo-100">{welcome ? "Welcome to Praxis 🎉" : formatDate(new Date(), { weekday: "long", day: "numeric", month: "long" })}</p>
          <h1 id="dash-greeting" className="mt-1 font-display text-3xl font-bold tracking-tight sm:text-4xl">
            {greeting()}, {firstName(name)}
          </h1>
          <p className="mt-2 text-indigo-100">
            {s.streak_days > 0 ? (
              <>
                You&apos;re on a <strong className="text-white">{s.streak_days}-day streak</strong>. Keep the momentum going!
              </>
            ) : resume ? (
              <>Pick up where you left off — a few minutes today starts a new streak.</>
            ) : (
              <>Let&apos;s find your first course and start building skills you can prove.</>
            )}
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            {resume ? (
              <Button asChild variant="white" size="lg" rightIcon={<ArrowRight />} className="max-w-full">
                <Link href={courseHref(resume)}>
                  <span className="min-w-0 truncate">
                    {resume.next_lesson ? `Resume: ${resume.next_lesson.title}` : `Continue ${resume.title}`}
                  </span>
                </Link>
              </Button>
            ) : (
              <Button asChild variant="white" size="lg" rightIcon={<ArrowRight />}>
                <Link href="/app/catalog">Browse the catalog</Link>
              </Button>
            )}
            <Button asChild size="lg" className="bg-white/10 text-white ring-1 ring-white/30 hover:bg-white/20" leftIcon={<Bot />}>
              <Link href="/app/tutor">Ask the AI tutor</Link>
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-4 self-start rounded-2xl bg-white/10 p-4 ring-1 ring-white/20 backdrop-blur lg:self-auto">
          <div className="rounded-full bg-white p-1.5">
            <ProgressRing value={goalPct} size={84} stroke={9} aria-label="Weekly learning goal" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-indigo-100">Weekly goal</p>
            <p className="mt-0.5 font-display text-2xl font-bold">
              {formatMinutes(s.learning_minutes_week)}
              <span className="text-base font-medium text-indigo-200"> / {formatMinutes(weeklyGoal)}</span>
            </p>
            <p className="mt-0.5 flex items-center gap-1.5 text-sm text-indigo-100">
              <StreakFlame days={s.streak_days} size={20} />
              {s.streak_days} day streak · best {s.longest_streak}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ KPIs */

export function KpiRow({ data }: { data: LearnerDashboard }) {
  const s = data.stats;
  return (
    <section aria-label="Your stats" className="stagger grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-6">
      <KpiTile label="In progress" value={s.courses_in_progress} icon={<BookOpen />} color="sky" hint="Active courses" />
      <KpiTile label="Completed" value={s.courses_completed} icon={<CheckCircle2 />} color="emerald" hint="Courses finished" />
      <KpiTile label="Certificates" value={s.certificates} icon={<Award />} color="amber" hint="Credentials earned" />
      <KpiTile
        label="Streak"
        value={
          <span className="inline-flex items-center gap-1">
            {s.streak_days}
            <StreakFlame days={s.streak_days} size={26} />
          </span>
        }
        icon={<TrendingUp />}
        color="orange"
        hint={`Longest: ${s.longest_streak} days`}
      />
      <KpiTile
        label="Avg. score"
        value={s.average_score === null ? "—" : `${Math.round(s.average_score)}%`}
        icon={<Target />}
        color="violet"
        hint={s.average_score === null ? "No graded work yet" : "Across assessments"}
      />
      <KpiTile label="This week" value={formatMinutes(s.learning_minutes_week)} icon={<Clock />} color="fuchsia" hint="Time learning" />
    </section>
  );
}

/* ------------------------------------------------------------------ continue learning */

function CourseCard({ course }: { course: CurrentCourse }) {
  const c = categoryClasses(course.category);
  const LessonIcon = lessonIcon(course.next_lesson?.lesson_type);
  const started = course.progress_pct > 0;
  return (
    <article className="group relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-soft transition duration-300 ease-spring hover:-translate-y-1 hover:shadow-lift">
      <div className="relative">
        <div className={cn("relative h-28 overflow-hidden bg-gradient-to-br", c.gradient)}>
          {course.thumbnail_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={course.thumbnail_url} alt="" className="size-full object-cover transition duration-500 group-hover:scale-105" />
          ) : (
            <>
              <div className="absolute -right-6 -top-8 size-32 rounded-full bg-white/20 transition duration-500 group-hover:scale-110" aria-hidden />
              <div className="absolute -bottom-10 left-6 size-24 rounded-full bg-white/10" aria-hidden />
              <BookOpen className="absolute left-5 top-5 size-8 text-white/90" aria-hidden />
            </>
          )}
        </div>
        <div className="absolute bottom-0 right-4 translate-y-1/2 rounded-full bg-white p-1 shadow-soft">
          <ProgressRing value={course.progress_pct} size={56} stroke={6} color={course.category ? colorFor(course.category) : "brand"} aria-label={`${course.title} progress`} />
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col p-4 pt-3">
        <div className="flex flex-wrap items-center gap-1.5 pr-16">
          {course.category && <CategoryBadge category={course.category} size="sm" />}
          {course.difficulty && (
            <Badge size="sm" tone="neutral">
              {humanize(course.difficulty)}
            </Badge>
          )}
        </div>
        <h3 className="mt-2 line-clamp-2 font-display text-base font-semibold leading-snug text-slate-900">
          <Link href={courseHref(course)} className="after:absolute after:inset-0 focus-visible:outline-none">
            {course.title}
          </Link>
        </h3>
        {course.next_lesson ? (
          <p className="mt-2 flex min-w-0 items-center gap-2 text-sm text-slate-600">
            <span className={cn("grid size-6 shrink-0 place-items-center rounded-md", c.soft, c.icon)}>
              <LessonIcon className="size-3.5" aria-hidden />
            </span>
            <span className="truncate">
              <span className="sr-only">Next lesson: </span>
              {course.next_lesson.title}
            </span>
          </p>
        ) : (
          <p className="mt-2 text-sm text-slate-500">{course.status === "completed" ? "Completed — review anytime" : "Open the course to continue"}</p>
        )}
        <div className="mt-auto flex items-center justify-between gap-2 pt-4">
          <DueChip date={course.due_date} status={course.status} />
          <span className="ml-auto inline-flex items-center gap-1 text-sm font-semibold text-brand-700 transition group-hover:gap-2">
            {started ? "Continue" : "Start"} <ArrowRight className="size-4" aria-hidden />
          </span>
        </div>
      </div>
    </article>
  );
}

export function ContinueLearning({ courses, className }: { courses: CurrentCourse[]; className?: string }) {
  return (
    <SectionCard
      className={className}
      title="Continue learning"
      icon={PlayCircle}
      color="indigo"
      description={`${courses.length} active course${courses.length === 1 ? "" : "s"}`}
      action={
        <Button asChild variant="ghost" size="sm" rightIcon={<ArrowRight />}>
          <Link href="/app/learning">My learning</Link>
        </Button>
      }
    >
      {courses.length === 0 ? (
        <EmptyState
          size="sm"
          illustration="learning"
          title="No courses in progress"
          description="Find something new to learn in the catalog."
          action={
            <Button asChild variant="gradient" size="sm">
              <Link href="/app/catalog">Browse catalog</Link>
            </Button>
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-3">
          {courses.slice(0, 6).map((c) => (
            <li key={c.enrolment_id} className="relative min-w-0">
              <CourseCard course={c} />
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ deadlines */

export function DeadlinesTimeline({ items, className }: { items: UpcomingDeadline[]; className?: string }) {
  const overdue = items.filter((d) => (daysUntil(d.due_at) ?? 0) < 0 || d.status === "overdue").length;
  const week = items.filter((d) => {
    const n = daysUntil(d.due_at) ?? 99;
    return n >= 0 && n <= 7 && d.status !== "overdue";
  }).length;
  return (
    <SectionCard className={className} title="Upcoming deadlines" icon={CalendarClock} color="rose" description="Next 30 days">
      {items.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {overdue > 0 && (
            <Badge tone="danger" dot>
              {overdue} overdue
            </Badge>
          )}
          <Badge tone="warning" dot>
            {week} this week
          </Badge>
          <Badge tone="info" dot>
            {items.length - overdue - week} later
          </Badge>
        </div>
      )}
      {items.length === 0 ? (
        <EmptyState size="sm" illustration="inbox" title="Nothing due" description="You're all clear. Enjoy the breathing room!" />
      ) : (
        <ol className="relative space-y-1">
          {items.slice(0, 6).map((d, i) => {
            const days = daysUntil(d.due_at);
            const overdue = (days ?? 0) < 0 || d.status === "overdue";
            const soon = !overdue && (days ?? 99) <= 3;
            const dot = overdue ? "bg-rose-500 ring-rose-100" : soon ? "bg-amber-500 ring-amber-100" : "bg-sky-500 ring-sky-100";
            const Icon = d.type === "assignment" ? ClipboardCheck : BookOpen;
            const href = d.type === "assignment" ? `/app/assignments/${d.id}` : `/app/learn/${d.course_id ?? d.id}`;
            return (
              <li key={`${d.type}-${d.id}`} className="relative flex gap-3 pb-3">
                {i < Math.min(items.length, 6) - 1 && <span className="absolute left-[7px] top-5 h-full w-px bg-slate-200" aria-hidden />}
                <span className={cn("relative mt-1.5 size-[15px] shrink-0 rounded-full ring-4", dot)} aria-hidden />
                <Link href={href} className="-m-1.5 min-w-0 flex-1 rounded-xl p-1.5 transition hover:bg-slate-50 focus-visible:focus-ring">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                    <Icon className="size-3.5 shrink-0 text-slate-400" aria-hidden />
                    <span className="truncate">{d.title}</span>
                  </p>
                  {d.course_title && d.type === "assignment" && <p className="truncate text-xs text-slate-500">{d.course_title}</p>}
                  <p className={cn("mt-0.5 text-xs font-medium", overdue ? "text-rose-700" : soon ? "text-amber-800" : "text-slate-600")}>
                    {overdue ? "Overdue · " : ""}
                    {formatDate(d.due_at, { weekday: "short", day: "numeric", month: "short" })} · {formatRelative(d.due_at)}
                  </p>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ skills */

export function SkillsPanel({ skills }: { skills: SkillProficiency[] }) {
  const top = [...skills].sort((a, b) => b.proficiency - a.proficiency).slice(0, 8);
  return (
    <SectionCard
      title="Skills"
      icon={Target}
      color="teal"
      description="Your competency profile"
      action={
        <Button asChild variant="ghost" size="sm">
          <Link href="/app/skills">View all</Link>
        </Button>
      }
    >
      {skills.length === 0 ? (
        <EmptyState size="sm" illustration="chart" title="No skills tracked yet" description="Complete lessons and simulations to build your profile." />
      ) : (
        <>
          {top.length >= 3 && (
            <SkillRadarChart
              height={220}
              data={top.slice(0, 6).map((s) => ({ subject: s.name.length > 12 ? `${s.name.slice(0, 11)}…` : s.name, value: Math.round(s.proficiency) }))}
              aria-label="Skill proficiency radar chart"
            />
          )}
          <ul className="mt-2 space-y-3">
            {top.slice(0, 5).map((s) => {
              const color = categoryClasses(s.category ?? s.name);
              return (
                <li key={s.skill_id}>
                  <div className="mb-1 flex min-w-0 items-center justify-between gap-3 text-sm">
                    <span className="flex min-w-0 items-center gap-2 text-slate-700">
                      <span className={cn("size-2 shrink-0 rounded-full", color.solid)} aria-hidden />
                      <span className="truncate">{s.name}</span>
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums text-slate-900">{Math.round(s.proficiency)}%</span>
                  </div>
                  <Progress value={s.proficiency} color={colorFor(s.category ?? s.name)} size="sm" aria-label={`${s.name} proficiency`} />
                </li>
              );
            })}
          </ul>
        </>
      )}
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ simulations */

export function SimulationResults({ results }: { results: SimulationResult[] }) {
  return (
    <SectionCard
      title="Simulation results"
      icon={Gauge}
      color="violet"
      description="Your latest performance"
      action={
        <Button asChild variant="ghost" size="sm">
          <Link href="/app/simulations">Practise</Link>
        </Button>
      }
    >
      {results.length === 0 ? (
        <EmptyState
          size="sm"
          illustration="rocket"
          title="No simulations yet"
          description="Put your skills to work in a realistic scenario."
          action={
            <Button asChild variant="soft" size="sm">
              <Link href="/app/simulations">Try a simulation</Link>
            </Button>
          }
        />
      ) : (
        <ul className="space-y-2.5">
          {results.slice(0, 5).map((r) => {
            const meta = bandMeta(r.band);
            const c = colorClasses(meta.color);
            return (
              <li key={r.session_id}>
                <Link href={`/app/simulations/session/${r.session_id}`} className="flex min-w-0 items-center gap-3 rounded-xl border border-slate-100 p-2.5 transition hover:border-slate-200 hover:bg-slate-50 focus-visible:focus-ring">
                  <span className={cn("grid size-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br font-display text-sm font-bold text-white", c.gradient)}>
                    {Math.round(r.total_score)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-900">{r.title}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-2">
                      <BandChip band={r.band} size="sm" />
                      <span className="text-xs text-slate-500">{formatRelative(r.completed_at)}</span>
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ recommendations */

export function Recommendations({ items, className }: { items: Recommendation[]; className?: string }) {
  const href = (r: Recommendation) =>
    r.target_type === "simulation" && r.target_id
      ? `/app/simulations/${r.target_id}`
      : r.target_type === "lesson" && r.course_id && r.target_id
        ? `/app/learn/${r.course_id}/lesson/${r.target_id}`
        : r.course_id
          ? `/app/learn/${r.course_id}`
          : r.target_type === "course" && r.target_id
            ? `/app/learn/${r.target_id}`
            : "/app/catalog";
  const colors = ["fuchsia", "sky", "emerald", "amber"] as const;
  return (
    <section aria-labelledby="recs-title" className={cn("rounded-2xl bg-gradient-to-br from-brand-500 via-violet-500 to-fuchsia-500 p-px shadow-soft", className)}>
      <div className="flex h-full flex-col rounded-[calc(1.125rem-1px)] bg-white p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-xl bg-brand-gradient text-white shadow-glow">
            <Sparkles className="size-[18px]" aria-hidden />
          </span>
          <div>
            <h2 id="recs-title" className="font-display text-base font-semibold text-slate-900">
              Recommended for you
            </h2>
            <p className="text-xs text-muted-foreground">Personalised by Praxis AI</p>
          </div>
        </div>
        {items.length === 0 ? (
          <p className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
            Complete a quiz or simulation and we&apos;ll suggest what to focus on next.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {items.slice(0, 4).map((r, i) => {
              const c = colorClasses(colors[i % colors.length]!);
              return (
                <li key={r.id} className={cn("rounded-xl border p-3.5", c.border, "bg-gradient-to-br", c.tint)}>
                  <p className="text-sm font-semibold text-slate-900">{r.title}</p>
                  <p className="mt-1 text-sm text-slate-600">
                    <span className="font-medium text-slate-700">Your performance indicates </span>
                    {r.reason.replace(/^your performance indicates\s*/i, "")}
                  </p>
                  <Link href={href(r)} className={cn("mt-2 inline-flex items-center gap-1 text-sm font-semibold hover:gap-2", c.text)}>
                    {r.kind === "simulation" ? "Practise now" : r.kind === "review" ? "Review" : "Start"} <ArrowRight className="size-3.5" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ activity */

const ACTIVITY_META: Record<string, { icon: LucideIcon; color: Parameters<typeof colorClasses>[0] }> = {
  lesson_completed: { icon: CheckCircle2, color: "emerald" },
  course_completed: { icon: Trophy, color: "amber" },
  course_enrolled: { icon: BookOpen, color: "sky" },
  enrolled: { icon: BookOpen, color: "sky" },
  assessment_passed: { icon: Award, color: "emerald" },
  assessment_failed: { icon: HelpCircle, color: "rose" },
  quiz_attempt: { icon: HelpCircle, color: "violet" },
  simulation_completed: { icon: MonitorPlay, color: "violet" },
  submission: { icon: ClipboardCheck, color: "orange" },
  certificate_issued: { icon: Award, color: "amber" },
};

export function RecentActivity({ items }: { items: ActivityItem[] }) {
  return (
    <SectionCard title="Recent activity" icon={Timer} color="sky">
      {items.length === 0 ? (
        <EmptyState size="sm" illustration="chart" title="No activity yet" description="Your learning history will appear here." />
      ) : (
        <ul className="space-y-1">
          {items.slice(0, 7).map((a, i) => {
            const meta = ACTIVITY_META[a.type] ?? { icon: Sparkles, color: "indigo" as const };
            const c = colorClasses(meta.color);
            const Icon = meta.icon;
            const body = (
              <>
                <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", c.soft, c.icon)}>
                  <Icon className="size-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-slate-800">{a.title}</span>
                  <span className="block text-xs text-slate-500">
                    {humanize(a.type)} · {formatRelative(a.at)}
                  </span>
                </span>
              </>
            );
            return (
              <li key={`${a.at}-${i}`}>
                {a.link ? (
                  <Link href={a.link} className="flex min-w-0 items-center gap-3 rounded-xl p-2 transition hover:bg-slate-50 focus-visible:focus-ring">
                    {body}
                  </Link>
                ) : (
                  <div className="flex items-center gap-3 p-2">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}

export function HeatmapCard({ days, stats }: { days: LearnerDashboard["activity_heatmap"]; stats: LearnerDashboard["stats"] }) {
  const active = days.filter((d) => d.seconds > 0);
  const best = active.reduce<{ day: string; seconds: number } | null>((b, d) => (!b || d.seconds > b.seconds ? d : b), null);
  const avg = active.length ? Math.round(active.reduce((a, d) => a + d.seconds, 0) / active.length / 60) : 0;
  const tiles: { label: string; value: string; color: Parameters<typeof colorClasses>[0] }[] = [
    { label: "Current streak", value: `${stats.streak_days} days`, color: "orange" },
    { label: "Longest streak", value: `${stats.longest_streak} days`, color: "rose" },
    { label: "Avg. per active day", value: formatMinutes(avg), color: "violet" },
    { label: "Best day", value: best ? `${formatMinutes(Math.round(best.seconds / 60))} · ${formatDate(best.day, { day: "numeric", month: "short" })}` : "—", color: "sky" },
  ];
  return (
    <SectionCard title="Learning activity" icon={TrendingUp} color="fuchsia" description="Last 12 weeks">
      <div className="flex min-w-0 flex-col gap-6 lg:flex-row lg:items-start">
        <div className="min-w-0 overflow-x-auto scrollbar-thin lg:w-auto lg:shrink-0">
          <ActivityHeatmap days={days} weeks={12} />
        </div>
        <ul className="grid min-w-0 flex-1 grid-cols-2 gap-3">
          {tiles.map((t) => {
            const c = colorClasses(t.color);
            return (
              <li key={t.label} className={cn("min-w-0 rounded-xl border bg-gradient-to-br p-3", c.border, c.tint)}>
                <p className="text-2xs font-semibold uppercase tracking-wider text-slate-500">{t.label}</p>
                <p className={cn("mt-1 break-words font-display text-lg font-bold", c.text)}>{t.value}</p>
              </li>
            );
          })}
        </ul>
      </div>
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ certificates */

export function CertificatesStrip({ certificates }: { certificates: CertificateSummary[] }) {
  const palette = ["amber", "violet", "emerald", "sky", "rose", "teal"] as const;
  return (
    <SectionCard
      title="Certificates"
      icon={Award}
      color="amber"
      description="Verifiable credentials you've earned"
      action={
        <Button asChild variant="ghost" size="sm">
          <Link href="/app/certificates">View all</Link>
        </Button>
      }
    >
      {certificates.length === 0 ? (
        <EmptyState size="sm" illustration="trophy" title="Your first certificate is waiting" description="Complete a course to earn a verifiable credential." />
      ) : (
        <ul className="-mx-1 flex snap-x gap-4 overflow-x-auto px-1 pb-2 scrollbar-thin">
          {certificates.map((cert, i) => {
            const c = colorClasses(palette[i % palette.length]!);
            return (
              <li key={cert.id} className="w-64 shrink-0 snap-start">
                <Link
                  href={`/verify/${encodeURIComponent(cert.certificate_number)}`}
                  className={cn("relative block overflow-hidden rounded-2xl border p-4 transition hover:-translate-y-0.5 hover:shadow-lift focus-visible:focus-ring", c.border, "bg-gradient-to-br", c.tint)}
                >
                  <div className={cn("absolute -right-6 -top-6 size-20 rounded-full bg-gradient-to-br opacity-30", c.gradient)} aria-hidden />
                  <span className={cn("grid size-10 place-items-center rounded-xl bg-gradient-to-br text-white shadow-sm", c.gradient)}>
                    <Award className="size-5" aria-hidden />
                  </span>
                  <p className="mt-3 line-clamp-2 font-display text-sm font-semibold text-slate-900">{cert.course_title}</p>
                  <p className="mt-1 text-xs text-slate-500">Issued {formatDate(cert.issued_at)}</p>
                  <p className="mt-3 flex items-center gap-1.5 font-mono text-2xs text-slate-600">
                    <QrCode className="size-3.5" aria-hidden />
                    {cert.certificate_number}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ new user */

export function WelcomePanel({ emailVerified, mfaEnabled }: { emailVerified: boolean; mfaEnabled: boolean }) {
  const steps = [
    { done: true, title: "Create your account", body: "You're in. Nice!", href: "/app/profile", color: "emerald" as const, icon: CheckCircle2 },
    { done: false, title: "Enrol in your first course", body: "Browse the catalog and pick a topic.", href: "/app/catalog", color: "indigo" as const, icon: BookOpen },
    { done: false, title: "Meet your AI tutor", body: "Ask anything — it cites its sources.", href: "/app/tutor", color: "fuchsia" as const, icon: Bot },
    { done: false, title: "Try a simulation", body: "Practise a real scenario safely.", href: "/app/simulations", color: "violet" as const, icon: MonitorPlay },
    {
      done: emailVerified && mfaEnabled,
      title: "Secure your account",
      body: mfaEnabled ? "Two-step verification is on." : "Turn on two-step verification.",
      href: "/app/profile/security",
      color: "amber" as const,
      icon: Award,
    },
  ];
  const done = steps.filter((s) => s.done).length;
  return (
    <Card className="overflow-hidden">
      <div className="grid gap-0 lg:grid-cols-[1fr_1.3fr]">
        <div className="flex flex-col items-center justify-center bg-gradient-to-br from-brand-50 via-violet-50 to-fuchsia-50 p-8 text-center">
          <EmptyState
            size="lg"
            illustration="learning"
            title="Your learning journey starts here"
            description="Enrol in a course to see your progress, deadlines and personalised recommendations on this dashboard."
            action={
              <Button asChild variant="gradient" size="lg" rightIcon={<ArrowRight />}>
                <Link href="/app/catalog">Explore the catalog</Link>
              </Button>
            }
            className="py-4"
          />
        </div>
        <div className="p-6 sm:p-8">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold text-slate-900">Get started</h2>
            <span className="text-sm font-medium text-slate-500">
              {done} of {steps.length} done
            </span>
          </div>
          <Progress value={(done / steps.length) * 100} className="mt-3" size="sm" aria-label="Getting started progress" />
          <ol className="mt-5 space-y-2.5">
            {steps.map((s) => {
              const c = colorClasses(s.color);
              const Icon = s.icon;
              return (
                <li key={s.title}>
                  <Link href={s.href} className="flex items-center gap-3 rounded-xl border border-slate-100 p-3 transition hover:border-slate-200 hover:bg-slate-50 focus-visible:focus-ring">
                    <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", s.done ? "bg-emerald-500 text-white" : cn("bg-gradient-to-br text-white", c.gradient))}>
                      {s.done ? <CheckCircle2 className="size-4" aria-hidden /> : <Icon className="size-4" aria-hidden />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn("block text-sm font-semibold", s.done ? "text-slate-500 line-through" : "text-slate-900")}>{s.title}</span>
                      <span className="block text-xs text-slate-500">{s.body}</span>
                    </span>
                    {!s.done && <ArrowRight className="size-4 text-slate-400" aria-hidden />}
                    <span className="sr-only">{s.done ? "(done)" : "(to do)"}</span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </Card>
  );
}
