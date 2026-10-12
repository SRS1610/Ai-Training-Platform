"use client";

import { Badge, cn } from "@praxis/ui";
import { Bot, CheckCircle2, CircleDashed, FileText, Hourglass, MinusCircle, XCircle } from "lucide-react";
import { Markdown } from "@/components/common/markdown";
import { QUESTION_LABELS } from "../meta";
import type { ResultQuestion } from "../types";
import { choices } from "./inputs";

type R = Record<string, unknown>;

function Pill({ tone, children }: { tone: "good" | "bad" | "neutral" | "key"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-lg px-2 py-1 text-sm ring-1 ring-inset",
        tone === "good" && "bg-emerald-50 text-emerald-800 ring-emerald-200",
        tone === "bad" && "bg-rose-50 text-rose-800 ring-rose-200",
        tone === "neutral" && "bg-slate-50 text-slate-800 ring-slate-200",
        tone === "key" && "bg-sky-50 text-sky-800 ring-sky-200",
      )}
    >
      {children}
    </span>
  );
}

/** Tone for one fill-in-the-blank answer (case-insensitive match against the released accepted answers). */
function blankTone(mine: string | undefined, accepted: unknown): "good" | "bad" | "neutral" {
  if (!Array.isArray(accepted) || !accepted.length) return "neutral";
  const norm = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return accepted.some((a) => norm(a) === norm(mine)) ? "good" : "bad";
}

function textOf(list: unknown, id: unknown) {
  return choices(list).find((c) => c.id === String(id))?.text ?? String(id ?? "—");
}

