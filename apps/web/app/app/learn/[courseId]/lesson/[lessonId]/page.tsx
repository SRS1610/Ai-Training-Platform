"use client";

import { Badge, Button, Dialog, DialogContent, DialogDescription, DialogTitle, EmptyState, Skeleton, cn, colorClasses, toast } from "@praxis/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Award, CheckCircle2, Clock, Eye, Lock, PartyPopper, Sparkles, Trophy } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import * as React from "react";
import { ErrorState } from "@/components/common/error-state";
import { Confetti } from "@/components/learn/celebration";
import { lessonMeta } from "@/components/learn/meta";
import { flatLessons, usePlayer } from "@/components/learn/player/context";
import { LessonBody } from "@/components/learn/player/lesson-body";
import { useLessonTracking } from "@/components/learn/player/tracking";
import { lk } from "@/components/learn/query-keys";
import type { LearnCourse, LearnLesson, ProgressOut } from "@/components/learn/types";
import { ApiError, api, errorMessage } from "@/lib/api";
import { formatMinutes } from "@/lib/format";

const VIA_COPY: Record<string, string> = {
  assessment: "This lesson completes automatically when you pass the quiz.",
  assignment: "This lesson completes automatically when your assignment is graded as passed.",
  simulation: "This lesson completes automatically when you finish the simulation.",
};

function LessonSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-8 sm:px-8" aria-busy aria-label="Loading lesson">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-9 w-3/4" />
      <Skeleton className="h-5 w-56" />
      <Skeleton className="aspect-video w-full rounded-2xl" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
    </div>
  );
}

