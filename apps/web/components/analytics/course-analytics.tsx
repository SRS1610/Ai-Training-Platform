"use client";

import {
  Badge,
  BandChip,
  Button,
  Card,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  EmptyState,
  Input,
  Progress,
  SimpleSelect,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  bandMeta,
  cn,
  colorClasses,
  toast,
} from "@praxis/ui";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarRange,
  ChevronDown,
  Download,
  FileSpreadsheet,
  FileText,
  Flag,
  MonitorPlay,
  ArrowRight,
} from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { lessonIcon } from "@/components/dashboard/sections";
import { api, errorMessage } from "@/lib/api";
import { formatMinutes } from "@/lib/format";
import { num, pct, scaleClasses } from "./kit";
import type { SimAnalytics } from "./sim-analytics";

/* ------------------------------------------------------------------ types */

export interface CourseAnalytics {
  course: { id: string; title: string; status: string };
  range: { start: string | null; end: string | null };
  enrolments: {
    total: number;
    not_started: number;
    in_progress: number;
    completed: number;
    withdrawn: number;
    overdue: number;
    avg_progress: number | null;
    avg_final_score: number | null;
    avg_time_spent_seconds: number | null;
    avg_days_to_complete: number | null;
    completion_rate: number | null;
  };
  funnel: {
    module_id: string;
    title: string;
    position: number;
    learners_completed: number;
    completion_rate: number | null;
    lessons_count: number;
    lessons: { lesson_id: string; title: string; position: number; lesson_type: string; started: number; completed: number; completion_rate: number | null; avg_time_seconds: number | null }[];
  }[];
  assessments: { assessment_id: string; title: string; kind: string; attempts: number; learners: number; avg_percentage: number | null; pass_rate: number | null }[];
  questions: QuestionRow[];
  most_failed_questions: QuestionRow[];
  assignments: { assignment_id: string; title: string; submissions: number; graded: number; avg_score: number | null; pass_rate: number | null; distribution: { bucket: string; count: number }[] }[];
  simulations: { simulation_id: string; title: string; sessions: number; completed: number; learners: number; avg_score: number | null; pass_rate: number | null; bands: Record<string, number>; dimensions: { dimension: string; avg_score: number | null }[] }[];
}

export interface QuestionRow {
  question_id: string;
  prompt: string | null;
  question_type: string | null;
  tags: string[] | null;
  responses: number;
  p_value: number | null;
  discrimination: number | null;
  incorrect: number;
  difficulty: string | null;
  needs_review: boolean;
}

export interface PerformanceRow {
  user_id: string;
  full_name: string;
  email: string;
  department: string | null;
  enrolments: number;
  completed: number;
  overdue: number;
  avg_final_score: number | null;
  avg_assessment_pct: number | null;
  avg_simulation_score: number | null;
  attempts: number;
  simulations: number;
  completion_rate: number | null;
}

export const ak = {
  courses: (r: Record<string, unknown>) => ["analytics", "courses", r] as const,
  course: (id: string, r: Record<string, unknown>) => ["analytics", "course", id, r] as const,
  org: (r: Record<string, unknown>) => ["analytics", "organisation", r] as const,
  dashboard: (scope: string) => ["dashboard", "instructor", scope] as const,
};

/* ------------------------------------------------------------------ date range + export */

const PRESETS = [
  { id: "all", label: "All time", days: null },
  { id: "30", label: "Last 30 days", days: 30 },
  { id: "90", label: "Last 90 days", days: 90 },
  { id: "365", label: "Last 12 months", days: 365 },
];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function DateRangeControl({ start, end, onChange }: { start?: string; end?: string; onChange: (r: { start?: string; end?: string }) => void }) {
  const preset = !start && !end ? "all" : PRESETS.find((p) => p.days && end === iso(new Date()) && start === iso(new Date(Date.now() - (p.days - 1) * 86400000)))?.id ?? "custom";
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Date range">
      <CalendarRange className="size-4 text-slate-500" aria-hidden />
      <SimpleSelect
        aria-label="Date range preset"
        className="h-9 w-40"
        value={preset}
        onValueChange={(v) => {
          const p = PRESETS.find((x) => x.id === v);
          if (!p) return;
          if (!p.days) onChange({});
          else onChange({ start: iso(new Date(Date.now() - (p.days - 1) * 86400000)), end: iso(new Date()) });
        }}
        options={[...PRESETS.map((p) => ({ value: p.id, label: p.label })), ...(preset === "custom" ? [{ value: "custom", label: "Custom range" }] : [])]}
      />
      <Input type="date" inputSize="sm" aria-label="Start date" className="w-36" value={start ?? ""} max={end} onChange={(e) => onChange({ start: e.target.value || undefined, end })} />
      <span className="text-xs text-slate-500">to</span>
      <Input type="date" inputSize="sm" aria-label="End date" className="w-36" value={end ?? ""} min={start} onChange={(e) => onChange({ start, end: e.target.value || undefined })} />
    </div>
  );
}

