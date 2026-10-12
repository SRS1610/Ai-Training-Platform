"use client";

import { Button, EmptyState, KpiTile, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Tooltip, cn } from "@praxis/ui";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, CheckCircle2, ChevronDown, ClipboardList, Gauge, Info, Target } from "lucide-react";
import * as React from "react";
import { ErrorState } from "@/components/common/error-state";
import { api } from "@/lib/api";
import { ak } from "../keys";
import { questionMeta } from "../meta";
import { SectionCard, TypeChip } from "../shared";
import type { AssessmentStats as Stats, QuestionStat } from "../types";
import { plainText } from "./items-editor";

function rateTone(r: number | null): { bar: string; text: string; label: string } {
  if (r === null) return { bar: "bg-slate-300", text: "text-slate-500", label: "Not auto-scored" };
  if (r >= 0.8) return { bar: "bg-emerald-500", text: "text-emerald-700", label: "Easy" };
  if (r >= 0.5) return { bar: "bg-sky-500", text: "text-sky-700", label: "Healthy" };
  if (r >= 0.3) return { bar: "bg-amber-500", text: "text-amber-800", label: "Hard" };
  return { bar: "bg-rose-500", text: "text-rose-700", label: "Very hard" };
}

function discTone(d: number | null): { cls: string; label: string } {
  if (d === null) return { cls: "bg-slate-100 text-slate-600 ring-slate-200", label: "n/a" };
  if (d >= 0.3) return { cls: "bg-emerald-50 text-emerald-700 ring-emerald-200", label: "Strong" };
  if (d >= 0.1) return { cls: "bg-amber-50 text-amber-800 ring-amber-200", label: "Weak" };
  return { cls: "bg-rose-50 text-rose-700 ring-rose-200", label: "Review" };
}

const DIST_COLORS = ["bg-indigo-500", "bg-sky-500", "bg-emerald-500", "bg-amber-500", "bg-rose-500", "bg-fuchsia-500", "bg-teal-500", "bg-orange-500"];

function Distribution({ dist }: { dist: Record<string, number> }) {
  const entries = Object.entries(dist).sort(([a], [b]) => a.localeCompare(b));
  const total = entries.reduce((s, [, n]) => s + n, 0);
  if (!total) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <div className="min-w-[120px]">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`Choices picked: ${entries.map(([k, n]) => `${k} ${n}`).join(", ")}`}>
        {entries.map(([k, n], i) => (
          <span key={k} className={cn("h-full", DIST_COLORS[i % DIST_COLORS.length])} style={{ width: `${(n / total) * 100}%` }} />
        ))}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-2 text-2xs text-slate-600" aria-hidden>
        {entries.map(([k, n], i) => (
          <span key={k} className="inline-flex items-center gap-1">
            <span className={cn("size-1.5 rounded-full", DIST_COLORS[i % DIST_COLORS.length])} />
            {k.length > 6 ? `${k.slice(0, 6)}…` : k} {n}
          </span>
        ))}
      </div>
    </div>
  );
}

function Row({ q }: { q: QuestionStat }) {
  const m = questionMeta(q.question_type);
  const rt = rateTone(q.correct_rate);
  const dt = discTone(q.discrimination);
  return (
    <TableRow>
      <TableCell>
        <div className="flex min-w-[260px] max-w-xl items-start gap-2.5">
          <TypeChip meta={m} size="xs" className="mt-0.5" />
          <div className="min-w-0">
            <p className="line-clamp-2 text-sm font-medium text-slate-900">{plainText(q.prompt)}</p>
            <p className="text-2xs text-muted-foreground">
              {m.label} · {q.answered}/{q.responses} answered
            </p>
          </div>
        </div>
      </TableCell>
      <TableCell>
        <div className="w-36">
          <div className="flex items-baseline justify-between text-xs">
            <span className={cn("font-semibold tabular-nums", rt.text)}>{q.correct_rate === null ? "—" : `${Math.round(q.correct_rate * 100)}%`}</span>
            <span className="text-2xs text-muted-foreground">{rt.label}</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
            <div className={cn("h-full rounded-full", rt.bar)} style={{ width: `${(q.correct_rate ?? 0) * 100}%` }} />
          </div>
        </div>
      </TableCell>
      <TableCell className="tabular-nums text-slate-700">{q.mean_score_pct === null ? "—" : `${Math.round(q.mean_score_pct)}%`}</TableCell>
      <TableCell>
        <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-semibold ring-1 ring-inset tabular-nums", dt.cls)}>
          {q.discrimination === null ? "Needs more data" : `${q.discrimination.toFixed(2)} · ${dt.label}`}
        </span>
      </TableCell>
      <TableCell>
        <Distribution dist={q.choice_distribution} />
      </TableCell>
    </TableRow>
  );
}

