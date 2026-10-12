"use client";

import { Alert, Badge, Button, ConfirmDialog, Dialog, DialogContent, DialogDescription, DialogTitle, EmptyState, Skeleton, Spinner, cn, toast } from "@praxis/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, CheckCircle2, CloudOff, Flag, Loader2, Send, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import * as React from "react";
import { ErrorState } from "@/components/common/error-state";
import { Markdown } from "@/components/common/markdown";
import { QUESTION_LABELS } from "@/components/learn/meta";
import { QuestionInput, isAnswered } from "@/components/learn/quiz/question-input";
import { TimerChip } from "@/components/learn/quiz/timer";
import { lk } from "@/components/learn/query-keys";
import type { AnswerResponse, AnswerSaved, Attempt, AttemptSummary } from "@/components/learn/types";
import { ApiError, api, errorMessage } from "@/lib/api";

type SaveState = "idle" | "saving" | "saved" | "error";
const DEBOUNCE = 700;

function useFlags(attemptId: string) {
  const key = `praxis.quiz.flags.${attemptId}`;
  const [flags, setFlags] = React.useState<Set<string>>(new Set());
  React.useEffect(() => {
    try {
      setFlags(new Set(JSON.parse(localStorage.getItem(key) ?? "[]") as string[]));
    } catch {
      /* ignore */
    }
  }, [key]);
  const toggle = (id: string) =>
    setFlags((f) => {
      const n = new Set(f);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      try {
        localStorage.setItem(key, JSON.stringify([...n]));
      } catch {
        /* ignore */
      }
      return n;
    });
  return { flags, toggle };
}

