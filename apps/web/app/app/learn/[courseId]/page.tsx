"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Alert,
  Badge,
  Breadcrumbs,
  Button,
  Card,
  CategoryBadge,
  ConfirmDialog,
  EmptyState,
  ProgressRing,
  Skeleton,
  Tooltip,
  cn,
  colorClasses,
  colorFor,
  toast,
} from "@praxis/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Award, Bot, CheckCircle2, Clock, GraduationCap, Layers, ListChecks, RefreshCw, Sparkles, Target, Timer } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";
import { ErrorState } from "@/components/common/error-state";
import { lessonMeta } from "@/components/learn/meta";
import { StatusIcon, lessonStatus } from "@/components/learn/player/outline";
import { lk } from "@/components/learn/query-keys";
import type { LearnCourse } from "@/components/learn/types";
import { CourseCover, DifficultyMeter, DueChip, SectionTitle, SkillPills } from "@/components/learn/visuals";
import { ApiError, api, errorMessage } from "@/lib/api";
import { formatDate, formatMinutes, formatRelative } from "@/lib/format";

const TutorPanel = dynamic(() => import("@/components/tutor/tutor-panel").then((m) => m.TutorPanel), { ssr: false });

function OverviewSkeleton() {
  return (
    <div className="space-y-6" aria-busy aria-label="Loading course">
      <Skeleton className="h-64 rounded-3xl" />
      <div className="grid gap-6 lg:grid-cols-3">
        <Skeleton className="h-[28rem] rounded-2xl lg:col-span-2" />
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    </div>
  );
}

