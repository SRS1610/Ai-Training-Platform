"use client";

import { Badge, ProgressRing, cn } from "@praxis/ui";
import { AlertTriangle, Bot, CheckCircle2, ListChecks, Lightbulb, MinusCircle, Sparkles, ThumbsUp, UserCheck } from "lucide-react";
import { Markdown } from "@/components/common/markdown";
import { formatDateTime } from "@/lib/format";
import type { Grade, LearnerAssignment, RubricBreakdownRow } from "../types";

function pctColor(p: number): { bar: string; text: string; label: string } {
  if (p >= 85) return { bar: "from-emerald-400 to-teal-500", text: "text-emerald-700", label: "Exemplary" };
  if (p >= 70) return { bar: "from-sky-400 to-indigo-500", text: "text-sky-700", label: "Proficient" };
  if (p >= 50) return { bar: "from-amber-400 to-orange-500", text: "text-amber-800", label: "Developing" };
  return { bar: "from-rose-400 to-rose-600", text: "text-rose-700", label: "Beginning" };
}

/** Grade source label: never present AI output as a human decision. */
export function GradeSourceBadge({ grade }: { grade: Pick<Grade, "source" | "is_final" | "ai_model"> }) {
  if (grade.source === "human")
    return (
      <Badge tone="success" size="sm">
        <UserCheck aria-hidden /> Assessor graded
      </Badge>
    );
  if (grade.source === "ai")
    return (
      <Badge tone="violet" size="sm">
        <Bot aria-hidden /> {grade.is_final ? "AI graded" : "AI recommendation"}
      </Badge>
    );
  return (
    <Badge tone="info" size="sm">
      <Sparkles aria-hidden /> Auto-graded
    </Badge>
  );
}

function ListBlock({ title, items, icon: Icon, tone }: { title: string; items: unknown[]; icon: typeof ThumbsUp; tone: "emerald" | "amber" | "rose" | "sky" }) {
  if (!items.length) return null;
  const cls = {
    emerald: "bg-emerald-50/70 ring-emerald-100 text-emerald-700",
    amber: "bg-amber-50/70 ring-amber-100 text-amber-800",
    rose: "bg-rose-50/70 ring-rose-100 text-rose-700",
    sky: "bg-sky-50/70 ring-sky-100 text-sky-700",
  }[tone];
  return (
    <section className={cn("rounded-2xl p-4 ring-1", cls)}>
      <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider">
        <Icon className="size-4" aria-hidden /> {title}
      </h4>
      <ul className="mt-2.5 space-y-1.5">
        {items.map((s, i) => (
          <li key={i} className="flex gap-2 text-sm text-slate-700">
            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-current opacity-60" aria-hidden />
            <span>{typeof s === "string" ? s : JSON.stringify(s)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function RubricBars({ rows }: { rows: RubricBreakdownRow[] }) {
  return (
    <ol className="space-y-4">
      {rows.map((r, i) => {
        const pct = r.max ? Math.max(0, Math.min(100, (r.score / r.max) * 100)) : 0;
        const c = pctColor(pct);
        return (
          <li key={r.criterion_id ?? i}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className="text-sm font-semibold text-slate-900">
                {r.name ?? `Criterion ${i + 1}`}
                {r.weight ? <span className="ml-2 text-xs font-medium text-slate-500">weight {Math.round(r.weight)}%</span> : null}
              </p>
              <p className="text-sm tabular-nums">
                <span className={cn("font-semibold", c.text)}>{c.label}</span>
                <span className="ml-2 font-semibold text-slate-900">
                  {Math.round(r.score * 100) / 100}/{r.max}
                </span>
              </p>
            </div>
            <div
              className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-slate-100"
              role="meter"
              aria-label={`${r.name ?? "Criterion"} score`}
              aria-valuenow={Math.round(pct)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className={cn("h-full rounded-full bg-gradient-to-r transition-[width] duration-700", c.bar)} style={{ width: `${pct}%` }} />
            </div>
            {r.comment && <p className="mt-1.5 text-sm text-slate-600">{r.comment}</p>}
          </li>
        );
      })}
    </ol>
  );
}

/** Released grade: score ring, pass state, rubric bars and written feedback. */
export function GradeFeedback({ grade, assignment }: { grade: Grade; assignment: LearnerAssignment }) {
  const pct = grade.max_score && grade.max_score !== 100 ? (grade.score / grade.max_score) * 100 : grade.score;
  const passed = grade.passed ?? pct >= assignment.passing_score;
  const rows = (grade.rubric_breakdown ?? []) as RubricBreakdownRow[];
  return (
    <div className="space-y-6">
      <section className={cn("relative overflow-hidden rounded-3xl bg-gradient-to-br p-px shadow-soft", passed ? "from-emerald-400 via-teal-400 to-sky-400" : "from-amber-400 via-orange-400 to-rose-400")}>
        <div className="flex flex-col items-center gap-6 rounded-[calc(1.5rem-1px)] bg-white p-6 text-center sm:flex-row sm:p-8 sm:text-left">
          <ProgressRing
            value={pct}
            size={128}
            stroke={12}
            color={passed ? "emerald" : "amber"}
            aria-label={`Final score ${Math.round(pct)}%`}
            label={
              <span className="flex flex-col items-center">
                <span className="font-display text-3xl font-extrabold tabular-nums text-slate-900">{Math.round(pct)}%</span>
                <span className="text-2xs font-medium text-slate-500">pass {Math.round(assignment.passing_score)}%</span>
              </span>
            }
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              <Badge tone={passed ? "success" : "danger"}>{passed ? <CheckCircle2 aria-hidden /> : <AlertTriangle aria-hidden />}{passed ? "Passed" : "Not passed"}</Badge>
              <GradeSourceBadge grade={grade} />
              {grade.submission_version ? (
                <Badge tone="neutral" size="sm">
                  Version {grade.submission_version}
                </Badge>
              ) : null}
            </div>
            <h3 className="mt-3 font-display text-2xl font-bold text-slate-900">{passed ? "Great work — you met the standard" : "Not quite there yet"}</h3>
            {grade.summary ? <Markdown className="mt-2 text-sm">{grade.summary}</Markdown> : null}
            <p className="mt-2 text-xs text-slate-500">
              Graded {formatDateTime(grade.created_at)}
              {grade.source === "ai" && grade.ai_model ? ` · model ${grade.ai_model}` : ""}
              {grade.source === "ai" && grade.confidence !== null ? ` · confidence ${Math.round((grade.confidence ?? 0) * 100)}%` : ""}
            </p>
          </div>
        </div>
      </section>

      {rows.length > 0 && (
        <section className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-soft sm:p-6" aria-labelledby="rubric-scores">
          <h3 id="rubric-scores" className="flex items-center gap-2 font-display text-base font-semibold text-slate-900">
            <ListChecks className="size-5 text-violet-600" aria-hidden /> Rubric scores
          </h3>
          <div className="mt-5">
            <RubricBars rows={rows} />
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <ListBlock title="Strengths" items={grade.strengths ?? []} icon={ThumbsUp} tone="emerald" />
        <ListBlock title="To improve" items={grade.weaknesses ?? []} icon={MinusCircle} tone="amber" />
        <ListBlock title="Missing requirements" items={grade.missing_requirements ?? []} icon={AlertTriangle} tone="rose" />
        <ListBlock title="Next steps" items={grade.improvements ?? []} icon={Lightbulb} tone="sky" />
      </div>
    </div>
  );
}
