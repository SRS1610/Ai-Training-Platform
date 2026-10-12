"use client";

import { Alert, Badge, Button, Card, FormField, Input, Textarea, cn, humanize, toast } from "@praxis/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bot, CheckCircle2, Download, Lightbulb, Quote, Save, ThumbsUp, XCircle } from "lucide-react";
import * as React from "react";
import { ApiError, api, errorMessage } from "@/lib/api";
import { confidenceMeta } from "./ai-recommendation";
import { CodeBlock } from "./submission-viewer";
import { gk, type AnswerAIFeedback, type ResultQuestion } from "./types";

type Choice = { id: string; text: string };

function choiceText(options: Record<string, unknown>, id: unknown): string {
  const list = ((options.choices as Choice[] | undefined) ?? (options.items as Choice[] | undefined) ?? []) as Choice[];
  return list.find((c) => c.id === id)?.text ?? String(id);
}

/** Learner response rendered per question type. */
export function ResponseView({ q }: { q: ResultQuestion }) {
  const r = (q.response ?? {}) as Record<string, unknown>;
  const options = (q.options ?? {}) as Record<string, unknown>;
  if (!Object.keys(r).length) return <p className="text-sm italic text-slate-500">No answer given.</p>;
  if (typeof r.text === "string") return <div className="whitespace-pre-wrap break-words rounded-xl border border-slate-200 bg-slate-50/60 p-4 text-[15px] leading-7 text-slate-800">{r.text}</div>;
  if (typeof r.code === "string") return <CodeBlock code={r.code} />;
  if (r.choice_id !== undefined) return <p className="text-sm font-medium text-slate-800">{choiceText(options, r.choice_id)}</p>;
  if (Array.isArray(r.choice_ids))
    return (
      <ul className="list-inside list-disc text-sm text-slate-800">
        {r.choice_ids.map((id) => (
          <li key={String(id)}>{choiceText(options, id)}</li>
        ))}
      </ul>
    );
  if (typeof r.value === "boolean") return <p className="text-sm font-medium text-slate-800">{r.value ? "True" : "False"}</p>;
  if (Array.isArray(r.order))
    return (
      <ol className="list-inside list-decimal text-sm text-slate-800">
        {r.order.map((id) => (
          <li key={String(id)}>{choiceText(options, id)}</li>
        ))}
      </ol>
    );
  if (Array.isArray(r.file_ids))
    return (
      <div className="flex flex-wrap gap-2">
        {(r.file_ids as string[]).map((id, i) => (
          <Button
            key={id}
            size="sm"
            variant="secondary"
            leftIcon={<Download />}
            onClick={() => api.download(`/files/${id}/download`).catch((e) => toast.error(errorMessage(e)))}
          >
            File {i + 1}
          </Button>
        ))}
      </div>
    );
  return <pre className="overflow-auto rounded-xl bg-slate-50 p-3 font-mono text-xs text-slate-700">{JSON.stringify(r, null, 2)}</pre>;
}

