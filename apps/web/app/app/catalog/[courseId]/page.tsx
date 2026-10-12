"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Badge,
  Breadcrumbs,
  Button,
  Card,
  CategoryBadge,
  EmptyState,
  Progress,
  Skeleton,
  cn,
  colorClasses,
  colorFor,
  toast,
} from "@praxis/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Award,
  BadgeCheck,
  BookOpen,
  CheckCircle2,
  Clock,
  Eye,
  GraduationCap,
  Layers,
  ListChecks,
  Lock,
  PlayCircle,
  Target,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ErrorState } from "@/components/common/error-state";
import { Markdown } from "@/components/common/markdown";
import { lessonMeta } from "@/components/learn/meta";
import { lk } from "@/components/learn/query-keys";
import type { CatalogDetail, EnrolmentOut } from "@/components/learn/types";
import { CourseCover, DifficultyMeter, DueChip, SectionTitle, SkillPills } from "@/components/learn/visuals";
import { ApiError, api, errorMessage } from "@/lib/api";
import { usePermission } from "@/lib/auth";
import { formatDate, formatMinutes } from "@/lib/format";

function DetailSkeleton() {
  return (
    <div className="space-y-6" aria-busy aria-label="Loading course">
      <Skeleton className="h-4 w-48" />
      <Skeleton className="h-72 rounded-3xl" />
      <div className="grid gap-6 lg:grid-cols-3">
        <Skeleton className="h-96 rounded-2xl lg:col-span-2" />
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    </div>
  );
}

