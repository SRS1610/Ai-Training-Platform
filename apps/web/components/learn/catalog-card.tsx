"use client";

import { Badge, CategoryBadge, Progress, Skeleton, cn, colorFor } from "@praxis/ui";
import { ArrowRight, CheckCircle2, Clock, Layers } from "lucide-react";
import Link from "next/link";
import { formatMinutes } from "@/lib/format";
import type { CatalogItem } from "./types";
import { CourseCover, DifficultyMeter, DueChip, SkillPills } from "./visuals";

export function enrolmentCta(e: CatalogItem["enrolment"]): string {
  if (!e) return "View course";
  if (e.status === "completed") return "Review";
  return e.progress_pct > 0 ? "Continue" : "Start";
}

/** Catalog course card: gradient category header, meta, skills and enrolment state. */
export function CatalogCard({ course }: { course: CatalogItem }) {
  const e = course.enrolment;
  const done = e?.status === "completed";
  const href = e ? `/app/learn/${course.id}` : `/app/catalog/${course.id}`;
  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-soft transition duration-300 ease-spring hover:-translate-y-1 hover:shadow-lift focus-within:ring-2 focus-within:ring-brand-500/40">
      <CourseCover category={course.category} thumbnailUrl={course.thumbnail_url} className="h-32">
        <div className="absolute inset-x-3 bottom-3 flex items-end justify-between gap-2">
          {course.category ? <CategoryBadge category={course.category} size="sm" className="bg-white/95 shadow-sm" /> : <span />}
          {e && (
            <Badge tone={done ? "success" : "brand"} size="sm" className="bg-white/95 shadow-sm">
              {done ? <CheckCircle2 aria-hidden /> : null}
              {done ? "Completed" : "Enrolled"}
            </Badge>
          )}
        </div>
      </CourseCover>
      <div className="flex flex-1 flex-col p-4 sm:p-5">
        <div className="flex items-center justify-between gap-2">
          <DifficultyMeter difficulty={course.difficulty} />
          <span className="text-2xs font-medium text-slate-500">v{course.version_number}</span>
        </div>
        <h3 className="mt-2 line-clamp-2 font-display text-base font-semibold leading-snug text-slate-900">
          <Link href={href} className="after:absolute after:inset-0 focus-visible:outline-none">
            {course.title}
          </Link>
        </h3>
        {(course.subtitle || course.description) && (
          <p className="mt-1.5 line-clamp-2 text-sm text-slate-600">{course.subtitle || course.description}</p>
        )}
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium text-slate-600">
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3.5 text-slate-400" aria-hidden />
            {course.duration_minutes ? formatMinutes(course.duration_minutes) : "Self-paced"}
          </span>
          <span className="inline-flex items-center gap-1">
            <Layers className="size-3.5 text-slate-400" aria-hidden />
            {course.lesson_count} lesson{course.lesson_count === 1 ? "" : "s"}
          </span>
        </p>
        <SkillPills skills={course.skills ?? []} max={3} className="mt-3" />
        <div className="mt-auto pt-4">
          {e && !done && (
            <div className="mb-3">
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="font-medium text-slate-600">{Math.round(e.progress_pct)}% complete</span>
                <DueChip date={e.due_date as string | null} />
              </div>
              <Progress value={e.progress_pct} color={colorFor(course.category)} size="sm" aria-label={`${course.title} progress`} />
            </div>
          )}
          <span className={cn("inline-flex items-center gap-1 text-sm font-semibold transition-all group-hover:gap-2", done ? "text-emerald-700" : "text-brand-700")}>
            {enrolmentCta(e)} <ArrowRight className="size-4" aria-hidden />
          </span>
        </div>
      </div>
    </article>
  );
}

export function CatalogCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-soft">
      <Skeleton className="h-32 rounded-none" />
      <div className="space-y-3 p-5">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-5 w-4/5" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-3 w-32" />
      </div>
    </div>
  );
}