export function QuestionGradeCard({ attemptId, q, index, onSaved }: { attemptId: string; q: ResultQuestion; index: number; onSaved: (pending: number) => void }) {
  const qc = useQueryClient();
  const ai = (q.ai_feedback ?? null) as AnswerAIFeedback | null;
  const [score, setScore] = React.useState<string>(q.score !== null && q.score !== undefined && !q.pending_review ? String(q.score) : "");
  const [feedback, setFeedback] = React.useState<string>(q.feedback ?? "");
  const [reason, setReason] = React.useState("");
  const [reasonErr, setReasonErr] = React.useState<string | null>(null);
  const num = score === "" ? null : Number(score);
  const aiScore = ai?.score ?? null;
  const differs = num !== null && aiScore !== null && Math.abs(num - aiScore) > 1e-6;
  const conf = confidenceMeta(ai?.confidence);

  const save = useMutation({
    mutationFn: () =>
      api.put<{ pending: number; score: number; max_score: number }>(`/attempts/${attemptId}/answers/${q.id}/grade`, {
        score: num,
        feedback: feedback.trim() || null,
        override_reason: reason.trim() || null,
      }),
    onSuccess: (r) => {
      toast.success(`Question ${index + 1} marked ${r.score}/${r.max_score}`);
      qc.invalidateQueries({ queryKey: gk.attempt(attemptId) });
      qc.invalidateQueries({ queryKey: gk.all });
      onSaved(r.pending);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === "override_reason_required") setReasonErr("Explain why you changed the AI's mark.");
      else toast.error(errorMessage(e));
    },
  });

  return (
    <Card className={cn("overflow-hidden", q.pending_review ? "ring-2 ring-violet-200" : "")}>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/60 px-5 py-3">
        <span className="grid size-7 place-items-center rounded-lg bg-brand-600 text-xs font-bold text-white">{index + 1}</span>
        <Badge tone="neutral" size="sm">
          {humanize(q.question_type)}
        </Badge>
        <span className="text-xs text-slate-500">max {q.max_score} pt{q.max_score === 1 ? "" : "s"}</span>
        <span className="ml-auto">
          {q.pending_review ? (
            <Badge tone="violet" size="sm">
              Needs your mark
            </Badge>
          ) : q.is_correct ? (
            <Badge tone="success" size="sm">
              <CheckCircle2 aria-hidden /> {q.score}/{q.max_score}
            </Badge>
          ) : (
            <Badge tone="danger" size="sm">
              <XCircle aria-hidden /> {q.score ?? 0}/{q.max_score}
            </Badge>
          )}
        </span>
      </div>
      <div className="grid gap-5 p-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-3">
          <p className="whitespace-pre-wrap text-[15px] font-medium leading-relaxed text-slate-900">{q.prompt}</p>
          <ResponseView q={q} />
          {q.correct_answer && "model_answer" in q.correct_answer && (
            <details className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-sm">
              <summary className="cursor-pointer font-semibold text-emerald-900">Model answer (staff only)</summary>
              <p className="mt-2 whitespace-pre-wrap text-emerald-950">{String((q.correct_answer as { model_answer: unknown }).model_answer)}</p>
            </details>
          )}
        </div>
        <div className="space-y-3">
          {ai && (
            <div className="rounded-2xl border border-violet-200 bg-violet-50/50 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-violet-700">
                  <Bot className="size-3.5" aria-hidden /> AI suggestion
                </p>
                <Badge tone={conf.tone} size="sm">
                  {conf.label}
                </Badge>
              </div>
              <p className="mt-1 font-display text-2xl font-bold tabular-nums text-slate-900">
                {ai.score}
                <span className="text-base font-medium text-slate-400">/{ai.max ?? q.max_score}</span>
              </p>
              {ai.feedback && <p className="mt-1 text-sm text-slate-700">{ai.feedback}</p>}
              {(ai.strengths ?? []).length > 0 && (
                <ul className="mt-2 space-y-0.5 text-xs text-emerald-800">
                  {ai.strengths!.map((s, i) => (
                    <li key={i} className="flex gap-1">
                      <ThumbsUp className="mt-0.5 size-3 shrink-0" aria-hidden />
                      {s}
                    </li>
                  ))}
                </ul>
              )}
              {(ai.improvements ?? []).length > 0 && (
                <ul className="mt-1.5 space-y-0.5 text-xs text-sky-800">
                  {ai.improvements!.map((s, i) => (
                    <li key={i} className="flex gap-1">
                      <Lightbulb className="mt-0.5 size-3 shrink-0" aria-hidden />
                      {s}
                    </li>
                  ))}
                </ul>
              )}
              {(ai.evidence ?? []).map((e, i) => (
                <p key={i} className="mt-1.5 flex gap-1 border-l-2 border-violet-300 pl-2 text-xs italic text-slate-600">
                  <Quote className="mt-0.5 size-3 shrink-0" aria-hidden />“{e}”
                </p>
              ))}
              {ai.injection_flagged && (
                <Alert tone="warning" className="mt-2 p-2 text-xs">
                  Possible prompt injection detected — mark manually.
                </Alert>
              )}
              <Button size="xs" variant="soft" className="mt-3" onClick={() => setScore(String(ai.score ?? ""))}>
                Use AI mark
              </Button>
            </div>
          )}
          <FormField label={`Mark (0–${q.max_score})`} required>
            <Input type="number" min={0} max={q.max_score} step={0.5} value={score} onChange={(e) => setScore(e.target.value)} inputSize="sm" />
          </FormField>
          <FormField label="Feedback">
            <Textarea rows={3} value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="What was good, what was missing…" />
          </FormField>
          {differs && (
            <FormField label="Override reason" required error={reasonErr} hint={`AI suggested ${aiScore}. Your reason is audited.`}>
              <Textarea
                rows={2}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setReasonErr(null);
                }}
              />
            </FormField>
          )}
          <Button
            block
            leftIcon={<Save />}
            loading={save.isPending}
            disabled={num === null || Number.isNaN(num) || num < 0 || num > q.max_score}
            onClick={() => {
              if (differs && !reason.trim()) return setReasonErr("Explain why you changed the AI's mark.");
              save.mutate();
            }}
          >
            {q.pending_review ? "Save mark" : "Update mark"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