export default function CourseDetailPage() {
  const { courseId } = useParams<{ courseId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const canLearn = usePermission("learning.access");
  const q = useQuery({
    queryKey: lk.catalog.detail(courseId),
    queryFn: ({ signal }) => api.get<CatalogDetail>(`/catalog/${courseId}`, { signal }),
  });
  const course = q.data;
  const firstLesson = course?.outline.find((m) => m.lessons.length)?.lessons[0];

  const enrol = useMutation({
    mutationFn: () => api.post<EnrolmentOut>("/enrolments", { course_id: courseId }),
    onSuccess: () => {
      toast.success("You're enrolled — let's get started!");
      qc.invalidateQueries({ queryKey: lk.catalog.all });
      qc.invalidateQueries({ queryKey: lk.enrolments.all });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      router.push(firstLesson ? `/app/learn/${courseId}/lesson/${firstLesson.id}` : `/app/learn/${courseId}`);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === "already_enrolled") {
        router.push(`/app/learn/${courseId}`);
        return;
      }
      toast.error(errorMessage(err));
    },
  });

  if (q.isLoading) return <DetailSkeleton />;
  if (q.isError || !course)
    return q.error instanceof ApiError && q.error.status === 404 ? (
      <EmptyState
        size="lg"
        illustration="search"
        title="This course isn't in the catalog"
        description="It may have been archived or unpublished."
        action={
          <Button asChild variant="gradient">
            <Link href="/app/catalog">Back to the catalog</Link>
          </Button>
        }
      />
    ) : (
      <ErrorState error={q.error} onRetry={() => q.refetch()} size="lg" />
    );

  const e = course.enrolment;
  const done = e?.status === "completed";
  const color = colorFor(course.category);
  const c = colorClasses(color);
  const lessons = course.outline.flatMap((m) => m.lessons);
  const byType = Object.entries(
    lessons.reduce<Record<string, number>>((acc, l) => ({ ...acc, [l.lesson_type]: (acc[l.lesson_type] ?? 0) + 1 }), {}),
  ).sort((a, b) => b[1] - a[1]);
  const totalMinutes = course.duration_minutes || lessons.reduce((a, l) => a + (l.duration_minutes || 0), 0);

  const cta = e ? (
    <Button asChild variant="gradient" size="lg" rightIcon={<ArrowRight />}>
      <Link href={`/app/learn/${courseId}`}>{done ? "Review course" : e.progress_pct > 0 ? "Continue learning" : "Start learning"}</Link>
    </Button>
  ) : canLearn ? (
    <Button variant="gradient" size="lg" rightIcon={<ArrowRight />} loading={enrol.isPending} onClick={() => enrol.mutate()} disabled={lessons.length === 0}>
      Enrol for free
    </Button>
  ) : (
    <Badge tone="neutral" size="lg">
      <Lock aria-hidden /> Learner access required to enrol
    </Badge>
  );

  return (
    <div className="space-y-6">
      <Breadcrumbs
        linkComponent={Link}
        items={[{ label: "Catalog", href: "/app/catalog" }, ...(course.category ? [{ label: course.category, href: `/app/catalog?category=${encodeURIComponent(course.category)}` }] : []), { label: course.title }]}
      />

      <section className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-soft">
        <div className="grid lg:grid-cols-[1.35fr_1fr]">
          <div className="order-2 flex flex-col p-6 sm:p-8 lg:order-1">
            <div className="flex flex-wrap items-center gap-2">
              {course.category && <CategoryBadge category={course.category} />}
              <DifficultyMeter difficulty={course.difficulty} />
              <Badge tone="neutral" size="sm">
                Version {course.version_number}
              </Badge>
              {e && (
                <Badge tone={done ? "success" : "brand"} size="sm" dot>
                  {done ? "Completed" : "Enrolled"}
                </Badge>
              )}
            </div>
            <h1 className="mt-3 font-display text-2xl font-bold tracking-tight text-slate-900 sm:text-4xl">{course.title}</h1>
            {course.subtitle && <p className="mt-2 text-base text-slate-600 sm:text-lg">{course.subtitle}</p>}
            <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { icon: Clock, label: "Duration", value: totalMinutes ? formatMinutes(totalMinutes) : "Self-paced", color: "sky" as const },
                { icon: Layers, label: "Modules", value: course.module_count, color: "violet" as const },
                { icon: BookOpen, label: "Lessons", value: course.lesson_count, color: "emerald" as const },
                { icon: Award, label: "Certificate", value: course.certificate_enabled ? "Included" : "—", color: "amber" as const },
              ].map((m) => {
                const mc = colorClasses(m.color);
                return (
                  <div key={m.label} className={cn("rounded-2xl border bg-gradient-to-br p-3", mc.border, mc.tint)}>
                    <dt className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-slate-500">
                      <m.icon className={cn("size-3.5", mc.icon)} aria-hidden />
                      {m.label}
                    </dt>
                    <dd className="mt-1 font-display text-lg font-bold text-slate-900">{m.value}</dd>
                  </div>
                );
              })}
            </dl>
            {e && !done && (
              <div className="mt-5 rounded-2xl bg-slate-50 p-4">
                <div className="mb-1.5 flex items-center justify-between gap-2 text-sm">
                  <span className="font-semibold text-slate-800">Your progress · {Math.round(e.progress_pct)}%</span>
                  <DueChip date={e.due_date as string | null} />
                </div>
                <Progress value={e.progress_pct} color={color} size="md" aria-label="Your progress" />
              </div>
            )}
            <div className="mt-6 flex flex-wrap items-center gap-3">
              {cta}
              {!e && firstLesson?.is_preview && (
                <Button asChild variant="secondary" size="lg" leftIcon={<Eye />}>
                  <Link href={`/app/learn/${courseId}/lesson/${firstLesson.id}`}>Preview</Link>
                </Button>
              )}
            </div>
            {course.published_at && <p className="mt-4 text-xs text-slate-500">Last updated {formatDate(course.published_at)}</p>}
          </div>
          <CourseCover category={course.category} thumbnailUrl={course.thumbnail_url} iconSize="lg" className="order-1 min-h-[200px] lg:order-2 lg:min-h-full">
            <div className="absolute bottom-5 left-5 right-5 hidden flex-wrap gap-2 sm:flex">
              {byType.slice(0, 4).map(([type, n]) => {
                const m = lessonMeta(type);
                return (
                  <span key={type} className="inline-flex items-center gap-1.5 rounded-full bg-white/95 px-2.5 py-1 text-xs font-semibold text-slate-800 shadow-sm">
                    <m.icon className={cn("size-3.5", colorClasses(m.color).icon)} aria-hidden />
                    {n} {m.label.toLowerCase()}
                    {n === 1 || m.label.endsWith("s") ? "" : "s"}
                  </span>
                );
              })}
            </div>
          </CourseCover>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {course.learning_objectives.length > 0 && (
            <Card padded>
              <SectionTitle icon={Target} color="emerald" title="What you'll learn" />
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {course.learning_objectives.map((o, i) => (
                  <li key={i} className="flex gap-2.5 text-sm text-slate-700">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
                    <span>{String(o)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {course.description && (
            <Card padded>
              <SectionTitle icon={BookOpen} color="sky" title="About this course" />
              <Markdown className="mt-4">{course.description}</Markdown>
            </Card>
          )}

          <Card padded>
            <SectionTitle
              icon={ListChecks}
              color="violet"
              title="Course outline"
              description={`${course.module_count} modules · ${course.lesson_count} lessons${totalMinutes ? ` · ${formatMinutes(totalMinutes)}` : ""}`}
            />
            {course.outline.length === 0 ? (
              <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">The outline for this course hasn&apos;t been published yet.</p>
            ) : (
              <Accordion type="multiple" defaultValue={course.outline.slice(0, 1).map((m) => m.id)} className="mt-3">
                {course.outline.map((m, mi) => {
                  const mins = m.lessons.reduce((a, l) => a + (l.duration_minutes || 0), 0);
                  return (
                    <AccordionItem key={m.id} value={m.id}>
                      <AccordionTrigger>
                        <span className="flex min-w-0 items-center gap-3">
                          <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br font-display text-sm font-bold text-white", c.gradient)}>{mi + 1}</span>
                          <span className="min-w-0">
                            <span className="block truncate">{m.title}</span>
                            <span className="block text-xs font-normal text-slate-500">
                              {m.lessons.length} lesson{m.lessons.length === 1 ? "" : "s"}
                              {mins ? ` · ${formatMinutes(mins)}` : ""}
                            </span>
                          </span>
                        </span>
                      </AccordionTrigger>
                      <AccordionContent>
                        {m.description && <p className="mb-3 text-sm text-slate-600">{m.description}</p>}
                        <ul className="space-y-1">
                          {m.lessons.map((l) => {
                            const meta = lessonMeta(l.lesson_type);
                            const lc = colorClasses(meta.color);
                            const canPreview = !e && l.is_preview;
                            const body = (
                              <>
                                <span className={cn("grid size-7 shrink-0 place-items-center rounded-lg", lc.soft, lc.icon)}>
                                  <meta.icon className="size-3.5" aria-hidden />
                                </span>
                                <span className="min-w-0 flex-1 truncate text-slate-800">{l.title}</span>
                                {!l.is_required && <span className="hidden text-2xs font-medium text-slate-500 sm:inline">Optional</span>}
                                {canPreview && (
                                  <Badge tone="info" size="sm">
                                    Preview
                                  </Badge>
                                )}
                                <span className="shrink-0 text-xs tabular-nums text-slate-500">{l.duration_minutes ? formatMinutes(l.duration_minutes) : meta.label}</span>
                              </>
                            );
                            return (
                              <li key={l.id}>
                                {canPreview || e ? (
                                  <Link href={`/app/learn/${courseId}/lesson/${l.id}`} className="flex items-center gap-3 rounded-xl p-2 transition hover:bg-slate-50 focus-visible:focus-ring">
                                    {body}
                                  </Link>
                                ) : (
                                  <div className="flex items-center gap-3 p-2">{body}</div>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </AccordionContent>
                    </AccordionItem>
                  );
                })}
              </Accordion>
            )}
          </Card>
        </div>

        <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
          <Card padded className="overflow-hidden">
            <SectionTitle icon={PlayCircle} color="indigo" title="This course includes" />
            <ul className="mt-4 space-y-2.5">
              {byType.slice(0, 8).map(([type, n]) => {
                const m = lessonMeta(type);
                const mc = colorClasses(m.color);
                return (
                  <li key={type} className="flex items-center gap-3 text-sm text-slate-700">
                    <span className={cn("grid size-7 place-items-center rounded-lg", mc.soft, mc.icon)}>
                      <m.icon className="size-3.5" aria-hidden />
                    </span>
                    <span className="flex-1">{m.label}</span>
                    <span className="font-semibold tabular-nums text-slate-900">{n}</span>
                  </li>
                );
              })}
              {byType.length > 8 && (
                <li className="pl-10 text-xs font-medium text-slate-500">
                  + {byType.slice(8).reduce((a, [, n]) => a + n, 0)} more across {byType.length - 8} other formats
                </li>
              )}
              {course.certificate_enabled && (
                <li className="flex items-center gap-3 text-sm text-slate-700">
                  <span className="grid size-7 place-items-center rounded-lg bg-amber-50 text-amber-600">
                    <BadgeCheck className="size-3.5" aria-hidden />
                  </span>
                  <span className="flex-1">Verifiable certificate</span>
                </li>
              )}
            </ul>
            <div className="mt-5">{cta}</div>
          </Card>

          {course.skills.length > 0 && (
            <Card padded>
              <SectionTitle icon={GraduationCap} color="teal" title="Skills you'll build" />
              <SkillPills skills={course.skills} max={20} className="mt-4" />
            </Card>
          )}

          {course.prerequisites.length > 0 && (
            <Card padded>
              <SectionTitle icon={ListChecks} color="amber" title="Prerequisites" />
              <ul className="mt-4 space-y-2">
                {course.prerequisites.map((p, i) => (
                  <li key={i} className="flex gap-2 text-sm text-slate-700">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden />
                    {String(p)}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {course.target_audience && (
            <Card padded>
              <SectionTitle icon={Users} color="fuchsia" title="Who it's for" />
              <p className="mt-3 text-sm text-slate-700">{course.target_audience}</p>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
