"use client";

import { Button, Sheet, SheetContent, SheetDescription, SheetTitle, Tooltip } from "@praxis/ui";
import { Maximize2, Plus, Sparkles } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { coursePrompts, DEFAULT_PROMPTS, LESSON_PROMPTS, TutorChat } from "./tutor-chat";
import { useMyEnrolments } from "./use-tutor";

/**
 * Right-side AI tutor drawer, scoped to a course/lesson when given. Reuses the full tutor chat
 * (streaming, citations, hint mode, ratings). A conversation is created on the first question and kept
 * while the drawer's host stays mounted.
 *
 * The course scope is only used when the learner is enrolled in that course (the API refuses course
 * tutors otherwise); without an enrolment the drawer falls back to a general tutor over all their courses.
 * Hosts can pass page-specific starter `prompts` and a `contextNote` for the welcome state.
 */
export function TutorPanel({
  courseId,
  lessonId,
  open,
  onOpenChange,
  prompts,
  contextNote,
}: {
  courseId?: string;
  lessonId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prompts?: string[];
  contextNote?: React.ReactNode;
}) {
  const enrolments = useMyEnrolments();
  const course = enrolments.data?.find((e) => e.course_id === courseId);
  // Unknown until enrolments load: keep the requested scope (the common case is an enrolled learner).
  const notEnrolled = !!courseId && enrolments.isSuccess && !course;
  const scopedCourse = notEnrolled ? undefined : courseId;
  const scopedLesson = notEnrolled ? undefined : lessonId;
  const scope = `${scopedCourse ?? ""}:${scopedLesson ?? ""}`;
  const [sessions, setSessions] = React.useState<Record<string, string>>({});
  const sessionId = sessions[scope] ?? null;
  const starters = prompts?.length ? prompts : scopedLesson ? LESSON_PROMPTS : scopedCourse ? coursePrompts(course?.title) : DEFAULT_PROMPTS;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full max-w-[min(100vw,30rem)] flex-col gap-0 p-0 sm:max-w-[30rem]" aria-describedby="tutor-panel-desc">
        <div className="relative overflow-hidden border-b border-slate-200/80 bg-gradient-to-br from-violet-50 via-fuchsia-50/60 to-white px-5 pb-4 pt-5">
          <div className="pointer-events-none absolute -right-10 -top-12 size-40 rounded-full bg-fuchsia-200/50 blur-2xl" aria-hidden />
          <div className="relative flex items-center gap-3 pr-10">
            <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 via-fuchsia-500 to-pink-500 text-white shadow-glow">
              <Sparkles className="size-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <SheetTitle className="text-base">AI tutor</SheetTitle>
              <SheetDescription id="tutor-panel-desc" className="truncate text-xs">
                {course ? `Grounded in ${course.title}` : "Grounded in your course materials"}
              </SheetDescription>
            </div>
          </div>
          <div className="relative mt-3 flex gap-2">
            {sessionId && (
              <Button size="xs" variant="white" leftIcon={<Plus />} onClick={() => setSessions((s) => ({ ...s, [scope]: "" }))}>
                New chat
              </Button>
            )}
            <Tooltip content="Open the full tutor">
              <Button size="xs" variant="white" leftIcon={<Maximize2 />} asChild>
                <Link href={sessionId ? `/app/tutor?session=${sessionId}` : scopedCourse ? `/app/tutor?course=${scopedCourse}${scopedLesson ? `&lesson=${scopedLesson}` : ""}` : "/app/tutor"}>
                  Full screen
                </Link>
              </Button>
            </Tooltip>
          </div>
        </div>
        <TutorChat
          key={scope}
          compact
          sessionId={sessionId || null}
          onSessionId={(id) => setSessions((s) => ({ ...s, [scope]: id }))}
          courseId={scopedCourse}
          lessonId={scopedLesson}
          contextLabel={course?.title}
          prompts={starters}
          contextNote={
            notEnrolled || contextNote ? (
              <>
                {contextNote}
                {notEnrolled && (
                  <span className={contextNote ? "mt-1.5 block text-violet-800/80" : undefined}>
                    You aren&rsquo;t enrolled in the related course, so answers draw on all of your courses.
                  </span>
                )}
              </>
            ) : undefined
          }
          className="min-h-0 flex-1"
        />
      </SheetContent>
    </Sheet>
  );
}
