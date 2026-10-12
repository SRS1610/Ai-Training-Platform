"use client";

import { Badge, Button, CategoryBadge, Progress, ProgressRing, cn, colorFor } from "@praxis/ui";
import { ArrowRight, Award, CheckCircle2, Clock, RefreshCw, UserCheck } from "lucide-react";
import Link from "next/link";
import { formatDate, formatMinutes, formatRelative } from "@/lib/format";
import { lessonMeta } from "./meta";
import type { MyEnrolment } from "./types";
import { CourseCover, DifficultyMeter, DueChip } from "./visuals";

export function enrolmentHref(e: Pick<MyEnrolment, "course_id" | "next_lesson">) {
  return e.next_lesson ? `/app/learn/${e.course_id}/lesson/${e.next_lesson.id}` : `/app/learn/${e.course_id}`;
}

/** Horizontal enrolment card for "My learning" (cover · details · progress ring · CTA). */
export function EnrolmentCard({ e, emphasiseDue }: { e: MyEnrolment; emphasiseDue?: boolean }) {
  const done = e.status === "completed";
  const color = colorFor(e.category);
  const next = e.next_lesson ? lessonMeta(e.next_lesson.lesson_type) : null;
  const overdue = !done && e.is_overdue;
  return (
    <article
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-2xl border bg-white shadow-soft transition duration-300 ease-spring hover:-translate-y-0.5 hover:shadow-lift focus-within:ring-2 focus-within:ring-brand-500/40 sm:flex-row",
        overdue && emphasiseDue ? "border-rose-200 ring-1 ring-rose-100" : "border-slate-200/80",
      )}
    >
      <CourseCover category={e.category} thumbnailUrl={e.thumbnail_url} iconSize="sm" className="h-24 shrink-0 sm:h-auto sm:w-44">
        {overdue && emphasiseDue && <span className="absolute inset-x-0 top-0 h-1 bg-rose-500" aria-hidden />}
      </CourseCover>
      <div className="flex min-w-0 flex-1 flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-5 sm:p-5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {e.category && <CategoryBadge category={e.category} size="sm" />}
            {e.source !== "self" && (
              <Badge tone="violet" size="sm">
                <UserCheck aria-hidden />
                {e.source === "learning_path" ? "Learning path" : "Assigned"}
              </Badge>
            )}
            {e.upgrade_available && (
              <Badge tone="warning" size="sm">
                <RefreshCw aria-hidden />
                New version
              </Badge>
            )}
            <DifficultyMeter difficulty={e.difficulty} className="ml-1" />
          </div>
          <h3 className="mt-1.5 line-clamp-2 font-display text-base font-semibold leading-snug text-slate-900 sm:line-clamp-1">
            <Link href={done ? `/app/learn/${e.course_id}` : enrolmentHref(e)} className="after:absolute after:inset-0 focus-visible:outline-none">
              {e.title}
            </Link>
          </h3>
          {done ? (
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600">
              <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                <CheckCircle2 className="size-4" aria-hidden /> Completed {formatDate(e.completed_at)}
              </span>
              {e.final_score !== null && <span>Final score {Math.round(e.final_score)}%</span>}
            </p>
          ) : next && e.next_lesson ? (
            <p className="mt-1 flex min-w-0 items-center gap-2 text-sm text-slate-600">
              <next.icon className="size-4 shrink-0 text-slate-400" aria-hidden />
              <span className="truncate">
                <span className="text-slate-500">Up next: </span>
                {e.next_lesson.title}
              </span>
            </p>
          ) : (
            <p className="mt-1 text-sm text-slate-500">Open the course to continue</p>
          )}
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-slate-500">
            {!done && <DueChip date={e.due_date} overdue={e.is_overdue} />}
            {e.time_spent_seconds > 0 && (
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3.5" aria-hidden />
                {formatMinutes(e.time_spent_seconds / 60)} spent
              </span>
            )}
            {e.last_accessed_at && !done && <span>Last opened {formatRelative(e.last_accessed_at)}</span>}
            {e.version_number && <span>v{e.version_number}</span>}
          </div>
          {!done && (
            <Progress value={e.progress_pct} color={color} size="sm" className="mt-3 sm:hidden" aria-label={`${e.title} progress`} />
          )}
        </div>
        <div className="relative z-10 flex items-center justify-between gap-4 sm:flex-col sm:items-end sm:justify-center">
          {done ? (
            <span className="grid size-14 place-items-center rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 text-white shadow-sm">
              <Award className="size-6" aria-hidden />
            </span>
          ) : (
            <ProgressRing value={e.progress_pct} size={60} stroke={6} color={color} aria-label={`${e.title}: ${Math.round(e.progress_pct)}% complete`} className="hidden sm:inline-grid" />
          )}
          <Button asChild size="sm" variant={done ? "secondary" : "primary"} rightIcon={<ArrowRight />}>
            <Link href={done ? `/app/learn/${e.course_id}` : enrolmentHref(e)}>{done ? "Review" : e.progress_pct > 0 ? "Continue" : "Start"}</Link>
          </Button>
        </div>
      </div>
    </article>
  );
}
