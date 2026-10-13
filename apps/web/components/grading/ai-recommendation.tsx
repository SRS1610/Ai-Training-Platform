"use client";

import { Badge, Button, Card, Progress, ProgressRing, cn } from "@praxis/ui";
import { AlertTriangle, Bot, CheckCheck, ChevronDown, Lightbulb, ListX, Quote, Sparkles, ThumbsDown, ThumbsUp } from "lucide-react";
import * as React from "react";
import { formatDateTime } from "@/lib/format";
import { gradePct, type BreakdownRow, type GradeOut } from "./types";

function ListBlock({ title, items, icon: Icon, tone }: { title: string; items: string[]; icon: typeof ThumbsUp; tone: "emerald" | "rose" | "amber" | "sky" }) {
  if (!items.length) return null;
  const c = {
    emerald: "text-emerald-700 bg-emerald-50",
    rose: "text-rose-700 bg-rose-50",
    amber: "text-amber-800 bg-amber-50",
    sky: "text-sky-700 bg-sky-50",
  }[tone];
  return (
    <div>
      <p className={cn("mb-1.5 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-2xs font-bold uppercase tracking-wider", c)}>
        <Icon className="size-3" aria-hidden /> {title}
      </p>
      <ul className="space-y-1 text-sm text-slate-700">
        {items.map((s, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-2 size-1 shrink-0 rounded-full bg-slate-400" aria-hidden />
            <span>{s}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function confidenceMeta(c: number | null | undefined) {
  if (c === null || c === undefined) return { label: "Unknown", tone: "neutral" as const };
  if (c >= 0.75) return { label: "High", tone: "success" as const };
  if (c >= 0.5) return { label: "Medium", tone: "warning" as const };
  return { label: "Low", tone: "danger" as const };
}

export function AIRecommendationCard({
  grade,
  passingScore,
  onAccept,
  accepted,
  disabled,
}: {
  grade: GradeOut;
  passingScore: number;
  onAccept?: () => void;
  accepted?: boolean;
  disabled?: boolean;
}) {
  // Collapsed by default so the rubric scoring panel stays in view; one click shows the full evidence.
  const [open, setOpen] = React.useState(false);
  const pct = gradePct(grade);
  const passed = grade.passed ?? pct >= passingScore;
  const conf = confidenceMeta(grade.confidence);
  const rows = (grade.rubric_breakdown ?? []) as BreakdownRow[];
  const fallback = (grade.ai_model ?? "").includes("fallback");

  return (
    <Card className="relative overflow-hidden border-violet-200/80">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500" aria-hidden />
      <div className="flex items-start gap-4 p-5">
        <ProgressRing value={pct} size={72} stroke={7} aria-label="AI recommended score" label={<span className="font-display text-lg font-bold tabular-nums text-slate-900">{Math.round(pct)}%</span>} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-violet-700">
            <Sparkles className="size-3.5" aria-hidden /> AI recommendation
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge tone={passed ? "success" : "danger"} size="sm">
              {passed ? "Would pass" : "Would not pass"} · pass mark {passingScore}%
            </Badge>
            <Badge tone={conf.tone} size="sm" title="Model confidence">
              Confidence {conf.label}
              {grade.confidence !== null && grade.confidence !== undefined && ` · ${Math.round(grade.confidence * 100)}%`}
            </Badge>
          </div>
          <p className="mt-1.5 text-2xs text-slate-500">
            <Bot className="mr-1 inline size-3" aria-hidden />
            {grade.ai_model ?? "AI model"} · v{grade.submission_version ?? "—"} · {formatDateTime(grade.created_at)}
          </p>
        </div>
      </div>
      {fallback && (
        <p className="mx-5 mb-3 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> Heuristic fallback (no AI model was available). Treat this score as a rough guide.
        </p>
      )}
      {grade.summary && <p className="mx-5 mb-4 rounded-xl bg-violet-50/60 px-3.5 py-2.5 text-sm leading-relaxed text-slate-700">{grade.summary}</p>}

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-5 py-3">
        {onAccept && (
          <Button size="sm" variant={accepted ? "success" : "soft"} leftIcon={<CheckCheck />} onClick={onAccept} disabled={disabled}>
            {accepted ? "AI score applied" : "Accept AI score"}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open} rightIcon={<ChevronDown className={cn("transition-transform", open && "rotate-180")} />}>
          {open ? "Hide" : "Show"} breakdown
        </Button>
      </div>

      {open && (
        <div className="space-y-5 border-t border-slate-100 p-5">
          {rows.length > 0 && (
            <div className="space-y-3">
              {rows.map((r) => {
                const p = r.max ? (r.score / r.max) * 100 : 0;
                return (
                  <div key={r.criterion_id} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-slate-900">{r.name ?? r.criterion_id}</p>
                      <span className="text-sm font-bold tabular-nums text-slate-900">
                        {r.score}
                        <span className="font-medium text-slate-400">/{r.max}</span>
                      </span>
                    </div>
                    <Progress value={p} size="xs" color={p >= 70 ? "emerald" : p >= 50 ? "amber" : "rose"} className="mt-2" aria-label={`${r.name ?? r.criterion_id}: ${Math.round(p)}%`} />
                    {r.comment && <p className="mt-2 text-xs leading-relaxed text-slate-600">{r.comment}</p>}
                    {(r.evidence ?? []).length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {(r.evidence ?? []).map((q, i) => (
                          <li key={i} className="flex gap-1.5 rounded-lg border-l-2 border-violet-300 bg-violet-50/50 py-1 pl-2 pr-2 text-xs italic text-slate-700">
                            <Quote className="mt-0.5 size-3 shrink-0 text-violet-500" aria-hidden />“{q}”
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <ListBlock title="Strengths" items={(grade.strengths ?? []) as string[]} icon={ThumbsUp} tone="emerald" />
          <ListBlock title="Weaknesses" items={(grade.weaknesses ?? []) as string[]} icon={ThumbsDown} tone="rose" />
          <ListBlock title="Missing requirements" items={(grade.missing_requirements ?? []) as string[]} icon={ListX} tone="amber" />
          <ListBlock title="Improvements" items={(grade.improvements ?? []) as string[]} icon={Lightbulb} tone="sky" />
          <p className="text-2xs text-slate-500">
            Evidence quotes are verified against the submission text. The AI recommends; an assessor decides.
          </p>
        </div>
      )}
    </Card>
  );
}