/** Item analysis for an assessment (GET /assessments/{id}/stats). */
export function AssessmentStatsPanel({ assessmentId }: { assessmentId: string }) {
  const [showAll, setShowAll] = React.useState(false);
  const q = useQuery({
    queryKey: ak.assessments.stats(assessmentId),
    queryFn: ({ signal }) => api.get<Stats>(`/assessments/${assessmentId}/stats`, { signal }),
  });
  if (q.isLoading)
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    );
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data;
  const shown = showAll ? s.questions : s.questions.slice(0, 12);
  const flagged = s.questions.filter((x) => (x.correct_rate !== null && x.correct_rate < 0.3) || (x.discrimination !== null && x.discrimination < 0.1));

  return (
    <div className="space-y-6">
      <section aria-label="Assessment results" className="stagger grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <KpiTile label="Attempts" value={s.attempts} icon={<ClipboardList />} color="indigo" hint="All attempts started" />
        <KpiTile label="Graded" value={s.graded_attempts} icon={<CheckCircle2 />} color="sky" hint="Fully scored" />
        <KpiTile label="Average score" value={s.mean_percentage === null ? "—" : `${Math.round(s.mean_percentage)}%`} icon={<Gauge />} color="violet" hint="Across graded attempts" />
        <KpiTile label="Pass rate" value={s.pass_rate === null ? "—" : `${Math.round(s.pass_rate * 100)}%`} icon={<Target />} color="emerald" hint="Of graded attempts" />
      </section>

      {s.questions.length === 0 ? (
        <EmptyState bordered illustration="chart" title="No results yet" description="Item analysis appears once learners have completed graded attempts." />
      ) : (
        <SectionCard
          title="Item analysis"
          description="Hardest questions first. Discrimination compares the top and bottom 27% of scorers."
          icon={BarChart3}
          color="violet"
          action={
            flagged.length ? (
              <span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 ring-1 ring-inset ring-rose-200">
                {flagged.length} to review
              </span>
            ) : (
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">All healthy</span>
            )
          }
          contentClassName="px-0 sm:px-0"
        >
          <div className="overflow-x-auto">
            <Table aria-label="Question statistics">
              <TableHeader>
                <TableRow>
                  <TableHead>Question</TableHead>
                  <TableHead>Correct rate</TableHead>
                  <TableHead>Mean score</TableHead>
                  <TableHead>
                    <span className="inline-flex items-center gap-1">
                      Discrimination
                      <Tooltip content="≥ 0.30 separates strong from weak learners well; below 0.10 the question may be ambiguous or mis-keyed.">
                        <button type="button" className="rounded focus-visible:focus-ring" aria-label="About discrimination">
                          <Info className="size-3.5 text-slate-400" aria-hidden />
                        </button>
                      </Tooltip>
                    </span>
                  </TableHead>
                  <TableHead>Choices picked</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((x) => (
                  <Row key={x.question_id} q={x} />
                ))}
              </TableBody>
            </Table>
          </div>
          {s.questions.length > 12 && (
            <div className="border-t border-slate-100 px-5 pt-4 text-center">
              <Button variant="ghost" size="sm" rightIcon={<ChevronDown className={cn("transition-transform", showAll && "rotate-180")} />} onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
                {showAll ? "Show fewer" : `Show all ${s.questions.length} questions`}
              </Button>
            </div>
          )}
        </SectionCard>
      )}
    </div>
  );
}