export function ExportMenu({ type, body, label = "Export report" }: { type: "course" | "organisation" | "simulation"; body: Record<string, unknown>; label?: string }) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const run = async (format: "pdf" | "xlsx" | "csv") => {
    setBusy(format);
    try {
      const name = await api.download(`/reports/${type}`, { method: "POST", body: { ...body, format } });
      toast.success(`Downloaded ${name}`);
    } catch (e) {
      toast.error(errorMessage(e, "The report couldn't be generated."));
    } finally {
      setBusy(null);
    }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" leftIcon={<Download />} rightIcon={<ChevronDown />} loading={!!busy}>
          {busy ? `Generating ${busy.toUpperCase()}…` : label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Download as</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => run("pdf")}>
          <FileText /> PDF report
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run("xlsx")}>
          <FileSpreadsheet /> Excel (.xlsx)
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run("csv")}>
          <FileSpreadsheet /> CSV
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ------------------------------------------------------------------ funnel by module */

export function ModuleFunnel({ funnel, base }: { funnel: CourseAnalytics["funnel"]; base: number }) {
  const [open, setOpen] = React.useState<string | null>(funnel[0]?.module_id ?? null);
  const palette = ["indigo", "sky", "teal", "emerald", "amber", "orange", "rose", "fuchsia", "violet"] as const;
  if (!funnel.length) return <EmptyState size="sm" illustration="learning" title="No modules yet" description="Add modules and lessons to see the completion funnel." />;
  return (
    <ol className="space-y-2">
      {funnel.map((m, i) => {
        const c = colorClasses(palette[i % palette.length]!);
        const rate = m.completion_rate ?? 0;
        const expanded = open === m.module_id;
        return (
          <li key={m.module_id} className="rounded-2xl border border-slate-200 bg-white">
            <button
              type="button"
              onClick={() => setOpen(expanded ? null : m.module_id)}
              aria-expanded={expanded}
              className="flex w-full items-center gap-3 rounded-2xl p-3 text-left hover:bg-slate-50 focus-visible:focus-ring"
            >
              <span className={cn("grid size-8 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-xs font-bold text-white", c.gradient)}>{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                  <p className="truncate text-sm font-semibold text-slate-900">{m.title}</p>
                  <span className="shrink-0 text-xs tabular-nums text-slate-600">
                    <span className="font-bold text-slate-900">{m.learners_completed}</span>/{base} · {pct(m.completion_rate)}
                  </span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className={cn("h-full rounded-full bg-gradient-to-r", c.gradient)} style={{ width: `${Math.max(rate, rate > 0 ? 2 : 0)}%` }} />
                </div>
              </div>
              <ChevronDown className={cn("size-4 shrink-0 text-slate-400 transition-transform", expanded && "rotate-180")} aria-hidden />
            </button>
            {expanded && (
              <ul className="space-y-1.5 border-t border-slate-100 px-3 pb-3 pt-2">
                {m.lessons.length === 0 && <li className="text-xs italic text-slate-500">No lessons in this module.</li>}
                {m.lessons.map((l) => {
                  const Icon = lessonIcon(l.lesson_type);
                  return (
                    <li key={l.lesson_id} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,1fr)_160px_auto]">
                      <span className="flex min-w-0 items-center gap-2 text-sm text-slate-700">
                        <Icon className={cn("size-4 shrink-0", c.icon)} aria-hidden />
                        <span className="truncate">{l.title}</span>
                      </span>
                      <Progress value={l.completion_rate ?? 0} size="xs" color={palette[i % palette.length]} className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto" aria-label={`${l.title} completion ${pct(l.completion_rate)}`} />
                      <span className="text-right text-2xs tabular-nums text-slate-500">
                        {l.completed}/{l.started} done{l.avg_time_seconds ? ` · ${formatMinutes(l.avg_time_seconds / 60)}` : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------------ questions */

function pTone(p: number | null) {
  return scaleClasses(p, [0.3, 0.5, 0.8]);
}
function dTone(d: number | null) {
  if (d === null) return "bg-slate-100 text-slate-500";
  if (d < 0) return "bg-rose-100 text-rose-800";
  if (d < 0.2) return "bg-amber-100 text-amber-900";
  if (d < 0.3) return "bg-sky-100 text-sky-800";
  return "bg-emerald-100 text-emerald-800";
}

export function QuestionTable({ rows }: { rows: QuestionRow[] }) {
  const [sort, setSort] = React.useState<"p" | "d" | "responses">("p");
  const [onlyFlagged, setOnlyFlagged] = React.useState(false);
  const sorted = [...rows]
    .filter((r) => !onlyFlagged || r.needs_review)
    .sort((a, b) => (sort === "p" ? (a.p_value ?? 2) - (b.p_value ?? 2) : sort === "d" ? (a.discrimination ?? 2) - (b.discrimination ?? 2) : b.responses - a.responses));
  if (!rows.length) return <EmptyState size="sm" illustration="chart" title="No graded answers yet" description="Item statistics appear once learners complete graded attempts." />;
  const flagged = rows.filter((r) => r.needs_review).length;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SimpleSelect
          aria-label="Sort questions"
          className="h-9 w-56"
          value={sort}
          onValueChange={(v) => setSort(v as "p")}
          options={[
            { value: "p", label: "Hardest first (p-value)" },
            { value: "d", label: "Weakest discrimination first" },
            { value: "responses", label: "Most responses" },
          ]}
        />
        <Button size="sm" variant={onlyFlagged ? "destructive-soft" : "secondary"} leftIcon={<Flag />} aria-pressed={onlyFlagged} onClick={() => setOnlyFlagged((f) => !f)}>
          Needs review ({flagged})
        </Button>
        <p className="ml-auto text-2xs text-slate-500">
          <span className="font-semibold">p-value</span> = share answering correctly (low = hard) · <span className="font-semibold">discrimination</span> = correlation with total score (&lt; 0.2 is weak)
        </p>
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-200">
        <Table aria-label="Question difficulty and discrimination">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Question</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Responses</TableHead>
              <TableHead className="text-right">p-value</TableHead>
              <TableHead className="text-right">Discrimination</TableHead>
              <TableHead>Flag</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((q) => (
              <TableRow key={q.question_id}>
                <TableCell className="max-w-md">
                  <p className="line-clamp-2 text-sm text-slate-800" title={q.prompt ?? undefined}>
                    {q.prompt ?? <span className="italic text-slate-400">Deleted question</span>}
                  </p>
                </TableCell>
                <TableCell>
                  <span className="whitespace-nowrap text-xs text-slate-600">{(q.question_type ?? "—").replace(/_/g, " ")}</span>
                </TableCell>
                <TableCell className="text-right tabular-nums">{q.responses}</TableCell>
                <TableCell className="text-right">
                  <span className={cn("inline-block min-w-14 rounded-md px-2 py-0.5 text-center text-xs font-bold tabular-nums", pTone(q.p_value))} title={q.difficulty ?? undefined}>
                    {q.p_value === null ? "—" : q.p_value.toFixed(2)}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <span className={cn("inline-block min-w-14 rounded-md px-2 py-0.5 text-center text-xs font-bold tabular-nums", dTone(q.discrimination))}>{q.discrimination === null ? "—" : q.discrimination.toFixed(2)}</span>
                </TableCell>
                <TableCell>
                  {q.needs_review ? (
                    <Badge tone="danger" size="sm">
                      <AlertTriangle aria-hidden /> Review
                    </Badge>
                  ) : (
                    <Badge tone="success" size="sm">
                      OK
                    </Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export function MostFailed({ rows }: { rows: QuestionRow[] }) {
  if (!rows.length) return <EmptyState size="sm" illustration="trophy" title="No failed questions" description="Nobody has answered a question incorrectly yet." />;
  const max = Math.max(...rows.map((r) => r.incorrect), 1);
  return (
    <ol className="space-y-3">
      {rows.map((q, i) => (
        <li key={q.question_id} className="flex gap-3">
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-rose-100 text-xs font-bold text-rose-700">{i + 1}</span>
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-sm text-slate-800">{q.prompt ?? "Deleted question"}</p>
            <div className="mt-1 flex items-center gap-2">
              <Progress value={(q.incorrect / max) * 100} color="rose" size="xs" className="flex-1" aria-label={`${q.incorrect} incorrect answers`} />
              <span className="text-xs tabular-nums text-slate-600">
                <span className="font-bold text-rose-700">{q.incorrect}</span> wrong · p {q.p_value?.toFixed(2) ?? "—"}
              </span>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------------ assignment histogram */

const BUCKET_STYLE: Record<string, string> = {
  "0-49": "from-rose-400 to-rose-600",
  "50-59": "from-orange-400 to-orange-600",
  "60-69": "from-amber-300 to-amber-500",
  "70-79": "from-sky-400 to-sky-600",
  "80-89": "from-violet-400 to-violet-600",
  "90-100": "from-emerald-400 to-emerald-600",
};

export function ScoreHistogram({ data }: { data: { bucket: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const total = data.reduce((a, d) => a + d.count, 0);
  return (
    <figure>
      <div className="flex h-48 items-end gap-2 border-b border-slate-200 pb-0" role="img" aria-label={`Score distribution: ${data.map((d) => `${d.bucket}: ${d.count}`).join(", ")}`}>
        {data.map((d) => (
          <div key={d.bucket} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
            <span className="text-xs font-bold tabular-nums text-slate-800">{d.count}</span>
            <div className={cn("w-full rounded-t-lg bg-gradient-to-t transition-[height] duration-700 ease-spring", BUCKET_STYLE[d.bucket] ?? "from-indigo-400 to-indigo-600")} style={{ height: `${(d.count / max) * 82}%`, minHeight: d.count ? 4 : 0 }} title={`${d.bucket}: ${d.count} (${total ? Math.round((d.count / total) * 100) : 0}%)`} />
          </div>
        ))}
      </div>
      <figcaption className="mt-1.5 flex gap-2">
        {data.map((d) => (
          <span key={d.bucket} className="flex-1 text-center text-2xs font-medium tabular-nums text-slate-500">
            {d.bucket}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

export function AssignmentDistribution({ assignments }: { assignments: CourseAnalytics["assignments"] }) {
  const [id, setId] = React.useState(assignments[0]?.assignment_id ?? "");
  const a = assignments.find((x) => x.assignment_id === id) ?? assignments[0];
  if (!a) return <EmptyState size="sm" illustration="inbox" title="No assignments in this course" />;
  return (
    <div className="space-y-4">
      {assignments.length > 1 && (
        <SimpleSelect aria-label="Assignment" className="h-9" value={a.assignment_id} onValueChange={setId} options={assignments.map((x) => ({ value: x.assignment_id, label: x.title }))} />
      )}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-indigo-50 px-2 py-2">
          <p className="font-display text-lg font-bold tabular-nums text-indigo-700">{a.submissions}</p>
          <p className="text-2xs font-semibold uppercase tracking-wider text-slate-600">Submitted</p>
        </div>
        <div className="rounded-xl bg-amber-50 px-2 py-2">
          <p className="font-display text-lg font-bold tabular-nums text-amber-800">{num(a.avg_score)}</p>
          <p className="text-2xs font-semibold uppercase tracking-wider text-slate-600">Avg score</p>
        </div>
        <div className="rounded-xl bg-emerald-50 px-2 py-2">
          <p className="font-display text-lg font-bold tabular-nums text-emerald-700">{pct(a.pass_rate)}</p>
          <p className="text-2xs font-semibold uppercase tracking-wider text-slate-600">Pass rate</p>
        </div>
      </div>
      {a.graded ? <ScoreHistogram data={a.distribution} /> : <p className="py-8 text-center text-sm text-muted-foreground">No graded submissions yet.</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ simulations */

const bandKey = (b: string) => b.toLowerCase().replace(/[\s-]+/g, "_");

function SimDimensionBars({ simId }: { simId: string }) {
  const q = useQuery({ queryKey: ["simulations", "analytics", simId], queryFn: ({ signal }) => api.get<SimAnalytics>(`/simulations/${simId}/analytics`, { signal }), staleTime: 60_000 });
  if (q.isLoading) return <Skeleton className="h-24 rounded-xl" />;
  const dims = (q.data?.dimensions ?? []).filter((d) => d.average_percent !== null);
  if (!dims.length) return <p className="text-xs text-slate-500">No completed runs to break down yet.</p>;
  const palette = ["indigo", "sky", "emerald", "amber", "rose", "fuchsia", "teal", "orange", "violet"] as const;
  return (
    <ul className="space-y-1.5" aria-label="Average by dimension (all time)">
      {dims.map((d, i) => (
        <li key={d.id} className="grid grid-cols-[minmax(0,9rem)_1fr_3rem] items-center gap-2">
          <span className="truncate text-xs text-slate-600" title={d.name}>
            {d.name}
          </span>
          <Progress value={d.average_percent ?? 0} size="sm" color={palette[i % palette.length]} aria-label={`${d.name} ${pct(d.average_percent)}`} />
          <span className="text-right text-xs font-semibold tabular-nums text-slate-800">{pct(d.average_percent)}</span>
        </li>
      ))}
    </ul>
  );
}

export function SimulationResults({ sims }: { sims: CourseAnalytics["simulations"] }) {
  if (!sims.length) return <EmptyState size="sm" illustration="rocket" title="No simulations linked to this course" description="Link a simulation to the course to see results by dimension." />;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {sims.map((s) => {
        const total = Object.values(s.bands).reduce((a, b) => a + b, 0);
        return (
          <Card key={s.simulation_id} className="p-4">
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white">
                <MonitorPlay className="size-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-slate-900">{s.title}</p>
                <p className="text-xs text-slate-500">
                  {s.sessions} sessions · {s.learners} learners · {s.completed} completed
                </p>
              </div>
              <Button size="xs" variant="ghost" rightIcon={<ArrowRight />} asChild>
                <Link href={`/app/instructor/simulations/${s.simulation_id}/analytics`}>Details</Link>
              </Button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-amber-50 px-3 py-2">
                <p className="text-2xs font-semibold uppercase tracking-wider text-slate-600">Avg score</p>
                <p className="font-display text-lg font-bold tabular-nums text-amber-800">{num(s.avg_score)}</p>
              </div>
              <div className="rounded-xl bg-emerald-50 px-3 py-2">
                <p className="text-2xs font-semibold uppercase tracking-wider text-slate-600">Pass rate</p>
                <p className="font-display text-lg font-bold tabular-nums text-emerald-700">{pct(s.pass_rate)}</p>
              </div>
            </div>
            {total > 0 && (
              <div className="mt-3">
                <div className="flex h-2.5 overflow-hidden rounded-full" role="img" aria-label={Object.entries(s.bands).map(([b, n]) => `${bandMeta(bandKey(b)).label}: ${n}`).join(", ")}>
                  {Object.entries(s.bands).map(([b, n]) => (
                    <div key={b} className={colorClasses(bandMeta(bandKey(b)).color).solid} style={{ width: `${(n / total) * 100}%` }} />
                  ))}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {Object.entries(s.bands).map(([b, n]) => (
                    <span key={b} className="inline-flex items-center gap-1 text-2xs text-slate-600">
                      <BandChip band={bandKey(b)} size="sm" /> {n}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="mt-4">
              <p className="mb-1.5 text-xs font-semibold text-slate-600">By dimension</p>
              <SimDimensionBars simId={s.simulation_id} />
            </div>
          </Card>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ learners needing attention */

export function AtRiskLearners({ rows, loading, passMark = 70 }: { rows: PerformanceRow[]; loading?: boolean; passMark?: number }) {
  if (loading)
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-12 rounded-xl" />
        ))}
      </div>
    );
  const flagged = rows
    .filter((r) => r.enrolments > 0)
    .map((r) => {
      const reasons: { label: string; tone: "danger" | "warning" }[] = [];
      if (r.overdue > 0) reasons.push({ label: `${r.overdue} overdue`, tone: "danger" });
      if (r.avg_assessment_pct !== null && r.avg_assessment_pct < passMark) reasons.push({ label: `Quizzes ${r.avg_assessment_pct}%`, tone: "warning" });
      if (r.avg_simulation_score !== null && r.avg_simulation_score < passMark) reasons.push({ label: `Simulations ${r.avg_simulation_score}`, tone: "warning" });
      if (r.avg_final_score !== null && r.avg_final_score < passMark) reasons.push({ label: `Final ${r.avg_final_score}`, tone: "danger" });
      return { r, reasons };
    })
    .filter((x) => x.reasons.length)
    .sort((a, b) => b.reasons.length - a.reasons.length);
  if (!flagged.length) return <EmptyState size="sm" illustration="trophy" title="Nobody is struggling" description="No learner in this course is overdue or below the pass mark." />;
  return (
    <ul className="divide-y divide-slate-100">
      {flagged.slice(0, 12).map(({ r, reasons }) => (
        <li key={r.user_id} className="flex flex-wrap items-center gap-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-900">{r.full_name}</p>
            <p className="truncate text-xs text-slate-500">
              {r.department ?? "No department"} · {pct(r.completion_rate)} complete
            </p>
          </div>
          <div className="flex flex-wrap gap-1">
            {reasons.map((x) => (
              <Badge key={x.label} tone={x.tone} size="sm">
                {x.label}
              </Badge>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}
