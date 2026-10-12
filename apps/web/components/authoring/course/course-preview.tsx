"use client";

import { Badge, Button, Dialog, DialogContent, DialogDescription, DialogTitle, Progress, cn } from "@praxis/ui";
import { ArrowLeft, ArrowRight, CheckCircle2, Eye, Lock } from "lucide-react";
import * as React from "react";
import { formatMinutes } from "@/lib/format";
import { lessonMeta } from "../meta";
import { TypeChip } from "../shared";
import type { Structure } from "../types";
import { LessonRender } from "./lesson-render";

/** Full-screen "preview as learner" of the current draft (no enrolment or publish needed). */
export function CoursePreview({ open, onOpenChange, structure, startLessonId }: { open: boolean; onOpenChange: (o: boolean) => void; structure: Structure; startLessonId?: string | null }) {
  const lessons = structure.modules.flatMap((m) => m.lessons.map((l) => ({ ...l, moduleTitle: m.title })));
  const [idx, setIdx] = React.useState(0);
  React.useEffect(() => {
    if (open) {
      const i = startLessonId ? lessons.findIndex((l) => l.id === startLessonId) : 0;
      setIdx(Math.max(0, i));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const cur = lessons[idx];
  const minutes = lessons.reduce((s, l) => s + (l.duration_minutes || 0), 0);
  const seq = structure.course.sequential;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent hideClose={false} className="h-[calc(100dvh-1rem)] max-h-none w-[calc(100%-1rem)] max-w-[1280px] gap-0 overflow-hidden p-0 sm:h-[calc(100dvh-3rem)]">
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex items-center gap-3 border-b border-slate-200 bg-gradient-to-r from-brand-50 via-white to-fuchsia-50 px-5 py-3 pr-14">
            <Badge tone="violet" size="sm">
              <Eye aria-hidden /> Learner preview
            </Badge>
            <div className="min-w-0">
              <DialogTitle className="truncate text-base">{structure.course.title}</DialogTitle>
              <DialogDescription className="truncate text-xs">
                Draft · {lessons.length} lessons · {formatMinutes(minutes)} · progress is not recorded
              </DialogDescription>
            </div>
          </div>
          <div className="flex min-h-0 flex-1">
            <nav aria-label="Course outline" className="hidden w-80 shrink-0 overflow-y-auto border-r border-slate-200 bg-slate-50/70 p-3 scrollbar-thin md:block">
              <Progress value={lessons.length ? ((idx + 1) / lessons.length) * 100 : 0} size="xs" className="mb-3" aria-label="Preview position" />
              {structure.modules.map((m, mi) => (
                <div key={m.id} className="mb-3">
                  <p className="mb-1 px-2 text-2xs font-bold uppercase tracking-wider text-slate-500">
                    {mi + 1}. {m.title}
                  </p>
                  <ul className="space-y-0.5">
                    {m.lessons.map((l) => {
                      const i = lessons.findIndex((x) => x.id === l.id);
                      const on = i === idx;
                      const locked = seq && i > idx;
                      return (
                        <li key={l.id}>
                          <button
                            type="button"
                            onClick={() => setIdx(i)}
                            aria-current={on ? "page" : undefined}
                            className={cn(
                              "flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-sm focus-visible:focus-ring",
                              on ? "bg-white font-semibold text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-700 hover:bg-white/70",
                            )}
                          >
                            {i < idx ? <CheckCircle2 className="size-4 shrink-0 text-emerald-500" aria-label="Viewed" /> : <TypeChip meta={lessonMeta(l.lesson_type)} size="xs" />}
                            <span className="min-w-0 flex-1 truncate">{l.title}</span>
                            {locked && <Lock className="size-3 text-slate-400" aria-label="Locked until earlier lessons are complete" />}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </nav>
            <div className="min-w-0 flex-1 overflow-y-auto scrollbar-thin">
              <div className="mx-auto max-w-3xl px-5 py-8 sm:px-8">
                {cur ? (
                  <>
                    <p className="mb-3 text-xs font-medium text-muted-foreground">{cur.moduleTitle}</p>
                    <LessonRender lesson={cur} />
                  </>
                ) : (
                  <p className="text-center text-muted-foreground">This course has no lessons yet.</p>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between border-t border-slate-200 bg-white px-5 py-3">
            <Button variant="secondary" leftIcon={<ArrowLeft />} disabled={idx <= 0} onClick={() => setIdx((i) => i - 1)}>
              Previous
            </Button>
            <span className="text-xs font-semibold tabular-nums text-slate-600">
              {lessons.length ? idx + 1 : 0} / {lessons.length}
            </span>
            <Button variant="primary" rightIcon={<ArrowRight />} disabled={idx >= lessons.length - 1} onClick={() => setIdx((i) => i + 1)}>
              Next lesson
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
