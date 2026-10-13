"use client";

import { Alert, Button, cn, Skeleton, toast, Tooltip } from "@praxis/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Bot, BookOpenText, CloudOff, Lightbulb, RefreshCw, ShieldAlert, Sparkles, Square, ThumbsDown, ThumbsUp } from "lucide-react";
import * as React from "react";
import { ApiError, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { firstName } from "@/lib/format";
import { SourceChips, TutorMarkdown } from "./citations";
import {
  createTutorSession,
  fetchTutorMessages,
  rateTutorMessage,
  streamTutorAnswer,
  tutorErrorMessage,
  tutorKeys,
  type TutorMessage,
} from "./use-tutor";

const MAX = 4000;

/** Generic starters for an unscoped conversation (no course or lesson context). */
export const DEFAULT_PROMPTS = [
  "Explain a tricky concept from my courses in simpler terms",
  "Quiz me on what I've been learning",
  "Give me a real-world example of something I'm studying",
  "What should I focus on next?",
  "What mistakes do people usually make when they start out?",
  "Help me make a quick revision plan",
];

/** Starters for a single lesson. */
export const LESSON_PROMPTS = [
  "Explain this lesson in simpler terms",
  "Give me a real-world example of this",
  "Quiz me on the key points of this lesson",
  "What mistakes do people usually make here?",
];

/** The flagship IT support course (network troubleshooting) keeps its signature starter. */
const NETWORK_COURSE = /network|it support|service desk|help ?desk|troubleshoot|connectiv/i;

/** Starters for a whole course; adds the DNS question for the flagship IT support course. */
export function coursePrompts(courseTitle?: string | null): string[] {
  const base = [
    courseTitle ? `What are the key ideas in ${courseTitle}?` : "What are the key ideas in this course?",
    "Quiz me on the key points",
    "Give me a real-world example",
    "What mistakes do people usually make here?",
    "Summarise what I should remember",
  ];
  return courseTitle && NETWORK_COURSE.test(courseTitle) ? ["Why would DNS cause this problem?", ...base] : base;
}

/* ------------------------------------------------------------------ mode badge */

export function ModeBadge({ mode }: { mode: string | null }) {
  if (mode === "hint")
    return (
      <Tooltip content="You have graded work in progress for this course (an assessment, assignment or simulation). To keep it fair, the tutor gives hints and guiding questions — not answers — until you submit.">
        <button type="button" className="inline-flex cursor-help items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-2xs font-semibold text-amber-900 ring-1 ring-inset ring-amber-200 focus-visible:focus-ring">
          <Lightbulb className="size-3" aria-hidden /> Hint mode — graded work in progress
        </button>
      </Tooltip>
    );
  if (mode === "refuse")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-2xs font-semibold text-rose-800 ring-1 ring-inset ring-rose-200">
        <ShieldAlert className="size-3" aria-hidden /> Outside what I can help with
      </span>
    );
  return null;
}

/* ------------------------------------------------------------------ message */

