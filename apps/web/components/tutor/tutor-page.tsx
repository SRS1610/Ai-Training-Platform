"use client";

import {
  Button,
  categoryClasses,
  cn,
  ConfirmDialog,
  Input,
  SimpleSelect,
  Sheet,
  SheetContent,
  SheetTitle,
  Skeleton,
  toast,
  Tooltip,
} from "@praxis/ui";
import { useQueryClient } from "@tanstack/react-query";
import { BookOpen, Bot, GraduationCap, History, Layers, MessageSquareText, Plus, Search, Trash2 } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { ErrorState } from "@/components/common/error-state";
import { api, errorMessage } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import { TutorChat } from "./tutor-chat";
import { type TutorSession, useCourseLessons, useMyEnrolments, useTutorSessions } from "./use-tutor";

function useFillHeight(ref: React.RefObject<HTMLElement | null>, min = 520) {
  const [h, setH] = React.useState<number | null>(null);
  React.useLayoutEffect(() => {
    const measure = () => {
      const el = ref.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      const bottomPad = window.innerWidth >= 1024 ? 32 : 104; // leave room for the mobile tab bar
      setH(Math.max(min, window.innerHeight - top - bottomPad));
    };
    measure();
    window.addEventListener("resize", measure);
    // Re-measure when content above shifts (banners, fonts).
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => measure()) : null;
    ro?.observe(document.body);
    return () => {
      window.removeEventListener("resize", measure);
      ro?.disconnect();
    };
  }, [ref, min]);
  return h;
}

function groupByDate(items: TutorSession[]) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const groups: { label: string; items: TutorSession[] }[] = [
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Previous 7 days", items: [] },
    { label: "Older", items: [] },
  ];
  for (const s of items) {
    const t = new Date(s.updated_at).getTime();
    const g = t >= start ? 0 : t >= start - 86400000 ? 1 : t >= start - 7 * 86400000 ? 2 : 3;
    groups[g]!.items.push(s);
  }
  return groups.filter((g) => g.items.length);
}