function CourseCompleteDialog({ open, onOpenChange, courseId, title, certificate }: { open: boolean; onOpenChange: (o: boolean) => void; courseId: string; title: string; certificate: boolean }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" className="overflow-hidden p-0">
        <div className="relative bg-gradient-to-br from-amber-50 via-white to-fuchsia-50 px-6 pb-6 pt-10 text-center">
          <Confetti pieces={70} />
          <span className="relative mx-auto grid size-20 place-items-center rounded-3xl bg-gradient-to-br from-amber-400 via-orange-500 to-rose-500 text-white shadow-glow motion-safe:animate-float">
            <Trophy className="size-10" aria-hidden />
          </span>
          <DialogTitle className="relative mt-5 text-2xl">Course complete!</DialogTitle>
          <DialogDescription className="relative mx-auto mt-2 max-w-sm text-base">
            You finished <strong className="text-slate-900">{title}</strong>.{" "}
            {certificate ? "Your verifiable certificate is being issued now." : "Great work — keep the momentum going."}
          </DialogDescription>
          <div className="relative mt-6 flex flex-col justify-center gap-2 sm:flex-row">
            {certificate && (
              <Button asChild variant="gradient" leftIcon={<Award />}>
                <Link href="/app/certificates">View my certificates</Link>
              </Button>
            )}
            <Button asChild variant="secondary">
              <Link href={`/app/learn/${courseId}`}>Back to course</Link>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function LessonPage() {
  const { courseId, lessonId } = useParams<{ courseId: string; lessonId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const player = usePlayer();
  const [celebrate, setCelebrate] = React.useState(false);

  const q = useQuery({
    queryKey: lk.learn.lesson(courseId, lessonId),
    queryFn: ({ signal }) => api.get<LearnLesson>(`/learn/${courseId}/lessons/${lessonId}`, { signal }),
    retry: (n, err) => !(err instanceof ApiError && err.status < 500) && n < 2,
  });
  const data = q.data;
  const trackable = !!data && !data.preview && !!data.enrolment_id;

  const syncProgress = React.useCallback(
    (p: ProgressOut) => {
      qc.setQueryData<LearnCourse>(lk.learn.course(courseId), (old) =>
        old
          ? {
              ...old,
              enrolment: { ...old.enrolment, progress_pct: p.enrolment.progress_pct, status: p.enrolment.status },
              modules: old.modules.map((m) => ({
                ...m,
                lessons: m.lessons.map((l) =>
                  l.id === lessonId && l.progress.status !== "completed"
                    ? { ...l, progress: { ...l.progress, status: p.lesson.status, time_spent_seconds: p.lesson.time_spent_seconds } }
                    : l,
                ),
              })),
            }
          : old,
      );
    },
    [qc, courseId, lessonId],
  );
  const setPosition = useLessonTracking(lessonId, trackable, syncProgress);

  const lessons = flatLessons(player.course);
  const idx = lessons.findIndex((l) => l.id === lessonId);
  const prev = data?.previous_lesson_id ? lessons.find((l) => l.id === data.previous_lesson_id) : undefined;
  const next = data?.next_lesson_id ? lessons.find((l) => l.id === data.next_lesson_id) : undefined;

  const complete = useMutation({
    mutationFn: () => api.post<ProgressOut>(`/progress/lessons/${lessonId}/complete`),
    onSuccess: (p) => {
      syncProgress(p);
      qc.setQueryData<LearnLesson>(lk.learn.lesson(courseId, lessonId), (old) => (old ? { ...old, progress: { ...old.progress, status: "completed", completed_at: p.lesson.completed_at } } : old));
      qc.invalidateQueries({ queryKey: lk.learn.course(courseId) });
      qc.invalidateQueries({ queryKey: lk.enrolments.all });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      if (p.enrolment.status === "completed") {
        setCelebrate(true);
        qc.invalidateQueries({ queryKey: lk.certificates.all });
      } else {
        toast.success("Lesson complete", {
          description: `Course progress: ${Math.round(p.enrolment.progress_pct)}%`,
          action: next && !next.locked ? { label: "Next lesson", onClick: () => router.push(`/app/learn/${courseId}/lesson/${next.id}`) } : undefined,
        });
      }
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isLoading) return <LessonSkeleton />;
  if (q.isError || !data) {
    const err = q.error;
    if (err instanceof ApiError && err.code === "lesson_locked")
      return (
        <EmptyState
          size="lg"
          illustration={
            <span className="grid size-20 place-items-center rounded-3xl bg-gradient-to-br from-slate-200 to-slate-100 text-slate-500">
              <Lock className="size-9" aria-hidden />
            </span>
          }
          title="This lesson is locked"
          description="This course is sequential — complete the earlier required lessons to unlock it."
          action={
            <Button asChild variant="gradient">
              <Link href={player.course?.next_lesson ? `/app/learn/${courseId}/lesson/${player.course.next_lesson.id}` : `/app/learn/${courseId}`}>Go to your next lesson</Link>
            </Button>
          }
        />
      );
    if (err instanceof ApiError && err.status === 404)
      return (
        <EmptyState
          size="lg"
          illustration="learning"
          title={err.code === "not_enrolled" ? "Enrol to open this lesson" : "Lesson not found"}
          description={err.code === "not_enrolled" ? "This lesson is part of the full course. Enrol for free to continue." : "It may have been removed in a newer version of the course."}
          action={
            <Button asChild variant="gradient">
              <Link href={err.code === "not_enrolled" ? `/app/catalog/${courseId}` : `/app/learn/${courseId}`}>{err.code === "not_enrolled" ? "View course" : "Back to course"}</Link>
            </Button>
          }
        />
      );
    return <ErrorState error={err} onRetry={() => q.refetch()} size="lg" />;
  }

  const lesson = data.lesson;
  const meta = lessonMeta(lesson.lesson_type);
  const mc = colorClasses(meta.color);
  const done = data.progress.status === "completed";
  const moduleIndex = player.course?.modules.findIndex((m) => m.id === data.module.id) ?? -1;

  return (
    <article className="mx-auto max-w-3xl px-4 pb-12 pt-6 sm:px-8 sm:pt-10" aria-labelledby="lesson-title">
      {data.preview && (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
          <Eye className="size-4 text-sky-600" aria-hidden />
          <span className="flex-1">You&apos;re previewing this lesson. Enrol to save progress and unlock the full course.</span>
          <Button asChild size="sm" variant="primary">
            <Link href={`/app/catalog/${courseId}`}>Enrol</Link>
          </Button>
        </div>
      )}

      <header>
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          {moduleIndex >= 0 ? `Module ${moduleIndex + 1} · ` : ""}
          {data.module.title}
        </p>
        <h1 id="lesson-title" className="mt-2 font-display text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          {lesson.title}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset", mc.soft, mc.text, mc.ring)}>
            <meta.icon className="size-3.5" aria-hidden />
            {meta.label}
          </span>
          {!!lesson.duration_minutes && (
            <Badge tone="neutral">
              <Clock aria-hidden />
              {formatMinutes(lesson.duration_minutes)}
            </Badge>
          )}
          {lesson.is_required === false && <Badge tone="neutral">Optional</Badge>}
          {done && (
            <Badge tone="success">
              <CheckCircle2 aria-hidden /> Completed
            </Badge>
          )}
          {idx >= 0 && (
            <span className="ml-auto text-xs font-medium text-slate-500 md:hidden">
              Lesson {idx + 1} of {lessons.length}
            </span>
          )}
        </div>
        {lesson.summary && <p className="mt-4 text-base text-slate-600">{lesson.summary}</p>}
      </header>

      <div className="mt-8">
        <LessonBody data={data} courseId={courseId} enrolled={trackable} onPosition={setPosition} openTutor={player.openTutor} tutorEnabled={player.tutorEnabled} />
      </div>

      {trackable && (
        <section aria-label="Lesson completion" className="mt-10">
          {data.completes_via === "learner" ? (
            done ? (
              <div className="flex flex-col items-start gap-3 rounded-2xl bg-gradient-to-r from-emerald-50 via-teal-50 to-sky-50 p-5 ring-1 ring-emerald-100 sm:flex-row sm:items-center">
                <span className="grid size-10 place-items-center rounded-xl bg-emerald-500 text-white">
                  <CheckCircle2 className="size-5" aria-hidden />
                </span>
                <div className="flex-1">
                  <p className="font-semibold text-emerald-900">Lesson complete</p>
                  <p className="text-sm text-emerald-800">Nice work — keep going while it&apos;s fresh.</p>
                </div>
                {next && !next.locked && (
                  <Button asChild variant="success" rightIcon={<ArrowRight />}>
                    <Link href={`/app/learn/${courseId}/lesson/${next.id}`}>Next lesson</Link>
                  </Button>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-5 sm:flex-row sm:items-center">
                <span className="grid size-10 place-items-center rounded-xl bg-white text-brand-600 shadow-soft ring-1 ring-slate-200">
                  <Sparkles className="size-5" aria-hidden />
                </span>
                <div className="flex-1">
                  <p className="font-semibold text-slate-900">Finished this lesson?</p>
                  <p className="text-sm text-slate-600">Mark it complete to update your progress.</p>
                </div>
                <Button variant="success" leftIcon={<CheckCircle2 />} loading={complete.isPending} onClick={() => complete.mutate()}>
                  Mark complete
                </Button>
              </div>
            )
          ) : (
            <div className={cn("flex items-center gap-3 rounded-2xl p-4 text-sm ring-1", done ? "bg-emerald-50 text-emerald-900 ring-emerald-100" : "bg-slate-50 text-slate-700 ring-slate-200")}>
              {done ? <CheckCircle2 className="size-5 shrink-0 text-emerald-600" aria-hidden /> : <PartyPopper className="size-5 shrink-0 text-violet-600" aria-hidden />}
              {done ? "You've completed this lesson." : (VIA_COPY[data.completes_via] ?? "This lesson completes automatically.")}
            </div>
          )}
        </section>
      )}

      <nav aria-label="Lesson navigation" className="mt-8 grid gap-3 border-t border-slate-200 pt-6 sm:grid-cols-2">
        {data.previous_lesson_id ? (
          <Link
            href={`/app/learn/${courseId}/lesson/${data.previous_lesson_id}`}
            className="group flex items-center gap-3 rounded-2xl border border-slate-200 p-4 transition hover:border-slate-300 hover:bg-slate-50 focus-visible:focus-ring"
          >
            <ArrowLeft className="size-5 shrink-0 text-slate-400 transition group-hover:-translate-x-0.5" aria-hidden />
            <span className="min-w-0">
              <span className="block text-xs font-medium text-slate-500">Previous</span>
              <span className="block truncate text-sm font-semibold text-slate-900">{prev?.title ?? "Previous lesson"}</span>
            </span>
          </Link>
        ) : (
          <span className="hidden sm:block" />
        )}
        {data.next_lesson_id ? (
          next?.locked && next.progress.status !== "completed" ? (
            <span className="flex items-center justify-end gap-3 rounded-2xl border border-dashed border-slate-200 p-4 text-right opacity-70" aria-disabled="true">
              <span className="min-w-0">
                <span className="block text-xs font-medium text-slate-500">Next · locked</span>
                <span className="block truncate text-sm font-semibold text-slate-700">{next.title}</span>
              </span>
              <Lock className="size-5 shrink-0 text-slate-400" aria-hidden />
            </span>
          ) : (
            <Link
              href={`/app/learn/${courseId}/lesson/${data.next_lesson_id}`}
              className="group flex items-center justify-end gap-3 rounded-2xl border border-brand-200 bg-brand-50/50 p-4 text-right transition hover:border-brand-300 hover:bg-brand-50 focus-visible:focus-ring"
            >
              <span className="min-w-0">
                <span className="block text-xs font-medium text-brand-700">Next</span>
                <span className="block truncate text-sm font-semibold text-slate-900">{next?.title ?? "Next lesson"}</span>
              </span>
              <ArrowRight className="size-5 shrink-0 text-brand-600 transition group-hover:translate-x-0.5" aria-hidden />
            </Link>
          )
        ) : (
          <Link
            href={`/app/learn/${courseId}`}
            className="flex items-center justify-end gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 text-right transition hover:bg-emerald-50 focus-visible:focus-ring"
          >
            <span>
              <span className="block text-xs font-medium text-emerald-700">End of course</span>
              <span className="block text-sm font-semibold text-slate-900">Back to course overview</span>
            </span>
            <Trophy className="size-5 shrink-0 text-emerald-600" aria-hidden />
          </Link>
        )}
      </nav>

      <CourseCompleteDialog
        open={celebrate}
        onOpenChange={setCelebrate}
        courseId={courseId}
        title={player.course?.course.title ?? "this course"}
        certificate={player.course?.course.certificate_enabled !== false}
      />
    </article>
  );
}