export default function AttemptPage() {
  const { assessmentId, attemptId } = useParams<{ assessmentId: string; attemptId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: lk.quiz.attempt(attemptId),
    queryFn: ({ signal }) => api.get<Attempt>(`/attempts/${attemptId}`, { signal }),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: (n, err) => !(err instanceof ApiError && err.status < 500) && n < 2,
  });
  const attempt = q.data;

  const [responses, setResponses] = React.useState<Record<string, AnswerResponse>>({});
  const [current, setCurrent] = React.useState(0);
  const [saveState, setSaveState] = React.useState<SaveState>("idle");
  const [savedAt, setSavedAt] = React.useState<Date | null>(null);
  const [left, setLeft] = React.useState<number | null>(null);
  const [confirm, setConfirm] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [timeUp, setTimeUp] = React.useState(false);
  const [focusLost, setFocusLost] = React.useState(0);
  const [closed, setClosed] = React.useState<string | null>(null);
  const { flags, toggle: toggleFlag } = useFlags(attemptId);

  const timers = React.useRef(new Map<string, number>());
  const pending = React.useRef(new Map<string, AnswerResponse>());
  const inflight = React.useRef(new Set<Promise<unknown>>());
  const deadline = React.useRef<number | null>(null);
  const initialised = React.useRef(false);
  const warned = React.useRef({ five: false, one: false });

  // initialise from the server once
  React.useEffect(() => {
    if (!attempt || initialised.current) return;
    initialised.current = true;
    if (attempt.status !== "in_progress") {
      router.replace(`/app/quiz/${assessmentId}/result/${attemptId}`);
      return;
    }
    setResponses(attempt.responses as Record<string, AnswerResponse>);
    if (attempt.remaining_seconds !== null) {
      deadline.current = Date.now() + attempt.remaining_seconds * 1000;
      setLeft(attempt.remaining_seconds);
    }
    const firstOpen = attempt.questions.findIndex((qq) => !isAnswered(qq.question_type, attempt.responses[qq.id] as AnswerResponse | undefined));
    setCurrent(firstOpen > 0 ? firstOpen : 0);
  }, [attempt, assessmentId, attemptId, router]);

  const saveNow = React.useCallback(
    (qid: string) => {
      const body = pending.current.get(qid);
      if (!body) return Promise.resolve();
      pending.current.delete(qid);
      const t = timers.current.get(qid);
      if (t) window.clearTimeout(t);
      timers.current.delete(qid);
      setSaveState("saving");
      const p = api
        .put<AnswerSaved>(`/attempts/${attemptId}/answers/${qid}`, { response: body })
        .then((r) => {
          setSavedAt(new Date(r.saved_at));
          if (r.remaining_seconds !== null && r.remaining_seconds !== undefined) deadline.current = Date.now() + r.remaining_seconds * 1000;
          if (!pending.current.size) setSaveState("saved");
        })
        .catch((e) => {
          if (e instanceof ApiError && (e.code === "attempt_closed" || e.code === "attempt_expired")) {
            setClosed(e.code);
            return;
          }
          pending.current.set(qid, pending.current.get(qid) ?? body);
          setSaveState("error");
        })
        .finally(() => inflight.current.delete(p));
      inflight.current.add(p);
      return p;
    },
    [attemptId],
  );

  const flush = React.useCallback(async () => {
    await Promise.all([...pending.current.keys()].map((k) => saveNow(k)));
    await Promise.all([...inflight.current]);
  }, [saveNow]);

  const update = (qid: string, r: AnswerResponse) => {
    setResponses((s) => ({ ...s, [qid]: r }));
    pending.current.set(qid, r);
    setSaveState("saving");
    const t = timers.current.get(qid);
    if (t) window.clearTimeout(t);
    timers.current.set(qid, window.setTimeout(() => void saveNow(qid), DEBOUNCE));
  };

  const submit = React.useCallback(
    async (auto = false) => {
      if (submitting) return;
      setSubmitting(true);
      try {
        await flush();
        await api.post<AttemptSummary>(`/attempts/${attemptId}/submit`);
      } catch (e) {
        if (!(e instanceof ApiError && (e.code === "attempt_closed" || e.status === 409))) {
          toast.error(errorMessage(e));
          setSubmitting(false);
          if (!auto) throw e;
          return;
        }
      }
      qc.invalidateQueries({ queryKey: lk.quiz.overview(assessmentId) });
      qc.invalidateQueries({ queryKey: ["learn"] });
      qc.removeQueries({ queryKey: lk.quiz.attempt(attemptId) });
      try {
        localStorage.removeItem(`praxis.quiz.flags.${attemptId}`);
      } catch {
        /* ignore */
      }
      router.replace(`/app/quiz/${assessmentId}/result/${attemptId}`);
    },
    [submitting, flush, attemptId, qc, assessmentId, router],
  );

  // countdown
  React.useEffect(() => {
    if (left === null) return;
    const t = window.setInterval(() => {
      if (deadline.current === null) return;
      const secs = Math.max(0, Math.round((deadline.current - Date.now()) / 1000));
      setLeft(secs);
      if (secs <= 300 && secs > 60 && !warned.current.five) {
        warned.current.five = true;
        toast.warning("5 minutes left", { description: "Your answers are saved automatically." });
      }
      if (secs <= 60 && secs > 0 && !warned.current.one) {
        warned.current.one = true;
        toast.warning("1 minute left");
      }
      if (secs <= 0) {
        window.clearInterval(t);
        setTimeUp(true);
        void submit(true);
      }
    }, 1000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left === null]);

  // integrity signals (supplementary, review-only)
  React.useEffect(() => {
    if (!attempt || attempt.status !== "in_progress") return;
    const onVis = () => {
      const hidden = document.visibilityState === "hidden";
      if (hidden) setFocusLost((n) => n + 1);
      api.post(`/attempts/${attemptId}/integrity`, { event: hidden ? "focus_lost" : "focus_returned" }, { redirectOn401: false }).catch(() => undefined);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [attempt, attemptId]);

  // warn before leaving with unsaved answers
  React.useEffect(() => {
    const onBefore = (e: BeforeUnloadEvent) => {
      if (pending.current.size) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBefore);
    return () => window.removeEventListener("beforeunload", onBefore);
  }, []);

  // flush timers on unmount
  React.useEffect(
    () => () => {
      for (const k of [...pending.current.keys()]) void saveNow(k);
    },
    [saveNow],
  );

  if (q.isLoading || (attempt && !initialised.current))
    return (
      <div className="mx-auto max-w-6xl space-y-4" aria-busy aria-label="Loading attempt">
        <Skeleton className="h-16 rounded-2xl" />
        <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
          <Skeleton className="h-[28rem] rounded-3xl" />
          <Skeleton className="hidden h-72 rounded-2xl lg:block" />
        </div>
      </div>
    );
  if (q.isError || !attempt)
    return q.error instanceof ApiError && q.error.status === 404 ? (
      <EmptyState size="lg" illustration="search" title="Attempt not found" action={<Button asChild><Link href={`/app/quiz/${assessmentId}`}>Back to assessment</Link></Button>} />
    ) : (
      <ErrorState error={q.error} onRetry={() => q.refetch()} size="lg" />
    );

  const questions = [...attempt.questions].sort((a, b) => a.position - b.position);
  const question = questions[current];
  const answered = questions.filter((qq) => isAnswered(qq.question_type, responses[qq.id])).length;
  const unanswered = questions.map((qq, i) => ({ qq, i })).filter(({ qq }) => !isAnswered(qq.question_type, responses[qq.id]));
  const total = attempt.remaining_seconds !== null ? Math.max(attempt.remaining_seconds, left ?? 0) : null;
  const promptId = `q-${question?.id}-prompt`;

  return (
    <div className="mx-auto max-w-6xl">
      {/* attempt bar */}
      <div className="sticky top-16 z-10 -mx-4 mb-5 border-b border-slate-200/80 bg-white/90 px-4 py-3 backdrop-blur-xl sm:-mx-6 sm:px-6 lg:mx-0 lg:rounded-2xl lg:border lg:shadow-soft">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-base font-semibold text-slate-900">{attempt.title}</p>
            <div className="mt-1 flex items-center gap-2">
              <div className="h-1.5 w-28 overflow-hidden rounded-full bg-slate-100 sm:w-40" aria-hidden>
                <div className="h-full rounded-full bg-gradient-to-r from-brand-500 via-violet-500 to-fuchsia-500 transition-[width] duration-500" style={{ width: `${(answered / Math.max(1, questions.length)) * 100}%` }} />
              </div>
              <span className="text-xs font-medium tabular-nums text-slate-600">
                {answered}/{questions.length} answered · attempt {attempt.attempt_number}
              </span>
            </div>
          </div>
          <span className="hidden items-center gap-1.5 text-xs font-medium text-slate-500 sm:flex" aria-live="polite">
            {saveState === "saving" ? (
              <>
                <Loader2 className="size-3.5 animate-spin" aria-hidden /> Saving…
              </>
            ) : saveState === "error" ? (
              <span className="flex items-center gap-1.5 text-rose-700">
                <CloudOff className="size-3.5" aria-hidden /> Not saved — retrying on next change
              </span>
            ) : saveState === "saved" ? (
              <>
                <Check className="size-3.5 text-emerald-600" aria-hidden /> Saved{savedAt ? ` ${savedAt.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : ""}
              </>
            ) : (
              <>
                <ShieldCheck className="size-3.5 text-emerald-600" aria-hidden /> Autosave on
              </>
            )}
          </span>
          {left !== null && <TimerChip seconds={left} total={total} />}
          <Button variant="gradient" leftIcon={<Send />} onClick={() => setConfirm(true)} disabled={submitting}>
            Submit
          </Button>
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-2xs text-slate-500">
          <ShieldCheck className="size-3.5 text-slate-400" aria-hidden />
          {focusLost > 0
            ? `Tab switch recorded (${focusLost}) — shared with reviewers only; it never changes your score automatically.`
            : "Switching tabs or windows is recorded for review only — it never affects your score automatically."}
        </p>
      </div>

      {closed && (
        <Alert tone="warning" title="This attempt is closed" className="mb-5" action={<Button size="sm" onClick={() => router.replace(`/app/quiz/${assessmentId}/result/${attemptId}`)}>See results</Button>}>
          {closed === "attempt_expired" ? "Time ran out — further changes can't be saved." : "It has already been submitted."}
        </Alert>
      )}

      {/* mobile navigator */}
      <nav aria-label="Questions" className="-mx-1 mb-4 overflow-x-auto px-1 pb-1 no-scrollbar lg:hidden">
        <ol className="flex gap-1.5">
          {questions.map((qq, i) => {
            const done = isAnswered(qq.question_type, responses[qq.id]);
            return (
              <li key={qq.id}>
                <button
                  type="button"
                  onClick={() => setCurrent(i)}
                  aria-current={i === current ? "step" : undefined}
                  aria-label={`Question ${i + 1}${done ? ", answered" : ""}${flags.has(qq.id) ? ", flagged" : ""}`}
                  className={cn(
                    "relative grid size-9 place-items-center rounded-lg text-xs font-bold transition focus-visible:focus-ring",
                    i === current ? "bg-slate-900 text-white" : done ? "bg-brand-100 text-brand-800" : "bg-white text-slate-600 ring-1 ring-slate-200",
                  )}
                >
                  {i + 1}
                  {flags.has(qq.id) && <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-amber-500 ring-2 ring-white" aria-hidden />}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="grid gap-6 lg:grid-cols-[1fr_17rem]">
        {question && (
          <section aria-labelledby={promptId} className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-soft">
            <div className="h-1 bg-gradient-to-r from-brand-500 via-violet-500 to-fuchsia-500" aria-hidden />
            <div className="p-5 sm:p-8">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-brand-700">
                  Question {current + 1} of {questions.length}
                </span>
                <Badge tone="neutral" size="sm">
                  {QUESTION_LABELS[question.question_type] ?? question.question_type}
                </Badge>
                <Badge tone="violet" size="sm">
                  {question.points} pt{question.points === 1 ? "" : "s"}
                </Badge>
                <Button
                  variant="ghost"
                  size="xs"
                  className={cn("ml-auto", flags.has(question.id) && "bg-amber-50 text-amber-800 hover:bg-amber-100")}
                  leftIcon={<Flag />}
                  aria-pressed={flags.has(question.id)}
                  onClick={() => toggleFlag(question.id)}
                >
                  {flags.has(question.id) ? "Flagged" : "Flag for review"}
                </Button>
              </div>
              <div id={promptId} className="mt-4">
                <Markdown className="text-lg font-medium text-slate-900 [&_p]:text-slate-900">{question.prompt}</Markdown>
              </div>
              <div className="mt-6">
                <QuestionInput
                  key={question.id}
                  question={question}
                  value={responses[question.id]}
                  onChange={(r) => update(question.id, r)}
                  disabled={!!closed || submitting}
                  attemptId={attemptId}
                  labelledBy={promptId}
                />
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/60 px-5 py-4 sm:px-8">
              <Button variant="secondary" leftIcon={<ArrowLeft />} disabled={current === 0} onClick={() => setCurrent((c) => c - 1)}>
                Previous
              </Button>
              {current < questions.length - 1 ? (
                <Button variant="primary" rightIcon={<ArrowRight />} onClick={() => setCurrent((c) => c + 1)}>
                  Next
                </Button>
              ) : (
                <Button variant="gradient" rightIcon={<Send />} onClick={() => setConfirm(true)}>
                  Review & submit
                </Button>
              )}
            </div>
          </section>
        )}

        <aside className="hidden lg:block">
          <div className="sticky top-[13rem] space-y-4 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-soft">
            <p className="text-sm font-semibold text-slate-900">Questions</p>
            <ol className="grid grid-cols-5 gap-1.5" aria-label="Question navigator">
              {questions.map((qq, i) => {
                const done = isAnswered(qq.question_type, responses[qq.id]);
                return (
                  <li key={qq.id}>
                    <button
                      type="button"
                      onClick={() => setCurrent(i)}
                      aria-current={i === current ? "step" : undefined}
                      aria-label={`Question ${i + 1}${done ? ", answered" : ", not answered"}${flags.has(qq.id) ? ", flagged" : ""}`}
                      className={cn(
                        "relative grid aspect-square w-full place-items-center rounded-lg text-xs font-bold transition focus-visible:focus-ring",
                        i === current ? "bg-slate-900 text-white shadow-sm" : done ? "bg-brand-100 text-brand-800 hover:bg-brand-200" : "bg-slate-50 text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100",
                      )}
                    >
                      {i + 1}
                      {flags.has(qq.id) && <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-amber-500 ring-2 ring-white" aria-hidden />}
                    </button>
                  </li>
                );
              })}
            </ol>
            <ul className="space-y-1.5 border-t border-slate-100 pt-3 text-xs text-slate-600">
              <li className="flex items-center gap-2">
                <span className="size-3 rounded bg-brand-100 ring-1 ring-brand-200" aria-hidden /> Answered ({answered})
              </li>
              <li className="flex items-center gap-2">
                <span className="size-3 rounded bg-slate-50 ring-1 ring-slate-200" aria-hidden /> Not answered ({questions.length - answered})
              </li>
              <li className="flex items-center gap-2">
                <span className="size-3 rounded-full bg-amber-500" aria-hidden /> Flagged ({flags.size})
              </li>
            </ul>
          </div>
        </aside>
      </div>

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Submit your answers?"
        description={unanswered.length ? `You have ${unanswered.length} unanswered question${unanswered.length === 1 ? "" : "s"}.` : "You've answered every question."}
        confirmLabel="Submit attempt"
        onConfirm={() => submit()}
      >
        <div className="space-y-3 text-sm">
          {unanswered.length > 0 && (
            <div className="flex gap-2 rounded-xl bg-amber-50 p-3 text-amber-900">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
              <p>
                Unanswered: {unanswered.slice(0, 12).map(({ i }) => i + 1).join(", ")}
                {unanswered.length > 12 ? "…" : ""}. Unanswered questions score zero.
              </p>
            </div>
          )}
          {flags.size > 0 && (
            <p className="flex items-center gap-2 text-slate-600">
              <Flag className="size-4 text-amber-600" aria-hidden /> {flags.size} question{flags.size === 1 ? " is" : "s are"} flagged for review.
            </p>
          )}
          <p className="flex items-center gap-2 text-slate-600">
            <CheckCircle2 className="size-4 text-emerald-600" aria-hidden /> You can&apos;t change answers after submitting.
          </p>
        </div>
      </ConfirmDialog>

      <Dialog open={timeUp}>
        <DialogContent hideClose size="sm" className="text-center">
          <DialogTitle>Time&apos;s up</DialogTitle>
          <DialogDescription>We&apos;re submitting your saved answers now…</DialogDescription>
          <Spinner className="mx-auto" label="Submitting" />
        </DialogContent>
      </Dialog>
    </div>
  );
}