/** Learner's answer (and the correct answer, when released) for one question. */
function AnswerDetail({ q }: { q: ResultQuestion }) {
  const r = (q.response ?? {}) as R;
  const key = (q.correct_answer ?? null) as R | null;
  const o = q.options as R;
  const good = q.is_correct === true;
  const tone = q.is_correct === null ? "neutral" : good ? "good" : "bad";
  switch (q.question_type) {
    case "multiple_choice":
    case "multiple_select": {
      const mine = q.question_type === "multiple_choice" ? (r.choice_id !== undefined ? [String(r.choice_id)] : []) : Array.isArray(r.choice_ids) ? (r.choice_ids as unknown[]).map(String) : [];
      const right = key ? (q.question_type === "multiple_choice" ? [String(key.choice_id)] : Array.isArray(key.choice_ids) ? (key.choice_ids as unknown[]).map(String) : []) : [];
      return (
        <ul className="space-y-1.5">
          {choices(o.choices).map((c) => {
            const picked = mine.includes(c.id);
            const correct = right.includes(c.id);
            return (
              <li
                key={c.id}
                className={cn(
                  "flex items-start gap-2 rounded-xl border px-3 py-2 text-sm",
                  correct ? "border-emerald-200 bg-emerald-50/70" : picked ? "border-rose-200 bg-rose-50/70" : "border-slate-200",
                )}
              >
                {correct ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-label="Correct answer" /> : picked ? <XCircle className="mt-0.5 size-4 shrink-0 text-rose-600" aria-label="Your answer" /> : <CircleDashed className="mt-0.5 size-4 shrink-0 text-slate-300" aria-hidden />}
                <span className="flex-1 text-slate-800">{c.text}</span>
                {picked && <span className="text-2xs font-semibold uppercase text-slate-500">Your answer</span>}
              </li>
            );
          })}
        </ul>
      );
    }
    case "true_false":
      return (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          Your answer: <Pill tone={tone}>{typeof r.value === "boolean" ? (r.value ? "True" : "False") : "—"}</Pill>
          {key && typeof key.value === "boolean" && !good && (
            <>
              Correct: <Pill tone="key">{key.value ? "True" : "False"}</Pill>
            </>
          )}
        </p>
      );
    case "short_answer":
      return (
        <div className="space-y-2 text-sm">
          <p className="flex flex-wrap items-center gap-2">
            Your answer: <Pill tone={tone}>{String(r.text ?? "—") || "—"}</Pill>
          </p>
          {key && Array.isArray(key.accepted) && key.accepted.length > 0 && !good && (
            <p className="flex flex-wrap items-center gap-2">
              Accepted: {(key.accepted as unknown[]).slice(0, 4).map((a, i) => <Pill key={i} tone="key">{String(a)}</Pill>)}
            </p>
          )}
        </div>
      );
    case "matching": {
      const pairs = (r.pairs ?? {}) as Record<string, string>;
      const right = (key?.pairs ?? {}) as Record<string, string>;
      return (
        <ul className="space-y-1.5 text-sm">
          {choices(o.left).map((l) => {
            const ok = key ? right[l.id] === pairs[l.id] : null;
            return (
              <li key={l.id} className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-slate-800">{l.text}</span>
                <span className="text-slate-400" aria-hidden>→</span>
                <Pill tone={ok === null ? "neutral" : ok ? "good" : "bad"}>{pairs[l.id] ? textOf(o.right, pairs[l.id]) : "—"}</Pill>
                {ok === false && right[l.id] && <Pill tone="key">{textOf(o.right, right[l.id])}</Pill>}
              </li>
            );
          })}
        </ul>
      );
    }
    case "ordering": {
      const mine = Array.isArray(r.order) ? (r.order as unknown[]).map(String) : [];
      const right = Array.isArray(key?.order) ? (key!.order as unknown[]).map(String) : [];
      return (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ol className="space-y-1 text-sm">
            <li className="text-2xs font-semibold uppercase tracking-wider text-slate-500">Your order</li>
            {mine.map((id, i) => (
              <li key={id} className={cn("rounded-lg px-2.5 py-1.5", right.length ? (right[i] === id ? "bg-emerald-50 text-emerald-900" : "bg-rose-50 text-rose-900") : "bg-slate-50")}>
                {i + 1}. {textOf(o.items, id)}
              </li>
            ))}
          </ol>
          {right.length > 0 && !good && (
            <ol className="space-y-1 text-sm">
              <li className="text-2xs font-semibold uppercase tracking-wider text-slate-500">Correct order</li>
              {right.map((id, i) => (
                <li key={id} className="rounded-lg bg-sky-50 px-2.5 py-1.5 text-sky-900">
                  {i + 1}. {textOf(o.items, id)}
                </li>
              ))}
            </ol>
          )}
        </div>
      );
    }
    case "fill_blank": {
      const mine = (r.blanks ?? {}) as Record<string, string>;
      const right = (key?.blanks ?? {}) as Record<string, string[]>;
      return (
        <ul className="space-y-1.5 text-sm">
          {choices(o.blanks).map((b, i) => (
            <li key={b.id} className="flex flex-wrap items-center gap-2">
              <span className="text-slate-500">Blank {i + 1}:</span>
              <Pill tone={blankTone(mine[b.id], right[b.id])}>{mine[b.id] || "—"}</Pill>
              {right[b.id]?.length && blankTone(mine[b.id], right[b.id]) !== "good" ? <Pill tone="key">{right[b.id]!.slice(0, 3).join(" / ")}</Pill> : null}
            </li>
          ))}
        </ul>
      );
    }
    case "code":
      return <pre className="max-h-72 overflow-auto rounded-xl bg-slate-50 p-3 font-mono text-xs text-slate-800 ring-1 ring-slate-200 scrollbar-thin">{String(r.code ?? "")}</pre>;
    case "decision_tree": {
      const nodes = (o.nodes ?? {}) as Record<string, { prompt?: string; choices?: { id: string; text: string }[] }>;
      const path = Array.isArray(r.path) ? (r.path as { node_id: string; choice_id: string }[]) : [];
      return (
        <ol className="space-y-1.5 text-sm">
          {path.map((p, i) => (
            <li key={i} className="flex gap-2">
              <span className="grid size-5 shrink-0 place-items-center rounded-full bg-violet-100 text-2xs font-bold text-violet-700">{i + 1}</span>
              <span className="text-slate-800">{nodes[p.node_id]?.choices?.find((c) => c.id === p.choice_id)?.text ?? p.choice_id}</span>
            </li>
          ))}
        </ol>
      );
    }
    case "file_upload": {
      const files = Array.isArray(r.files) ? (r.files as { id: string; filename: string }[]) : [];
      return (
        <div className="space-y-2 text-sm">
          <ul className="flex flex-wrap gap-2">
            {files.map((f) => (
              <li key={f.id} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1 ring-1 ring-slate-200">
                <FileText className="size-3.5 text-slate-500" aria-hidden /> {f.filename}
              </li>
            ))}
          </ul>
          {typeof r.text === "string" && r.text && <p className="text-slate-700">{r.text}</p>}
        </div>
      );
    }
    case "simulation":
      return <p className="text-sm text-slate-700">Scored from your simulation session.</p>;
    default:
      return (
        <div className="space-y-3">
          <div className="whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm text-slate-800 ring-1 ring-slate-200">{String(r.text ?? "—")}</div>
          {key && typeof key.model_answer === "string" && (
            <div className="rounded-xl bg-sky-50 p-3 ring-1 ring-sky-200">
              <p className="text-2xs font-semibold uppercase tracking-wider text-sky-700">Model answer</p>
              <Markdown className="mt-1 text-sm">{key.model_answer}</Markdown>
            </div>
          )}
        </div>
      );
  }
}

