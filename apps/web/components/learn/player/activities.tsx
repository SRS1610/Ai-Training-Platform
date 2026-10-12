"use client";

import { Button, cn, toast } from "@praxis/ui";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, CircleHelp, Info, Lightbulb, OctagonAlert, PartyPopper, RotateCcw, XCircle } from "lucide-react";
import * as React from "react";
import { Markdown } from "@/components/common/markdown";
import { api, errorMessage } from "@/lib/api";
import type { Activity, CheckOut } from "../types";
import { Flashcards } from "./flashcards";
import { CodeLessonBlock, EmbedBlock, InteractiveHtmlBlock } from "./interactive-blocks";
import { AudioBlock, DocumentBlock, ImageBlock, VideoBlock } from "./media-blocks";
import { str } from "./media";
import { ScenarioBlock } from "./scenario";

const CALLOUTS = {
  info: { icon: Info, cls: "border-sky-200 bg-sky-50/70", icn: "text-sky-600", label: "Note" },
  tip: { icon: Lightbulb, cls: "border-amber-200 bg-amber-50/70", icn: "text-amber-600", label: "Tip" },
  warning: { icon: AlertTriangle, cls: "border-orange-200 bg-orange-50/70", icn: "text-orange-600", label: "Watch out" },
  danger: { icon: OctagonAlert, cls: "border-rose-200 bg-rose-50/70", icn: "text-rose-600", label: "Important" },
  success: { icon: PartyPopper, cls: "border-emerald-200 bg-emerald-50/70", icn: "text-emerald-600", label: "Key takeaway" },
} as const;

export function Callout({ content, title }: { content: Record<string, unknown>; title?: string | null }) {
  const variant = (str(content.variant) ?? "info") as keyof typeof CALLOUTS;
  const v = CALLOUTS[variant] ?? CALLOUTS.info;
  const Icon = v.icon;
  return (
    <aside className={cn("flex gap-3 rounded-2xl border p-4 sm:p-5", v.cls)}>
      <Icon className={cn("mt-0.5 size-5 shrink-0", v.icn)} aria-hidden />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-900">{title || v.label}</p>
        <Markdown className="mt-1 text-sm">{str(content.body_markdown) ?? ""}</Markdown>
      </div>
    </aside>
  );
}

interface CheckOption {
  id: string;
  text: string;
}

