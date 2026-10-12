"use client";

import { Input, Textarea, cn } from "@praxis/ui";
import { Check, X } from "lucide-react";
import * as React from "react";
import { Markdown } from "@/components/common/markdown";
import type { AnswerResponse, AttemptQuestion } from "../types";

export interface InputProps {
  question: AttemptQuestion;
  value: AnswerResponse | undefined;
  onChange: (r: AnswerResponse) => void;
  disabled?: boolean;
  attemptId: string;
  labelledBy: string;
}

export interface Choice {
  id: string;
  text: string;
}

export function choices(list: unknown): Choice[] {
  return (Array.isArray(list) ? list : [])
    .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
    .map((c) => ({ id: String(c.id), text: String(c.text ?? "") }));
}

const LETTERS = "ABCDEFGHIJKLMNOP";

/* ------------------------------------------------------------------ choice questions */

export function ChoiceInput({ question, value, onChange, disabled, labelledBy }: InputProps) {
  const multi = question.question_type === "multiple_select";
  const opts = choices(question.options.choices);
  const selected: string[] = multi
    ? Array.isArray(value?.choice_ids)
      ? (value!.choice_ids as unknown[]).map(String)
      : []
    : value?.choice_id !== undefined && value?.choice_id !== null
      ? [String(value.choice_id)]
      : [];
  const name = React.useId();
  const toggle = (id: string) => {
    if (multi) {
      const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
      onChange({ choice_ids: next });
    } else onChange({ choice_id: id });
  };
  return (
    <div role={multi ? "group" : "radiogroup"} aria-labelledby={labelledBy} className="grid gap-2.5">
      {multi && <p className="text-xs font-medium text-slate-500">Select all that apply.</p>}
      {opts.map((o, i) => {
        const on = selected.includes(o.id);
        return (
          <label
            key={o.id}
            className={cn(
              "group flex cursor-pointer items-start gap-3 rounded-2xl border p-3.5 text-sm transition focus-within:ring-2 focus-within:ring-brand-500/40 sm:p-4",
              on ? "border-brand-400 bg-brand-50/70 shadow-sm" : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50",
              disabled && "cursor-not-allowed opacity-70",
            )}
          >
            <input
              type={multi ? "checkbox" : "radio"}
              name={name}
              className="sr-only"
              checked={on}
              disabled={disabled}
              onChange={() => toggle(o.id)}
            />
            <span
              className={cn(
                "grid size-7 shrink-0 place-items-center font-display text-xs font-bold transition",
                multi ? "rounded-lg" : "rounded-full",
                on ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 group-hover:bg-slate-200",
              )}
              aria-hidden
            >
              {on ? <Check className="size-4" strokeWidth={3} /> : LETTERS[i]}
            </span>
            <span className="min-w-0 flex-1 pt-0.5 text-slate-800">
              <Markdown className="text-sm">{o.text}</Markdown>
            </span>
          </label>
        );
      })}
    </div>
  );
}