export default function CourseOverviewPage() {
  const { courseId } = useParams<{ courseId: string }>();
  const qc = useQueryClient();
  const [confirmUpgrade, setConfirmUpgrade] = React.useState(false);
  const [tutor, setTutor] = React.useState<boolean | null>(null);
  const q = useQuery({
    queryKey: lk.learn.course(courseId),
    queryFn: ({ signal }) => api.get<LearnCourse>(`/learn/${courseId}`, { signal }),
    retry: (n, err) => !(err instanceof ApiError && err.status < 500) && n < 2,
  });

  if (q.isLoading) return <OverviewSkeleton />;
  if (q.isError || !q.data) {
    if (q.error instanceof ApiError && q.error.status === 404)
      return (
        <EmptyState
          size="lg"
          illustration="learning"
          title="You're not enrolled in this course"
          description="Enrol from the catalog to start learning and track your progress."
          action={
            <Button asChild variant="gradient">
              <Link href={`/app/catalog/${courseId}`}>View in catalog</Link>
            </Button>
          }
        />
      );
    return <ErrorState error={q.error} onRetry={() => q.refetch()} size="lg" />;
  }

  const d = q.data;
  const course = d.course;
  const e = d.enrolment;
  const done = e.status === "completed";
  const color = colorFor(course.category);
  const c = colorClasses(color);
  const allLessons = d.modules.flatMap((m) => m.lessons);
  const totalMinutes = allLessons.reduce((a, l) => a + (l.duration_minutes || 0), 0);
  const byType = Object.entries(allLessons.reduce<Record<string, number>>((acc, l) => ({ ...acc, [l.lesson_type]: (acc[l.lesson_type] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);
  const nextHref = d.next_lesson ? `/app/learn/${courseId}/lesson/${d.next_lesson.id}` : allLessons[0] ? `/app/learn/${courseId}/lesson/${allLessons[0].id}` : null;
  const nextModule = d.modules.find((m) => m.lessons.some((l) => l.id === d.next_lesson?.id))?.id;
  const tutorEnabled = course.ai_tutor_enabled !== false;

  const upgrade = async () => {
    try {
      const fresh = await api.post<LearnCourse>(`/learn/${courseId}/upgrade`);
      qc.setQueryData(lk.learn.course(courseId), fresh);
      qc.invalidateQueries({ queryKey: lk.enrolments.all });
      qc.invalidateQueries({ queryKey: ["learn", courseId, "lesson"] });
      toast.success(`Upgraded to version ${fresh.version.version_number}`, { description: "Your progress on unchanged lessons was kept." });
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
    }
  };

  return (
    <div className="space-y-6">
      <Breadcrumbs linkComponent={Link} items={[{ label: "My learning", href: "/app/learning" }, { label: course.title ?? "Course" }]} />

      <section className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-soft">
        <div className="flex flex-col lg:flex-row">
          <CourseCover category={course.category} thumbnailUrl={course.thumbnail_url} iconSize="lg" className="h-36 shrink-0 lg:h-auto lg:w-72">
            {byType.length > 0 && (
              <ul className="absolute bottom-4 left-4 right-4 hidden flex-wrap gap-1.5 lg:flex" aria-label="Lesson formats">
                {byType.slice(0, 5).map(([type, n]) => {
                  const m = lessonMeta(type);
                  return (
                    <li key={type} className="inline-flex items-center gap-1.5 rounded-full bg-white/95 px-2.5 py-1 text-xs font-semibold text-slate-800 shadow-sm">
                      <m.icon className={cn("size-3.5", colorClasses(m.color).icon)} aria-hidden />
                      {n} {m.label.toLowerCase()}
                    </li>
                  );
                })}
              </ul>
            )}
          </CourseCover>
          <div className="flex flex-1 flex-col gap-6 p-6 sm:p-8 xl:flex-row xl:items-center">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                {course.category && <CategoryBadge category={course.category} />}
                <DifficultyMeter difficulty={course.difficulty} />
                <Badge tone="neutral" size="sm">
                  v{d.version.version_number}
                  {d.upgrade_available && d.latest_version_number ? ` · v${d.latest_version_number} available` : ""}
                </Badge>
                {e.source !== "self" && (
                  <Badge tone="violet" size="sm">
                    Assigned
                  </Badge>
                )}
              </div>
              <h1 className="mt-3 font-display text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{course.title}</h1>
              {course.subtitle && <p className="mt-1.5 text-slate-600">{course.subtitle}</p>}
              <dl className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-600">
                <div className="flex items-center gap-1.5">
                  <dt className="sr-only">Lessons completed</dt>
                  <Layers className="size-4 text-slate-400" aria-hidden />
                  <dd>
                    <strong className="text-slate-900">{d.stats.completed_lessons}</strong> / {d.stats.total_lessons} lessons
                  </dd>
                </div>
                {totalMinutes > 0 && (
                  <div className="flex items-center gap-1.5">
                    <dt className="sr-only">Duration</dt>
                    <Clock className="size-4 text-slate-400" aria-hidden />
                    <dd>{formatMinutes(totalMinutes)} total</dd>
                  </div>
                )}
                {e.time_spent_seconds > 0 && (
                  <div className="flex items-center gap-1.5">
                    <dt className="sr-only">Time spent</dt>
                    <Timer className="size-4 text-slate-400" aria-hidden />
                    <dd>{formatMinutes(e.time_spent_seconds / 60)} spent</dd>
                  </div>
                )}
                {e.last_accessed_at && (
                  <div className="flex items-center gap-1.5">
                    <dt className="sr-only">Last opened</dt>
                    <dd>Last opened {formatRelative(e.last_accessed_at)}</dd>
                  </div>
                )}
                {!done && e.due_date && (
                  <div>
                    <dt className="sr-only">Due</dt>
                    <dd>
                      <DueChip date={e.due_date} size="md" />
                    </dd>
                  </div>
                )}
              </dl>
              <div className="mt-5 flex flex-wrap gap-3">
                {nextHref && (
                  <Button asChild variant="gradient" size="lg" rightIcon={<ArrowRight />}>
                    <Link href={nextHref}>{done ? "Review from the start" : e.progress_pct > 0 ? `Continue: ${d.next_lesson?.title ?? "next lesson"}` : "Start course"}</Link>
                  </Button>
                )}
                {tutorEnabled && (
                  <Button size="lg" variant="soft" className="bg-fuchsia-50 text-fuchsia-700 hover:bg-fuchsia-100" leftIcon={<Bot />} onClick={() => setTutor(true)}>
                    Ask AI tutor
                  </Button>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-4 self-start rounded-2xl bg-slate-50 p-4 xl:flex-col xl:self-center xl:px-6">
              <ProgressRing value={e.progress_pct} size={104} stroke={10} color={done ? "emerald" : color} aria-label="Course progress" sublabel={done ? "done" : "complete"} />
              <div className="xl:text-center">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{done ? "Completed" : "Progress"}</p>
                <p className="text-sm text-slate-700">
                  {d.stats.completed_required}/{d.stats.required_lessons} required
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {d.upgrade_available && (
        <Alert
          tone="warning"
          icon={<RefreshCw aria-hidden />}
          title={`A new version of this course is available${d.latest_version_number ? ` (v${d.latest_version_number})` : ""}`}
          action={
            <Button size="sm" variant="primary" onClick={() => setConfirmUpgrade(true)}>
              Upgrade
            </Button>
          }
        >
          You&apos;re learning on version {d.version.version_number}. Upgrading keeps your progress on lessons that still exist.
        </Alert>
      )}

      {done && (
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-emerald-500 via-teal-500 to-sky-500 p-px shadow-soft">
          <div className="flex flex-col gap-4 rounded-[calc(1rem-1px)] bg-white p-5 sm:flex-row sm:items-center">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500 text-white">
              <Award className="size-6" aria-hidden />
            </span>
            <div className="flex-1">
              <p className="font-display text-lg font-semibold text-slate-900">You completed this course on {formatDate(e.completed_at)}</p>
              <p className="text-sm text-slate-600">
                {e.final_score !== null ? `Final score ${Math.round(e.final_score)}%. ` : ""}
                {course.certificate_enabled !== false ? "Your certificate is in your credentials." : "Revisit any lesson whenever you need a refresher."}
              </p>
            </div>
            {course.certificate_enabled !== false && (
              <Button asChild variant="success" leftIcon={<Award />}>
                <Link href="/app/certificates">View certificate</Link>
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card padded className="lg:col-span-2 lg:self-start">
          <SectionTitle
            icon={ListChecks}
            color="violet"
            title="Course content"
            description={`${d.modules.length} module${d.modules.length === 1 ? "" : "s"} · ${d.stats.total_lessons} lessons${course.sequential ? " · complete in order" : ""}`}
          />
          {d.modules.length === 0 ? (
            <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">This course version has no lessons yet.</p>
          ) : (
            <Accordion type="multiple" defaultValue={[nextModule ?? d.modules[0]!.id]} className="mt-3">
              {d.modules.map((m, mi) => {
                const doneCount = m.lessons.filter((l) => l.progress.status === "completed").length;
                const all = m.lessons.length > 0 && doneCount === m.lessons.length;
                const mins = m.lessons.reduce((a, l) => a + (l.duration_minutes || 0), 0);
                return (
                  <AccordionItem key={m.id} value={m.id}>
                    <AccordionTrigger>
                      <span className="flex min-w-0 flex-1 items-center gap-3">
                        <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl font-display text-sm font-bold text-white", all ? "bg-emerald-500" : cn("bg-gradient-to-br", c.gradient))}>
                          {all ? <CheckCircle2 className="size-4" aria-hidden /> : mi + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{m.title}</span>
                          <span className="mt-1 flex items-center gap-2 text-xs font-normal text-slate-500">
                            <span className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100 sm:w-28" aria-hidden>
                              <span className="block h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-500" style={{ width: `${m.lessons.length ? (doneCount / m.lessons.length) * 100 : 0}%` }} />
                            </span>
                            {doneCount}/{m.lessons.length} done{mins ? ` · ${formatMinutes(mins)}` : ""}
                          </span>
                        </span>
                      </span>
                    </AccordionTrigger>
                    <AccordionContent>
                      {m.description && <p className="mb-3 text-sm text-slate-600">{m.description}</p>}
                      <ol className="space-y-1">
                        {m.lessons.map((l) => {
                          const meta = lessonMeta(l.lesson_type);
                          const lc = colorClasses(meta.color);
                          const st = lessonStatus(l);
                          const isNext = l.id === d.next_lesson?.id;
                          const row = (
                            <>
                              <StatusIcon lesson={l} className="shrink-0" />
                              <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", lc.soft, lc.icon)}>
                                <meta.icon className="size-4" aria-hidden />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className={cn("block truncate text-sm", st === "completed" ? "text-slate-600" : "font-medium text-slate-900")}>{l.title}</span>
                                <span className="block truncate text-xs text-slate-500">
                                  {meta.label}
                                  {l.duration_minutes ? ` · ${formatMinutes(l.duration_minutes)}` : ""}
                                  {!l.is_required ? " · Optional" : ""}
                                  {l.linked?.pass_percentage ? ` · pass ${Math.round(Number(l.linked.pass_percentage))}%` : ""}
                                </span>
                              </span>
                              {isNext && !done && (
                                <Badge tone="brand" size="sm">
                                  Up next
                                </Badge>
                              )}
                            </>
                          );
                          return (
                            <li key={l.id}>
                              {st === "locked" ? (
                                <Tooltip content="Complete the earlier lessons first">
                                  <span className="flex cursor-not-allowed items-center gap-3 rounded-xl p-2 opacity-60" aria-disabled="true">
                                    {row}
                                  </span>
                                </Tooltip>
                              ) : (
                                <Link
                                  href={`/app/learn/${courseId}/lesson/${l.id}`}
                                  className={cn("flex items-center gap-3 rounded-xl p-2 transition hover:bg-slate-50 focus-visible:focus-ring", isNext && !done && "bg-brand-50/60 ring-1 ring-brand-100")}
                                >
                                  {row}
                                </Link>
                              )}
                            </li>
                          );
                        })}
                      </ol>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          )}
        </Card>

        <aside className="space-y-6">
          {(course.learning_objectives?.length ?? 0) > 0 && (
            <Card padded>
              <SectionTitle icon={Target} color="emerald" title="What you'll learn" />
              <ul className="mt-4 space-y-2.5">
                {course.learning_objectives!.map((o, i) => (
                  <li key={i} className="flex gap-2.5 text-sm text-slate-700">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
                    {String(o)}
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {(course.skills?.length ?? 0) > 0 && (
            <Card padded>
              <SectionTitle icon={GraduationCap} color="teal" title="Skills" />
              <SkillPills skills={course.skills!} max={12} className="mt-4" />
            </Card>
          )}
          {course.certificate_enabled !== false && (
            <Card padded className="bg-gradient-to-br from-amber-50 via-white to-white">
              <SectionTitle icon={Award} color="amber" title="Certificate" />
              <p className="mt-3 text-sm text-slate-600">
                Complete all required lessons{course.pass_threshold ? ` and score at least ${Math.round(course.pass_threshold)}% on graded work` : ""} to earn a verifiable certificate.
              </p>
            </Card>
          )}
          {tutorEnabled && (
            <section className="rounded-2xl bg-gradient-to-br from-brand-500 via-violet-500 to-fuchsia-500 p-px shadow-soft">
              <div className="rounded-[calc(1rem-1px)] bg-white p-5">
                <SectionTitle icon={Sparkles} color="fuchsia" title="Stuck on something?" description="Your AI tutor knows this course" />
                <Button variant="soft" className="mt-4 bg-fuchsia-50 text-fuchsia-700 hover:bg-fuchsia-100" leftIcon={<Bot />} onClick={() => setTutor(true)}>
                  Ask a question
                </Button>
              </div>
            </section>
          )}
        </aside>
      </div>

      <ConfirmDialog
        open={confirmUpgrade}
        onOpenChange={setConfirmUpgrade}
        title={`Upgrade to version ${d.latest_version_number ?? "latest"}?`}
        description="You'll switch to the newest published content. Progress on lessons that exist in both versions is kept; lessons removed in the new version no longer count."
        confirmLabel="Upgrade course"
        onConfirm={upgrade}
      />
      {tutorEnabled && tutor !== null && <TutorPanel courseId={courseId} open={tutor} onOpenChange={setTutor} />}
    </div>
  );
}