/** Ungraded knowledge check, evaluated server-side (answer keys never reach the browser). */
export function KnowledgeCheck({ courseId, activity, canCheck }: { courseId: string; activity: Activity; canCheck: boolean }) {
  const c = activity.content;
  const options: CheckOption[] = (Array.isArray(c.options) ? c.options : [])
    .filter((o): o is Record<string, unknown> => !!o && typeof o === "object")
    .map((o) => ({ id: String(o.id), text: String(o.text ?? "") }));
  const multiple = c.multiple === true || c.multi_select === true || c.multiple_select === true;
  const [picked, setPicked] = React.useState<string[]>([]);
  const [result, setResult] = React.useState<CheckOut | null>(null);
  const check = useMutation({
    mutationFn: () => api.post<CheckOut>(`/learn/${courseId}/activities/${activity.id}/check`, { answer_ids: picked }),
    onSuccess: setResult,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const groupId = React.useId();
  const toggle = (id: string) => {
    if (result) return;
    setPicked((p) => (multiple ? (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]) : [id]));
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-indigo-200 bg-white shadow-soft" aria-labelledby={`${groupId}-q`}>
      <div className="flex items-center gap-2 border-b border-indigo-100 bg-gradient-to-r from-indigo-50 via-violet-50 to-fuchsia-50 px-4 py-2.5">
        <CircleHelp className="size-4 text-indigo-600" aria-hidden />
        <span className="text-xs font-semibold uppercase tracking-wider text-indigo-700">Knowledge check</span>
        <span className="ml-auto text-2xs font-medium text-slate-500">Not graded</span>
      </div>
      <div className="p-4 sm:p-5">
        <div id={`${groupId}-q`} className="font-semibold text-slate-900">
          <Markdown className="text-base text-slate-900">{str(c.question) ?? activity.title ?? "Question"}</Markdown>
        </div>
        {multiple && <p className="mt-1 text-xs text-slate-500">Select all that apply.</p>}
        <div role={multiple ? "group" : "radiogroup"} aria-labelledby={`${groupId}-q`} className="mt-4 grid gap-2">
          {options.map((o) => {
            const sel = picked.includes(o.id);
            const correct = result?.correct_ids.includes(o.id);
            const state = result ? (correct ? "correct" : sel ? "wrong" : "idle") : sel ? "selected" : "idle";
            return (
              <label
                key={o.id}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm transition focus-within:ring-2 focus-within:ring-brand-500/40",
                  state === "selected" && "border-brand-400 bg-brand-50/60",
                  state === "correct" && "border-emerald-300 bg-emerald-50",
                  state === "wrong" && "border-rose-300 bg-rose-50",
                  state === "idle" && "border-slate-200 hover:border-slate-300 hover:bg-slate-50",
                  result && "cursor-default",
                )}
              >
                <input
                  type={multiple ? "checkbox" : "radio"}
                  name={groupId}
                  checked={sel}
                  onChange={() => toggle(o.id)}
                  disabled={!!result}
                  className="mt-0.5 size-4 shrink-0 accent-brand-600"
                />
                <span className="flex-1 text-slate-800">{o.text}</span>
                {state === "correct" && <CheckCircle2 className="size-4 shrink-0 text-emerald-600" aria-label="Correct answer" />}
                {state === "wrong" && <XCircle className="size-4 shrink-0 text-rose-600" aria-label="Incorrect" />}
              </label>
            );
          })}
        </div>
        <div aria-live="polite">
          {result && (
            <div className={cn("mt-4 rounded-xl p-4 text-sm", result.correct ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-900")}>
              <p className="font-semibold">{result.correct ? "Correct — nice work!" : "Not quite. The correct answer is highlighted."}</p>
              {result.explanation && <Markdown className="mt-1 text-sm text-slate-700">{result.explanation}</Markdown>}
            </div>
          )}
        </div>
        <div className="mt-4 flex gap-2">
          {result ? (
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<RotateCcw />}
              onClick={() => {
                setResult(null);
                setPicked([]);
              }}
            >
              Try again
            </Button>
          ) : (
            <Button size="sm" onClick={() => check.mutate()} loading={check.isPending} disabled={!picked.length || !canCheck}>
              Check answer
            </Button>
          )}
          {!canCheck && <p className="self-center text-xs text-slate-500">Enrol to check your answers.</p>}
        </div>
      </div>
    </section>
  );
}

/** Renders one activity block inside a lesson. */
export function ActivityBlock({
  activity,
  courseId,
  enrolled,
  onPosition,
}: {
  activity: Activity;
  courseId: string;
  enrolled: boolean;
  onPosition?: (p: Record<string, unknown>) => void;
}) {
  const c = activity.content ?? {};
  const t = activity.activity_type;
  const titled = (node: React.ReactNode) => (
    <div className="space-y-3">
      {activity.title && <h3 className="font-display text-lg font-semibold text-slate-900">{activity.title}</h3>}
      {node}
    </div>
  );
  switch (t) {
    case "callout":
      return <Callout content={c} title={activity.title} />;
    case "check":
      return <KnowledgeCheck courseId={courseId} activity={activity} canCheck={enrolled} />;
    case "text":
      return titled(<Markdown>{str(c.body_markdown) ?? ""}</Markdown>);
    case "video":
      return titled(<VideoBlock content={c} onPosition={onPosition} title={activity.title ?? undefined} />);
    case "audio":
      return titled(<AudioBlock content={c} />);
    case "image":
      return titled(<ImageBlock content={c} title={activity.title ?? undefined} />);
    case "code":
      return titled(<CodeLessonBlock content={c} />);
    case "flashcards":
      return titled(<Flashcards content={c} />);
    case "scenario":
      return titled(<ScenarioBlock content={c} />);
    case "interactive_html":
      return titled(<InteractiveHtmlBlock content={c} title={activity.title ?? undefined} />);
    case "embed":
      return titled(<EmbedBlock content={c} title={activity.title ?? undefined} />);
    case "pdf":
      return titled(<DocumentBlock content={c} kind="pdf" />);
    case "file":
      return titled(<DocumentBlock content={c} kind="file" />);
    default:
      return str(c.body_markdown) ? titled(<Markdown>{str(c.body_markdown)!}</Markdown>) : null;
  }
}