export function TrueFalseInput({ value, onChange, disabled, labelledBy }: InputProps) {
  const v = typeof value?.value === "boolean" ? (value.value as boolean) : null;
  const name = React.useId();
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className="grid grid-cols-2 gap-3">
      {[
        { val: true, label: "True", icon: Check, on: "border-emerald-400 bg-emerald-50 text-emerald-800", chip: "bg-emerald-500" },
        { val: false, label: "False", icon: X, on: "border-rose-400 bg-rose-50 text-rose-800", chip: "bg-rose-500" },
      ].map((o) => {
        const on = v === o.val;
        return (
          <label
            key={o.label}
            className={cn(
              "flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 p-5 text-base font-semibold transition focus-within:ring-2 focus-within:ring-brand-500/40",
              on ? o.on : "border-slate-200 bg-white text-slate-700 hover:border-slate-300",
              disabled && "cursor-not-allowed opacity-70",
            )}
          >
            <input type="radio" name={name} className="sr-only" checked={on} disabled={disabled} onChange={() => onChange({ value: o.val })} />
            <span className={cn("grid size-10 place-items-center rounded-full text-white", on ? o.chip : "bg-slate-200")} aria-hidden>
              <o.icon className="size-5" strokeWidth={3} />
            </span>
            {o.label}
          </label>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ text answers */

export function ShortAnswerInput({ value, onChange, disabled, labelledBy }: InputProps) {
  return (
    <Input
      inputSize="lg"
      aria-labelledby={labelledBy}
      value={typeof value?.text === "string" ? value.text : ""}
      onChange={(e) => onChange({ text: e.target.value })}
      disabled={disabled}
      placeholder="Type your answer"
      maxLength={2000}
      autoComplete="off"
    />
  );
}

function words(s: string) {
  return s.trim() ? s.trim().split(/\s+/).length : 0;
}

export function LongAnswerInput({ question, value, onChange, disabled, labelledBy, rows = 9, placeholder = "Write your answer…" }: InputProps & { rows?: number; placeholder?: string }) {
  const text = typeof value?.text === "string" ? value.text : "";
  const min = Number(question.options.min_words) || 0;
  const max = Number(question.options.max_words) || 0;
  const count = words(text);
  const over = max > 0 && count > max;
  return (
    <div>
      <Textarea
        aria-labelledby={labelledBy}
        rows={rows}
        value={text}
        onChange={(e) => onChange({ ...(value ?? {}), text: e.target.value })}
        disabled={disabled}
        placeholder={placeholder}
        className="text-[15px]"
      />
      <p className={cn("mt-1.5 text-right text-xs tabular-nums", over ? "font-semibold text-amber-800" : "text-slate-500")} aria-live="polite">
        {count} word{count === 1 ? "" : "s"}
        {min && max ? ` · aim for ${min}–${max}` : min ? ` · aim for ${min}+` : max ? ` · up to ${max}` : ""}
        {over ? " — over the limit" : ""}
      </p>
    </div>
  );
}

export function FillBlankInput({ question, value, onChange, disabled }: InputProps) {
  const text = typeof question.options.text === "string" ? (question.options.text as string) : "";
  const ids = choices(question.options.blanks).map((b) => b.id);
  const blanks: Record<string, string> = value?.blanks && typeof value.blanks === "object" ? (value.blanks as Record<string, string>) : {};
  const parts = text.split(/(\{\{\s*[\w-]+\s*\}\})/g);
  const set = (id: string, v: string) => onChange({ blanks: { ...blanks, [id]: v } });
  let n = 0;
  if (!text)
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {ids.map((id, i) => (
          <Input key={id} aria-label={`Blank ${i + 1}`} value={blanks[id] ?? ""} onChange={(e) => set(id, e.target.value)} disabled={disabled} placeholder={`Blank ${i + 1}`} />
        ))}
      </div>
    );
  return (
    <p className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 text-base leading-[2.6] text-slate-800 sm:p-5">
      {parts.map((p, i) => {
        const m = p.match(/^\{\{\s*([\w-]+)\s*\}\}$/);
        if (!m) return <React.Fragment key={i}>{p}</React.Fragment>;
        const id = m[1]!;
        n += 1;
        const filled = !!blanks[id]?.trim();
        return (
          <input
            key={i}
            type="text"
            aria-label={`Blank ${n}`}
            value={blanks[id] ?? ""}
            onChange={(e) => set(id, e.target.value)}
            disabled={disabled}
            autoComplete="off"
            size={Math.max(8, (blanks[id] ?? "").length + 2)}
            className={cn(
              "mx-1 inline-block h-9 rounded-lg border-b-2 bg-white px-2 text-center font-semibold shadow-sm outline-none transition focus-visible:ring-4 focus-visible:ring-brand-500/20",
              filled ? "border-brand-500 text-brand-800" : "border-slate-300 text-slate-900",
            )}
          />
        );
      })}
    </p>
  );
}

/* ------------------------------------------------------------------ code */

export function CodeInput({ question, value, onChange, disabled, labelledBy }: InputProps) {
  const lang = typeof question.options.language === "string" ? (question.options.language as string) : "code";
  const starter = typeof question.options.starter_code === "string" ? (question.options.starter_code as string) : "";
  const code = typeof value?.code === "string" ? (value.code as string) : starter;
  const lines = Math.max(12, code.split("\n").length + 1);
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const gutter = React.useRef<HTMLDivElement>(null);
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/80 shadow-soft focus-within:border-brand-400 focus-within:ring-4 focus-within:ring-brand-500/15">
      <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
        <span className="flex gap-1.5" aria-hidden>
          <span className="size-2.5 rounded-full bg-rose-400" />
          <span className="size-2.5 rounded-full bg-amber-400" />
          <span className="size-2.5 rounded-full bg-emerald-400" />
        </span>
        <span className="ml-2 font-mono text-xs text-slate-600">solution</span>
        <span className="ml-auto rounded-md bg-indigo-50 px-1.5 py-0.5 font-mono text-2xs font-semibold uppercase text-indigo-700 ring-1 ring-inset ring-indigo-100">{lang}</span>
      </div>
      <div className="flex max-h-[28rem] overflow-hidden">
        <div ref={gutter} className="select-none overflow-hidden border-r border-slate-200 bg-white/60 py-3 pl-3 pr-2 text-right font-mono text-[13px] leading-6 text-slate-400" aria-hidden>
          {Array.from({ length: lines }, (_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
        <textarea
          ref={ref}
          aria-labelledby={labelledBy}
          aria-describedby={`${labelledBy}-code-hint`}
          value={code}
          disabled={disabled}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          onScroll={(e) => {
            if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop;
          }}
          onChange={(e) => onChange({ code: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Tab" && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
              const el = e.currentTarget;
              const { selectionStart: s, selectionEnd: en } = el;
              if (s === en) {
                e.preventDefault();
                const next = code.slice(0, s) + "  " + code.slice(en);
                onChange({ code: next });
                requestAnimationFrame(() => {
                  el.selectionStart = el.selectionEnd = s + 2;
                });
              }
            }
          }}
          rows={lines}
          className="min-h-[18rem] flex-1 resize-y bg-transparent px-3 py-3 font-mono text-[13px] leading-6 text-slate-800 caret-brand-600 outline-none placeholder:text-slate-400"
          placeholder="// Write your code here"
        />
      </div>
      <p id={`${labelledBy}-code-hint`} className="border-t border-slate-200 bg-white px-3 py-1.5 text-2xs text-slate-500">
        Tab inserts two spaces · press Esc then Tab to move focus out. Code is checked statically — it is never executed.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ context helpers */

/** Scenario / practical-task context blocks stored in the question options. */
export function QuestionContext({ options }: { options: Record<string, unknown> }) {
  const ctx = [options.scenario, options.context, options.background].find((v) => typeof v === "string" && v.trim()) as string | undefined;
  const instructions = typeof options.instructions === "string" ? options.instructions : undefined;
  const checklist = Array.isArray(options.checklist) ? (options.checklist as unknown[]).map(String) : Array.isArray(options.steps) ? (options.steps as unknown[]).map(String) : [];
  if (!ctx && !instructions && !checklist.length) return null;
  return (
    <div className="space-y-3">
      {ctx && (
        <div className="rounded-2xl bg-gradient-to-br from-violet-50 via-fuchsia-50/50 to-white p-4 ring-1 ring-violet-100">
          <p className="text-xs font-semibold uppercase tracking-wider text-violet-700">Scenario</p>
          <Markdown className="mt-1.5 text-sm">{ctx}</Markdown>
        </div>
      )}
      {instructions && <Markdown className="text-sm">{instructions}</Markdown>}
      {checklist.length > 0 && (
        <ul className="space-y-1.5 rounded-2xl bg-slate-50 p-4">
          {checklist.map((c, i) => (
            <li key={i} className="flex gap-2 text-sm text-slate-700">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand-500" aria-hidden />
              {c}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
