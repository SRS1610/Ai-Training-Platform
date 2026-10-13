"use client";

import { Button, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, Skeleton, Tooltip, cn, colorClasses, colorFor } from "@praxis/ui";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Bot, ListTree, Maximize2, Minimize2, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";
import { PlayerContext, flatLessons } from "@/components/learn/player/context";
import { PlayerOutline } from "@/components/learn/player/outline";
import { lk } from "@/components/learn/query-keys";
import type { LearnCourse } from "@/components/learn/types";
import { ApiError, api } from "@/lib/api";

const TutorPanel = dynamic(() => import("@/components/tutor/tutor-panel").then((m) => m.TutorPanel), { ssr: false });

const SIDEBAR_KEY = "praxis.player.outline";
const FOCUS_KEY = "praxis.player.focus";

export default function LessonPlayerLayout({ children }: { children: React.ReactNode }) {
  const { courseId, lessonId } = useParams<{ courseId: string; lessonId?: string }>();
  const q = useQuery({
    queryKey: lk.learn.course(courseId),
    queryFn: ({ signal }) => api.get<LearnCourse>(`/learn/${courseId}`, { signal }),
    retry: (n, err) => !(err instanceof ApiError && err.status < 500) && n < 2,
  });
  const course = q.data;
  const enrolled = !!course;
  const [outlineOpen, setOutlineOpen] = React.useState(true);
  const [mobileOutline, setMobileOutline] = React.useState(false);
  const [tutorOpen, setTutorOpenState] = React.useState(false);
  const [tutorMounted, setTutorMounted] = React.useState(false);
  const setTutorOpen = React.useCallback((o: boolean) => {
    if (o) setTutorMounted(true);
    setTutorOpenState(o);
  }, []);

  React.useEffect(() => {
    try {
      setOutlineOpen(localStorage.getItem(SIDEBAR_KEY) !== "0");
    } catch {
      /* ignore */
    }
  }, []);
  // Focus mode (lg+): the player covers the app shell (sidebar + top bar) so only the lesson and its
  // outline remain. On by default; the learner's choice is remembered.
  const [focus, setFocus] = React.useState(false);
  const focusRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    try {
      setFocus(localStorage.getItem(FOCUS_KEY) !== "0");
    } catch {
      setFocus(true);
    }
  }, []);
  const toggleFocus = React.useCallback(() => {
    setFocus((f) => {
      try {
        localStorage.setItem(FOCUS_KEY, f ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !f;
    });
  }, []);
  React.useEffect(() => {
    if (!focus) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || document.querySelector("[role=dialog],[role=alertdialog]")) return;
      if (window.matchMedia("(min-width: 1024px)").matches) toggleFocus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focus, toggleFocus]);
  // The focus overlay is its own scroll container, so reset it when moving between lessons.
  React.useEffect(() => {
    focusRef.current?.scrollTo({ top: 0 });
  }, [lessonId]);

  const toggleOutline = () =>
    setOutlineOpen((o) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, o ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !o;
    });

  const lessons = flatLessons(course);
  const idx = lessons.findIndex((l) => l.id === lessonId);
  const stats = course?.stats;
  const pct = course ? Math.round(course.enrolment.progress_pct) : 0;
  const tutorEnabled = course ? course.course.ai_tutor_enabled !== false : true;
  const accent = colorClasses(colorFor(course?.course.category));

  const ctx = React.useMemo(
    () => ({ courseId, course, enrolled, openTutor: () => setTutorOpen(true), tutorEnabled }),
    [courseId, course, enrolled, tutorEnabled, setTutorOpen],
  );

  return (
    <PlayerContext.Provider value={ctx}>
      <div ref={focusRef} className={cn(focus && "lg:fixed lg:inset-0 lg:z-40 lg:overflow-y-auto lg:overscroll-contain lg:bg-[#f5f6fb] lg:p-4 xl:p-5")}>
      <div className="overflow-clip rounded-3xl border border-slate-200/80 bg-white shadow-soft">
        {/* player bar */}
        <div className={cn("sticky top-16 z-10 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl", focus && "lg:top-0")}>
          <div className="flex h-14 items-center gap-2 px-3 sm:gap-3 sm:px-4">
            {enrolled && (
              <>
                <Tooltip content={outlineOpen ? "Hide outline" : "Show outline"}>
                  <Button variant="ghost" size="icon-sm" className="hidden lg:inline-flex" onClick={toggleOutline} aria-label={outlineOpen ? "Hide course outline" : "Show course outline"} aria-pressed={outlineOpen}>
                    {outlineOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
                  </Button>
                </Tooltip>
                <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={() => setMobileOutline(true)} aria-label="Open course outline">
                  <ListTree />
                </Button>
              </>
            )}
            <Link
              href={enrolled ? `/app/learn/${courseId}` : `/app/catalog/${courseId}`}
              className="flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 text-sm font-semibold text-slate-800 transition hover:text-brand-700 focus-visible:focus-ring"
            >
              <ArrowLeft className="size-4 shrink-0 text-slate-400" aria-hidden />
              <span className={cn("hidden size-2 shrink-0 rounded-full sm:inline-block", accent.solid)} aria-hidden />
              <span className="truncate">{course?.course.title ?? (q.isLoading ? "Loading course…" : "Back to course")}</span>
            </Link>
            <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
              {course && (
                <span className="hidden items-center gap-2 text-xs font-medium text-slate-600 md:flex">
                  {idx >= 0 && (
                    <span className="tabular-nums">
                      Lesson {idx + 1} of {lessons.length}
                    </span>
                  )}
                  <span className="h-4 w-px bg-slate-200" aria-hidden />
                  <span className="font-semibold tabular-nums text-slate-900">{pct}% complete</span>
                </span>
              )}
              <Tooltip content={focus ? "Exit focus mode (Esc)" : "Focus mode — hide the app menu"}>
                <Button variant="ghost" size="icon-sm" className="hidden lg:inline-flex" onClick={toggleFocus} aria-label={focus ? "Exit focus mode" : "Enter focus mode"} aria-pressed={focus}>
                  {focus ? <Minimize2 /> : <Maximize2 />}
                </Button>
              </Tooltip>
              {tutorEnabled && (
                <Button size="sm" variant="soft" className="bg-fuchsia-50 text-fuchsia-700 hover:bg-fuchsia-100" leftIcon={<Bot />} onClick={() => setTutorOpen(true)}>
                  <span className="hidden sm:inline">Ask AI tutor</span>
                  <span className="sm:hidden">Tutor</span>
                </Button>
              )}
            </div>
          </div>
          <div
            className="h-1 w-full bg-slate-100"
            role="progressbar"
            aria-label="Course progress"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="h-full rounded-r-full bg-gradient-to-r from-brand-500 via-violet-500 to-fuchsia-500 transition-[width] duration-700" style={{ width: `${pct}%` }} />
          </div>
        </div>

        <div className="flex min-h-[calc(100dvh-12rem)]">
          {enrolled && outlineOpen && (
            <aside className="hidden w-80 shrink-0 border-r border-slate-200/80 bg-slate-50/60 lg:block" aria-label="Course outline">
              <div className={cn("sticky top-[7.75rem] h-[calc(100dvh-7.75rem)] overflow-y-auto p-3 scrollbar-thin", focus && "lg:top-[3.75rem] lg:h-[calc(100dvh-5.75rem)] xl:h-[calc(100dvh-6.25rem)]")}>
              <div className="mb-3 rounded-2xl bg-white p-3 shadow-soft ring-1 ring-slate-200/70">
                <p className="text-2xs font-semibold uppercase tracking-wider text-slate-500">Your progress</p>
                <p className="mt-1 font-display text-lg font-bold text-slate-900">
                  {stats?.completed_lessons ?? 0}
                  <span className="text-sm font-medium text-slate-500"> / {stats?.total_lessons ?? 0} lessons</span>
                </p>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-500" style={{ width: `${pct}%` }} />
                </div>
              </div>
              <PlayerOutline courseId={courseId} modules={course!.modules} currentLessonId={lessonId} />
              </div>
            </aside>
          )}
          {q.isLoading && (
            <aside className="hidden w-80 shrink-0 space-y-3 border-r border-slate-200/80 bg-slate-50/60 p-4 lg:block" aria-hidden>
              {Array.from({ length: 7 }).map((_, i) => (
                <Skeleton key={i} className="h-10 rounded-xl" />
              ))}
            </aside>
          )}
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </div>
      </div>

      {enrolled && (
        <Sheet open={mobileOutline} onOpenChange={setMobileOutline}>
          <SheetContent side="left" className="w-[88%] max-w-sm gap-0 p-0">
            <SheetHeader className="border-b border-slate-200 pb-4">
              <SheetTitle className="pr-8">{course!.course.title}</SheetTitle>
              <SheetDescription>
                {stats?.completed_lessons ?? 0} of {stats?.total_lessons ?? 0} lessons complete · {pct}%
              </SheetDescription>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto p-3">
              <PlayerOutline courseId={courseId} modules={course!.modules} currentLessonId={lessonId} onNavigate={() => setMobileOutline(false)} />
            </div>
          </SheetContent>
        </Sheet>
      )}
      {tutorEnabled && tutorMounted && <TutorPanel courseId={courseId} lessonId={lessonId} open={tutorOpen} onOpenChange={setTutorOpen} />}
    </PlayerContext.Provider>
  );
}