function AssistantMessage({ m, onRate }: { m: TutorMessage; onRate: (r: 1 | -1) => void }) {
  const refuse = m.mode === "refuse";
  return (
    <div className="flex items-start gap-3 motion-safe:animate-fade-up">
      <span className={cn("grid size-8 shrink-0 place-items-center rounded-xl text-white shadow-sm", refuse ? "bg-gradient-to-br from-rose-400 to-pink-500" : "bg-gradient-to-br from-violet-500 to-fuchsia-500")}>
        {refuse ? <ShieldAlert className="size-4" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
      </span>
      <div className="min-w-0 flex-1">
        {(m.mode === "hint" || refuse) && (
          <div className="mb-1.5">
            <ModeBadge mode={m.mode} />
          </div>
        )}
        <div className={cn("rounded-2xl rounded-tl-md px-4 py-3", refuse ? "bg-rose-50/70 ring-1 ring-inset ring-rose-200" : m.mode === "hint" ? "bg-amber-50/50 ring-1 ring-inset ring-amber-200/80" : "bg-white ring-1 ring-inset ring-slate-200")}>
          {m.content ? (
            <div className="relative">
              <TutorMarkdown className="text-[14.5px]" citations={m.streaming ? [] : (m.citations ?? [])}>
                {m.content}
              </TutorMarkdown>
              {m.streaming && <span className="ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 rounded-sm bg-violet-500 motion-safe:animate-pulse" aria-hidden />}
            </div>
          ) : (
            <div className="flex items-center gap-1.5 py-1" aria-label="The tutor is thinking">
              {[0, 1, 2].map((i) => (
                <span key={i} className="size-2 rounded-full bg-violet-400 motion-safe:animate-bounce" style={{ animationDelay: `${i * 140}ms` }} />
              ))}
            </div>
          )}
        </div>
        {!m.streaming && m.citations?.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-2xs font-semibold uppercase tracking-wider text-slate-500">Sources</span>
            <SourceChips citations={m.citations} />
          </div>
        )}
        {!m.streaming && !m.pending && !m.id.startsWith("tmp-") && (
          <div className="mt-1.5 flex items-center gap-1">
            <Tooltip content="Helpful">
              <button
                type="button"
                onClick={() => onRate(1)}
                aria-pressed={m.feedback_rating === 1}
                aria-label="Helpful"
                className={cn("grid size-7 place-items-center rounded-lg transition-colors focus-visible:focus-ring", m.feedback_rating === 1 ? "bg-emerald-50 text-emerald-600" : "text-slate-400 hover:bg-slate-100 hover:text-slate-700")}
              >
                <ThumbsUp className="size-3.5" aria-hidden />
              </button>
            </Tooltip>
            <Tooltip content="Not helpful">
              <button
                type="button"
                onClick={() => onRate(-1)}
                aria-pressed={m.feedback_rating === -1}
                aria-label="Not helpful"
                className={cn("grid size-7 place-items-center rounded-lg transition-colors focus-visible:focus-ring", m.feedback_rating === -1 ? "bg-rose-50 text-rose-600" : "text-slate-400 hover:bg-slate-100 hover:text-slate-700")}
              >
                <ThumbsDown className="size-3.5" aria-hidden />
              </button>
            </Tooltip>
            {m.model && <span className="ml-1 text-2xs text-slate-500">{/offline/i.test(m.model) ? "Offline demo model" : m.model}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function UserMessage({ m }: { m: TutorMessage }) {
  return (
    <div className="flex justify-end">
      <div className={cn("max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tr-md bg-gradient-to-br from-indigo-600 to-violet-600 px-4 py-2.5 text-[14.5px] text-white shadow-sm", m.pending && "opacity-80")}>
        {m.content}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ chat */

export interface TutorChatProps {
  sessionId: string | null;
  onSessionId: (id: string) => void;
  courseId?: string | null;
  lessonId?: string | null;
  contextLabel?: string | null;
  compact?: boolean;
  prompts?: string[];
  className?: string;
  /** Rendered above the composer (e.g. context selector). */
  composerAddon?: React.ReactNode;
  /** Shown in the welcome state, e.g. what the host page is about ("Debrief: …"). */
  contextNote?: React.ReactNode;
}

export function TutorChat({ sessionId, onSessionId, courseId, lessonId, contextLabel, compact, prompts = DEFAULT_PROMPTS, className, composerAddon, contextNote }: TutorChatProps) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [messages, setMessages] = React.useState<TutorMessage[]>([]);
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [offline, setOffline] = React.useState(false);
  const [gate, setGate] = React.useState<{ err: unknown; retry: string } | null>(null);
  const ownSession = React.useRef<string | null>(null);
  const abort = React.useRef<AbortController | null>(null);
  const scroller = React.useRef<HTMLDivElement>(null);
  const input = React.useRef<HTMLTextAreaElement>(null);

  const history = useQuery({
    queryKey: tutorKeys.messages(sessionId ?? "none"),
    queryFn: ({ signal }) => fetchTutorMessages(sessionId!, signal),
    enabled: !!sessionId && sessionId !== ownSession.current,
  });

  // Switching sessions: load stored history (skip for the session this component just created).
  React.useEffect(() => {
    if (!sessionId) {
      if (!ownSession.current) setMessages([]);
      return;
    }
    if (sessionId === ownSession.current) return;
    ownSession.current = null;
    setGate(null);
    if (history.data) {
      setMessages(history.data);
      setOffline(history.data.some((m) => m.role === "assistant" && /offline/i.test(m.model ?? "")));
    }
  }, [sessionId, history.data]);

  React.useEffect(() => {
    if (!sessionId) {
      ownSession.current = null;
      setMessages([]);
      setGate(null);
    }
  }, [sessionId]);

  React.useEffect(() => {
    const el = scroller.current;
    // Keep the welcome state scrolled to the top; follow the conversation once it starts.
    if (el && messages.length) el.scrollTo({ top: el.scrollHeight, behavior: busy ? "auto" : "smooth" });
  }, [messages, busy]);

  React.useEffect(() => () => abort.current?.abort(), []);

  const send = async (raw: string) => {
    const content = raw.trim().slice(0, MAX);
    if (!content || busy) return;
    setBusy(true);
    setGate(null);
    setText("");
    const now = new Date().toISOString();
    const userTmp: TutorMessage = { id: `tmp-u-${Date.now()}`, role: "user", content, mode: null, citations: [], model: null, feedback_rating: null, created_at: now, pending: true };
    const botTmp: TutorMessage = { id: `tmp-a-${Date.now()}`, role: "assistant", content: "", mode: null, citations: [], model: null, feedback_rating: null, created_at: now, streaming: true };
    setMessages((m) => [...m, userTmp, botTmp]);
    let sid = sessionId;
    try {
      if (!sid) {
        const s = await createTutorSession({ course_id: courseId, lesson_id: lessonId, title: content.slice(0, 80) });
        sid = s.id;
        ownSession.current = s.id;
        onSessionId(s.id);
      }
      abort.current = new AbortController();
      let botId = botTmp.id;
      await streamTutorAnswer(
        sid,
        { content, lesson_id: lessonId },
        {
          onMeta: (meta) => {
            setOffline(meta.offline);
            botId = meta.assistant_message_id;
            setMessages((list) =>
              list.map((x) =>
                x.id === userTmp.id ? { ...x, id: meta.user_message_id, pending: false } : x.id === botTmp.id ? { ...x, id: meta.assistant_message_id, mode: meta.mode, citations: meta.citations } : x,
              ),
            );
          },
          onDelta: (t) => setMessages((list) => list.map((x) => (x.id === botId ? { ...x, content: x.content + t } : x))),
          onDone: (final) => setMessages((list) => list.map((x) => (x.id === botId ? { ...final, streaming: false } : x))),
        },
        abort.current.signal,
      );
      setMessages((list) => list.map((x) => (x.id === botId ? { ...x, streaming: false } : x)));
      qc.invalidateQueries({ queryKey: ["tutor", "sessions"] });
      if (sid) qc.removeQueries({ queryKey: tutorKeys.messages(sid) });
    } catch (err) {
      if ((err as Error)?.name === "AbortError") {
        setMessages((list) => list.map((x) => (x.streaming ? { ...x, streaming: false, content: x.content || "_Stopped._" } : x)));
      } else {
        setMessages((list) => list.filter((x) => x.id !== botTmp.id && x.id !== userTmp.id));
        setGate({ err, retry: content });
        setText(content);
      }
    } finally {
      abort.current = null;
      setBusy(false);
      requestAnimationFrame(() => input.current?.focus());
    }
  };

  const rate = async (id: string, r: 1 | -1) => {
    const prev = messages.find((m) => m.id === id)?.feedback_rating ?? null;
    setMessages((list) => list.map((m) => (m.id === id ? { ...m, feedback_rating: r } : m)));
    try {
      await rateTutorMessage(id, r);
      toast.success("Thanks for the feedback");
    } catch (err) {
      setMessages((list) => list.map((m) => (m.id === id ? { ...m, feedback_rating: prev } : m)));
      toast.error(errorMessage(err));
    }
  };

  const loading = !!sessionId && sessionId !== ownSession.current && history.isLoading;
  const empty = !loading && messages.length === 0;
  const gateInfo = gate ? tutorErrorMessage(gate.err) : null;
  const canRetry = gate && !(gate.err instanceof ApiError && [402, 403].includes(gate.err.status));

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      {offline && (
        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
          <CloudOff className="size-3.5 shrink-0" aria-hidden />
          Running on the offline demo model — configure an AI provider for full answers.
        </div>
      )}
      <div ref={scroller} className={cn("relative min-h-0 flex-1 overflow-y-auto scrollbar-thin", compact ? "px-4 py-4" : "px-4 py-6 sm:px-8")} role="log" aria-live="polite" aria-busy={busy} aria-label="Tutor conversation">
        <div className={cn("mx-auto space-y-5", !compact && "max-w-3xl")}>
          {history.isError && (
            <Alert tone="danger" title="Couldn't load this conversation" action={<Button size="xs" variant="secondary" onClick={() => history.refetch()}>Retry</Button>}>
              {errorMessage(history.error)}
            </Alert>
          )}
          {loading && (
            <div className="space-y-4" aria-label="Loading conversation">
              <Skeleton className="ml-auto h-10 w-2/3 rounded-2xl" />
              <Skeleton className="h-28 w-5/6 rounded-2xl" />
              <Skeleton className="ml-auto h-10 w-1/2 rounded-2xl" />
            </div>
          )}
          {empty && (
            <div className={cn("text-center", compact ? "py-4" : "py-10")}>
              <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 via-fuchsia-500 to-pink-500 text-white shadow-glow motion-safe:animate-float">
                <Bot className="size-7" aria-hidden />
              </span>
              <h2 className={cn("mt-4 font-display font-bold tracking-tight text-slate-900", compact ? "text-lg" : "text-2xl")}>
                Hi {firstName(user?.full_name)}, what are you curious about?
              </h2>
              <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">
                {contextLabel ? (
                  <>
                    Answers are grounded in <span className="font-semibold text-slate-700">{contextLabel}</span> and cite their sources.
                  </>
                ) : (
                  "Ask about anything in your courses. Answers cite the materials they come from."
                )}
              </p>
              {contextNote && (
                <div className="mx-auto mt-4 max-w-md rounded-2xl bg-violet-50/70 px-3.5 py-2.5 text-left text-xs leading-relaxed text-violet-950 ring-1 ring-inset ring-violet-200/80">
                  {contextNote}
                </div>
              )}
              <div className={cn("mx-auto mt-6 grid gap-2 text-left", compact ? "grid-cols-1" : "max-w-2xl sm:grid-cols-2")}>
                {prompts.slice(0, compact ? 4 : 6).map((p, i) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => send(p)}
                    disabled={busy}
                    className="group flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3.5 py-3 text-left text-sm text-slate-700 shadow-sm transition-all hover:-translate-y-0.5 hover:border-violet-200 hover:shadow-lift focus-visible:focus-ring"
                  >
                    <span
                      className={cn(
                        "grid size-8 shrink-0 place-items-center rounded-xl text-white",
                        ["bg-gradient-to-br from-violet-500 to-fuchsia-500", "bg-gradient-to-br from-sky-400 to-blue-500", "bg-gradient-to-br from-emerald-400 to-teal-500", "bg-gradient-to-br from-amber-400 to-orange-500", "bg-gradient-to-br from-rose-400 to-pink-500", "bg-gradient-to-br from-indigo-500 to-violet-500"][i % 6],
                      )}
                    >
                      {i % 2 ? <BookOpenText className="size-4" aria-hidden /> : <Lightbulb className="size-4" aria-hidden />}
                    </span>
                    <span className="font-medium group-hover:text-slate-900">{p}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m) => (m.role === "user" ? <UserMessage key={m.id} m={m} /> : <AssistantMessage key={m.id} m={m} onRate={(r) => rate(m.id, r)} />))}
          {gateInfo && (
            <Alert
              tone={gateInfo.tone === "info" ? "info" : gateInfo.tone === "warning" ? "warning" : "danger"}
              title={gateInfo.title}
              action={
                canRetry ? (
                  <Button size="xs" variant="secondary" leftIcon={<RefreshCw />} onClick={() => send(gate!.retry)}>
                    Try again
                  </Button>
                ) : undefined
              }
            >
              {gateInfo.body}
            </Alert>
          )}
        </div>
      </div>

      <div className={cn("border-t border-slate-200/80 bg-white/90 backdrop-blur", compact ? "p-3" : "px-4 py-4 sm:px-8")}>
        <div className={cn("mx-auto", !compact && "max-w-3xl")}>
          {composerAddon}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(text);
            }}
            className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm transition focus-within:border-violet-300 focus-within:ring-4 focus-within:ring-violet-100"
          >
            <label htmlFor={compact ? "tutor-input-panel" : "tutor-input"} className="sr-only">
              Ask the tutor
            </label>
            <textarea
              id={compact ? "tutor-input-panel" : "tutor-input"}
              ref={input}
              value={text}
              rows={1}
              maxLength={MAX}
              onChange={(e) => {
                setText(e.target.value);
                e.currentTarget.style.height = "auto";
                e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 180)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(text);
                }
              }}
              placeholder="Ask a question, or ask for a hint…"
              className="max-h-44 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-[15px] text-slate-900 outline-none placeholder:text-slate-400"
            />
            {busy ? (
              <Button type="button" size="icon-sm" variant="secondary" className="size-10 rounded-xl" onClick={() => abort.current?.abort()} aria-label="Stop generating">
                <Square className="size-3.5 fill-current" aria-hidden />
              </Button>
            ) : (
              <Button type="submit" size="icon-sm" variant="gradient" className="size-10 rounded-xl" disabled={!text.trim()} aria-label="Send question">
                <ArrowUp className="size-4" aria-hidden />
              </Button>
            )}
          </form>
          <p className="mt-2 flex items-center justify-between gap-2 px-1 text-2xs text-slate-500">
            <span>AI can make mistakes — check the cited sources.</span>
            {text.length > MAX * 0.8 && (
              <span className={cn("tabular-nums", text.length >= MAX && "text-rose-600")}>
                {text.length}/{MAX}
              </span>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
