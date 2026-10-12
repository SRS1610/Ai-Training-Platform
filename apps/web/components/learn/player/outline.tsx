"use client";

import { Tooltip, cn, colorClasses } from "@praxis/ui";
import { CheckCircle2, ChevronDown, Circle, CircleDashed, Lock } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { formatMinutes } from "@/lib/format";
import { lessonMeta } from "../meta";
import type { OutlineLesson, OutlineModule } from "../types";

export function lessonStatus(l: OutlineLesson): "completed" | "in_progress" | "locked" | "not_started" {
  if (l.progress.status === "completed") return "completed";
  if (l.locked) return "locked";
  if (l.progress.status === "in_progress") return "in_progress";
  return "not_started";
}

export function StatusIcon({ lesson, className }: { lesson: OutlineLesson; className?: string }) {
  const s = lessonStatus(lesson);
  if (s === "completed") return <CheckCircle2 className={cn("size-[18px] text-emerald-600", className)} aria-label="Completed" />;
  if (s === "locked") return <Lock className={cn("size-4 text-slate-400", className)} aria-label="Locked" />;
  if (s === "in_progress") return <CircleDashed className={cn("size-[18px] text-sky-600", className)} aria-label="In progress" />;
  return <Circle className={cn("size-[18px] text-slate-300", className)} aria-label="Not started" />;
}

/** Compact module → lesson navigator for the player sidebar. */
export function PlayerOutline({
  courseId,
  modules,
  currentLessonId,
  onNavigate,
}: {
  courseId: string;
  modules: OutlineModule[];
  currentLessonId?: string;
  onNavigate?: () => void;
}) {
  const currentModule = modules.find((m) => m.lessons.some((l) => l.id === currentLessonId))?.id;
  const [open, setOpen] = React.useState<Set<string>>(() => new Set(currentModule ? [currentModule] : modules.slice(0, 1).map((m) => m.id)));
  React.useEffect(() => {
    if (currentModule) setOpen((s) => (s.has(currentModule) ? s : new Set([...s, currentModule])));
  }, [currentModule]);
  const activeRef = React.useRef<HTMLAnchorElement>(null);
  React.useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [currentLessonId]);

  return (
    <nav aria-label="Course outline">
      <ol className="space-y-2">
        {modules.map((m, mi) => {
          const done = m.lessons.filter((l) => l.progress.status === "completed").length;
          const isOpen = open.has(m.id);
          const pct = m.lessons.length ? (done / m.lessons.length) * 100 : 0;
          return (
            <li key={m.id} className="rounded-2xl">
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() =>
                  setOpen((s) => {
                    const n = new Set(s);
                    if (n.has(m.id)) n.delete(m.id);
                    else n.add(m.id);
                    return n;
                  })
                }
                className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-slate-100/70 focus-visible:focus-ring"
              >
                <span
                  className={cn(
                    "relative grid size-8 shrink-0 place-items-center rounded-lg font-display text-xs font-bold",
                    done === m.lessons.length && m.lessons.length > 0 ? "bg-emerald-500 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200",
                  )}
                >
                  {done === m.lessons.length && m.lessons.length > 0 ? <CheckCircle2 className="size-4" aria-hidden /> : mi + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-900">{m.title}</span>
                  <span className="mt-1 flex items-center gap-2">
                    <span className="h-1 flex-1 overflow-hidden rounded-full bg-slate-200">
                      <span className="block h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-500" style={{ width: `${pct}%` }} />
                    </span>
                    <span className="text-2xs tabular-nums text-slate-500">
                      {done}/{m.lessons.length}
                    </span>
                  </span>
                </span>
                <ChevronDown className={cn("size-4 shrink-0 text-slate-400 transition-transform", isOpen && "rotate-180")} aria-hidden />
              </button>
              {isOpen && (
                <ol className="mt-1 space-y-0.5 pl-2">
                  {m.lessons.map((l) => {
                    const meta = lessonMeta(l.lesson_type);
                    const c = colorClasses(meta.color);
                    const current = l.id === currentLessonId;
                    const locked = l.locked && l.progress.status !== "completed";
                    const inner = (
                      <>
                        <StatusIcon lesson={l} className="shrink-0" />
                        <span className="min-w-0 flex-1">
                          <span className={cn("block truncate text-sm", current ? "font-semibold text-slate-900" : "text-slate-700")}>{l.title}</span>
                          <span className="flex items-center gap-1.5 text-2xs text-slate-500">
                            <meta.icon className={cn("size-3", c.icon)} aria-hidden />
                            {meta.label}
                            {l.duration_minutes ? ` · ${formatMinutes(l.duration_minutes)}` : ""}
                            {!l.is_required && " · Optional"}
                          </span>
                        </span>
                      </>
                    );
                    return (
                      <li key={l.id}>
                        {locked ? (
                          <Tooltip content="Complete the earlier lessons first" side="right">
                            <span className="flex cursor-not-allowed items-center gap-2.5 rounded-xl px-2 py-2 opacity-60" aria-disabled="true">
                              {inner}
                            </span>
                          </Tooltip>
                        ) : (
                          <Link
                            ref={current ? activeRef : undefined}
                            href={`/app/learn/${courseId}/lesson/${l.id}`}
                            onClick={onNavigate}
                            aria-current={current ? "page" : undefined}
                            className={cn(
                              "relative flex items-center gap-2.5 rounded-xl px-2 py-2 transition focus-visible:focus-ring",
                              current ? "bg-white shadow-soft ring-1 ring-brand-200" : "hover:bg-slate-100/70",
                            )}
                          >
                            {current && <span className="absolute -left-2 top-2 bottom-2 w-1 rounded-full bg-brand-gradient" aria-hidden />}
                            {inner}
                          </Link>
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