export function ResultQuestionCard({ q, index }: { q: ResultQuestion; index: number }) {
  const state = q.pending_review ? "pending" : q.is_correct === true ? "correct" : q.is_correct === false ? ((q.score ?? 0) > 0 ? "partial" : "incorrect") : "graded";
  const meta = {
    correct: { icon: CheckCircle2, cls: "text-emerald-600", bar: "bg-emerald-500", label: "Correct" },
    incorrect: { icon: XCircle, cls: "text-rose-600", bar: "bg-rose-500", label: "Incorrect" },
    partial: { icon: MinusCircle, cls: "text-amber-600", bar: "bg-amber-500", label: "Partially correct" },
    pending: { icon: Hourglass, cls: "text-violet-600", bar: "bg-violet-500", label: "Awaiting review" },
    graded: { icon: CheckCircle2, cls: "text-sky-600", bar: "bg-sky-500", label: "Graded" },
  }[state];
  const ai = q.ai_feedback as { feedback?: string; strengths?: string[]; improvements?: string[] } | null | undefined;
  return (
    <article className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-soft sm:p-6">
      <span className={cn("absolute inset-y-0 left-0 w-1", meta.bar)} aria-hidden />
      <div className="flex flex-wrap items-center gap-2">
        <meta.icon className={cn("size-5", meta.cls)} aria-hidden />
        <span className="text-sm font-semibold text-slate-900">Question {index + 1}</span>
        <span className="text-xs text-slate-500">· {QUESTION_LABELS[q.question_type] ?? q.question_type}</span>
        <span className={cn("text-xs font-semibold", meta.cls)}>{meta.label}</span>
        <Badge tone="neutral" size="sm" className="ml-auto tabular-nums">
          {q.score === null ? "—" : Math.round(q.score * 100) / 100} / {q.max_score}
        </Badge>
      </div>
      <Markdown className="mt-3 text-[15px] font-medium [&_p]:text-slate-900">{q.prompt}</Markdown>
      <div className="mt-4">
        <AnswerDetail q={q} />
      </div>
      {q.explanation && (
        <div className="mt-4 rounded-xl bg-indigo-50/70 p-3.5 ring-1 ring-indigo-100">
          <p className="text-2xs font-semibold uppercase tracking-wider text-indigo-700">Explanation</p>
          <Markdown className="mt-1 text-sm">{q.explanation}</Markdown>
        </div>
      )}
      {q.feedback && (
        <div className="mt-3 rounded-xl bg-emerald-50/70 p-3.5 ring-1 ring-emerald-100">
          <p className="text-2xs font-semibold uppercase tracking-wider text-emerald-700">Assessor feedback</p>
          <Markdown className="mt-1 text-sm">{q.feedback}</Markdown>
        </div>
      )}
      {ai && (ai.feedback || ai.strengths?.length || ai.improvements?.length) && (
        <div className="mt-3 rounded-xl bg-fuchsia-50/60 p-3.5 ring-1 ring-fuchsia-100">
          <p className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-fuchsia-700">
            <Bot className="size-3.5" aria-hidden /> AI feedback {q.pending_review ? "· recommendation, awaiting assessor" : ""}
          </p>
          {ai.feedback && <Markdown className="mt-1 text-sm">{ai.feedback}</Markdown>}
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {!!ai.strengths?.length && (
              <ul className="space-y-1 text-sm text-slate-700">
                {ai.strengths.map((s, i) => (
                  <li key={i} className="flex gap-1.5">
                    <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600" aria-hidden />
                    {String(s)}
                  </li>
                ))}
              </ul>
            )}
            {!!ai.improvements?.length && (
              <ul className="space-y-1 text-sm text-slate-700">
                {ai.improvements.map((s, i) => (
                  <li key={i} className="flex gap-1.5">
                    <MinusCircle className="mt-0.5 size-3.5 shrink-0 text-amber-600" aria-hidden />
                    {String(s)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