export function TutorPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const qc = useQueryClient();
  const sessionId = params.get("session");
  const courseParam = params.get("course");
  const lessonParam = params.get("lesson");
  const sessions = useTutorSessions();
  const enrolments = useMyEnrolments();
  const [q, setQ] = React.useState("");
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [toDelete, setToDelete] = React.useState<TutorSession | null>(null);
  const shell = React.useRef<HTMLDivElement>(null);
  // Remount the chat only on explicit navigation, never when a new chat gets its session id mid-stream.
  const [chatKey, setChatKey] = React.useState(0);
  const height = useFillHeight(shell);

  const current = sessions.data?.items.find((s) => s.id === sessionId) ?? null;
  const ctxCourse = current ? current.course_id : courseParam;
  const ctxLesson = current ? current.lesson_id : lessonParam;
  const lessons = useCourseLessons(ctxCourse);
  const courseById = React.useMemo(() => new Map((enrolments.data ?? []).map((e) => [e.course_id, e])), [enrolments.data]);
  const lessonTitle = React.useMemo(() => {
    for (const m of lessons.data ?? []) for (const l of m.lessons) if (l.id === ctxLesson) return l.title;
    return null;
  }, [lessons.data, ctxLesson]);
  const courseTitle = ctxCourse ? courseById.get(ctxCourse)?.title ?? "Course" : null;

  const setParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    const s = next.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  };

  const newChat = (keepContext = true) => {
    setChatKey((k) => k + 1);
    setParams({ session: null, course: keepContext ? ctxCourse : null, lesson: keepContext ? ctxLesson : null });
    setHistoryOpen(false);
  };

  const remove = async () => {
    if (!toDelete) return;
    try {
      await api.delete(`/ai/tutor/sessions/${toDelete.id}`);
      toast.success("Conversation deleted");
      qc.invalidateQueries({ queryKey: ["tutor", "sessions"] });
      if (toDelete.id === sessionId) newChat(false);
      setToDelete(null);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const filtered = (sessions.data?.items ?? []).filter((s) => !q || (s.title ?? "").toLowerCase().includes(q.toLowerCase()));

  const list = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-3 p-3">
        <Button variant="gradient" block leftIcon={<Plus />} onClick={() => newChat(false)}>
          New conversation
        </Button>
        <Input inputSize="sm" leftIcon={<Search />} placeholder="Search conversations…" aria-label="Search conversations" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 scrollbar-thin" aria-label="Conversations">
        {sessions.isError ? (
          <ErrorState error={sessions.error} onRetry={() => sessions.refetch()} size="sm" />
        ) : sessions.isLoading ? (
          <div className="space-y-2 px-1">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-14 rounded-xl" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-3 py-10 text-center">
            <MessageSquareText className="mx-auto size-8 text-violet-300" aria-hidden />
            <p className="mt-2 text-sm font-medium text-slate-700">{q ? "No matches" : "No conversations yet"}</p>
            <p className="text-xs text-muted-foreground">{q ? "Try another search." : "Your questions and answers will be saved here."}</p>
          </div>
        ) : (
          groupByDate(filtered).map((g) => (
            <div key={g.label} className="mb-3">
              <p className="px-2 pb-1 pt-2 text-2xs font-semibold uppercase tracking-wider text-slate-400">{g.label}</p>
              <ul className="space-y-0.5">
                {g.items.map((s) => {
                  const on = s.id === sessionId;
                  const course = s.course_id ? courseById.get(s.course_id) : null;
                  const cc = categoryClasses(course?.category ?? course?.title ?? "general");
                  return (
                    <li key={s.id} className="group relative">
                      <button
                        type="button"
                        onClick={() => {
                          if (s.id !== sessionId) setChatKey((k) => k + 1);
                          setParams({ session: s.id, course: null, lesson: null });
                          setHistoryOpen(false);
                        }}
                        aria-current={on ? "page" : undefined}
                        className={cn(
                          "flex w-full flex-col items-start rounded-xl px-3 py-2.5 pr-9 text-left transition-colors focus-visible:focus-ring",
                          on ? "bg-violet-50 ring-1 ring-inset ring-violet-200" : "hover:bg-slate-100/80",
                        )}
                      >
                        <span className={cn("line-clamp-1 text-sm font-medium", on ? "text-violet-900" : "text-slate-800")}>{s.title || "New conversation"}</span>
                        <span className="mt-1 flex w-full items-center gap-2 text-2xs text-slate-500">
                          {course ? (
                            <span className={cn("inline-flex max-w-[9rem] items-center gap-1 truncate rounded-full px-1.5 py-0.5 font-medium", cc.soft, cc.text)}>
                              <span className={cn("size-1.5 shrink-0 rounded-full", cc.solid)} aria-hidden />
                              <span className="truncate">{course.title}</span>
                            </span>
                          ) : (
                            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600">General</span>
                          )}
                          <span className="ml-auto shrink-0">{formatRelative(s.updated_at)}</span>
                        </span>
                      </button>
                      <Tooltip content="Delete conversation">
                        <button
                          type="button"
                          onClick={() => setToDelete(s)}
                          aria-label={`Delete ${s.title || "conversation"}`}
                          className="absolute right-1.5 top-2 grid size-7 place-items-center rounded-lg text-slate-400 opacity-0 transition hover:bg-rose-50 hover:text-rose-600 focus-visible:opacity-100 focus-visible:focus-ring group-hover:opacity-100"
                        >
                          <Trash2 className="size-3.5" aria-hidden />
                        </button>
                      </Tooltip>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </nav>
    </div>
  );

  const contextBar = current ? (
    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
      <span className="font-medium text-slate-500">Context:</span>
      {courseTitle ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 font-medium text-sky-800 ring-1 ring-inset ring-sky-200">
          <GraduationCap className="size-3" aria-hidden /> {courseTitle}
        </span>
      ) : (
        <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium">All my courses</span>
      )}
      {lessonTitle && (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-800 ring-1 ring-inset ring-emerald-200">
          <BookOpen className="size-3" aria-hidden /> {lessonTitle}
        </span>
      )}
    </div>
  ) : (
    <div className="mb-2 grid gap-2 sm:grid-cols-2">
      <SimpleSelect
        aria-label="Course context"
        value={ctxCourse ?? "all"}
        onValueChange={(v) => setParams({ course: v === "all" ? null : v, lesson: null })}
        options={[{ value: "all", label: "All my courses" }, ...(enrolments.data ?? []).map((e) => ({ value: e.course_id, label: e.title }))]}
        disabled={enrolments.isLoading}
      />
      <SimpleSelect
        aria-label="Lesson context"
        value={ctxLesson ?? "all"}
        onValueChange={(v) => setParams({ lesson: v === "all" ? null : v })}
        options={[
          { value: "all", label: ctxCourse ? "Whole course" : "Pick a course first" },
          ...(lessons.data ?? []).flatMap((m) => m.lessons.map((l) => ({ value: l.id, label: `${m.title} · ${l.title}` }))),
        ]}
        disabled={!ctxCourse || lessons.isLoading}
      />
    </div>
  );

  return (
    <div className="-mt-2 lg:-mt-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 via-fuchsia-500 to-pink-500 text-white shadow-glow">
            <Bot className="size-6" aria-hidden />
          </span>
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">AI Tutor</h1>
            <p className="text-sm text-muted-foreground">Explanations grounded in your courses — with sources you can check.</p>
          </div>
        </div>
        <div className="flex items-center gap-2 lg:hidden">
          <Button variant="secondary" size="sm" leftIcon={<History />} onClick={() => setHistoryOpen(true)}>
            History
          </Button>
          <Button variant="soft" size="sm" leftIcon={<Plus />} onClick={() => newChat(false)}>
            New
          </Button>
        </div>
      </div>

      <div ref={shell} style={height ? { height } : undefined} className="flex min-h-[32rem] overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-soft">
        <aside className="hidden w-72 shrink-0 border-r border-slate-200/80 bg-slate-50/70 lg:block">{list}</aside>
        <section className="relative flex min-w-0 flex-1 flex-col bg-gradient-to-b from-violet-50/40 via-white to-white" aria-label="Conversation">
          <div className="flex items-center gap-2 border-b border-slate-200/70 px-4 py-2.5 sm:px-6">
            <Layers className="size-4 text-violet-500" aria-hidden />
            <p className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">{current?.title || "New conversation"}</p>
            {current && (
              <Button size="xs" variant="ghost" leftIcon={<Plus />} onClick={() => newChat(true)}>
                New in this context
              </Button>
            )}
          </div>
          <TutorChat
            key={chatKey}
            sessionId={sessionId}
            onSessionId={(id) => setParams({ session: id, course: null, lesson: null })}
            courseId={ctxCourse}
            lessonId={ctxLesson}
            contextLabel={lessonTitle ? `${lessonTitle}` : courseTitle}
            composerAddon={contextBar}
            className="min-h-0 flex-1"
          />
        </section>
      </div>

      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent side="left" className="w-[88%] max-w-sm gap-0 p-0">
          <SheetTitle className="px-4 pt-5 text-base">Conversations</SheetTitle>
          {list}
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Delete this conversation?"
        description="The messages are removed permanently. This can't be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={remove}
      />
    </div>
  );
}
