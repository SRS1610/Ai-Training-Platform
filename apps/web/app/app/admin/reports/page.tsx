"use client";

import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  FormField,
  Input,
  PageHeader,
  Skeleton,
  cn,
  colorClasses,
  toast,
  type CategoryColor,
} from "@praxis/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  BookOpen,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  Download,
  FileSpreadsheet,
  FileText,
  Gauge,
  type LucideIcon,
  MonitorPlay,
  ScrollText,
  ShieldCheck,
  Sheet as SheetIcon,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { ak } from "@/components/admin/keys";
import { CourseSelect, DepartmentSelect, MemberSelect, type Option } from "@/components/admin/pickers";
import type { ReportTypeOut } from "@/components/admin/types";
import { PageGate, deepGradient } from "@/components/admin/ui";
import { ErrorState } from "@/components/common/error-state";
import { api, errorMessage } from "@/lib/api";
import { Can } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";

const META: Record<string, { icon: LucideIcon; color: CategoryColor; blurb: string; audience: string }> = {
  learner_progress: { icon: UserRound, color: "sky", blurb: "Per-learner enrolments, progress, scores, time spent and completion dates.", audience: "Managers · HR" },
  course: { icon: BookOpen, color: "indigo", blurb: "Enrolment funnel, completion, scores and lesson drop-off for a single course.", audience: "Instructors" },
  compliance: { icon: ShieldCheck, color: "emerald", blurb: "Assigned training with due dates — on time, late, overdue — by course and person.", audience: "Compliance · Audit" },
  assignment: { icon: ClipboardCheck, color: "amber", blurb: "Practical assignment submissions, rubric scores and grading turnaround.", audience: "Assessors" },
  simulation: { icon: MonitorPlay, color: "violet", blurb: "Simulation attempts, bands, dimension scores and common mistakes.", audience: "Instructors · Managers" },
  competency: { icon: Gauge, color: "rose", blurb: "Competency coverage and skill gaps against required levels.", audience: "L&D · Managers" },
  organisation: { icon: Building2, color: "teal", blurb: "Organisation-wide KPIs, departments, top courses and activity.", audience: "Leadership" },
};

const FORMATS: { value: string; label: string; icon: LucideIcon; hint: string; color: CategoryColor }[] = [
  { value: "pdf", label: "PDF", icon: FileText, hint: "Branded, print-ready", color: "rose" },
  { value: "xlsx", label: "Excel", icon: FileSpreadsheet, hint: "Formatted workbook", color: "emerald" },
  { value: "csv", label: "CSV", icon: SheetIcon, hint: "Raw data for BI tools", color: "sky" },
];

interface Generated {
  name: string;
  file: string;
  at: Date;
  format: string;
}

function GenerateDialog({ report, onClose, onDone }: { report: ReportTypeOut | null; onClose: () => void; onDone: (g: Generated) => void }) {
  const [format, setFormat] = React.useState("pdf");
  const [course, setCourse] = React.useState<Option | null>(null);
  const [dept, setDept] = React.useState<string | null>(null);
  const [user, setUser] = React.useState<Option | null>(null);
  const [start, setStart] = React.useState("");
  const [end, setEnd] = React.useState("");
  React.useEffect(() => {
    if (report) {
      setFormat(report.formats.includes("pdf") ? "pdf" : (report.formats[0] ?? "pdf"));
      setCourse(null);
      setDept(null);
      setUser(null);
      setStart("");
      setEnd("");
      gen.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report]);
  const needsCourse = report?.requires.includes("course_id");
  const invalidRange = !!start && !!end && start > end;
  const gen = useMutation({
    mutationFn: () =>
      api.download(`/reports/${report!.type}`, {
        method: "POST",
        body: {
          format,
          course_id: course?.value ?? null,
          department_id: dept,
          user_id: user?.value ?? null,
          start_date: start || null,
          end_date: end || null,
        },
      }),
    onSuccess: (file) => {
      toast.success(`${report!.name} downloaded`, { description: file });
      onDone({ name: report!.name, file, at: new Date(), format });
      onClose();
    },
  });
  const m = report ? (META[report.type] ?? { icon: ScrollText, color: "indigo" as CategoryColor, blurb: "", audience: "" }) : null;
  const c = colorClasses(m?.color ?? "indigo");
  const Icon = m?.icon ?? ScrollText;
  return (
    <Dialog open={!!report} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <span className={cn("mb-1 grid size-11 place-items-center rounded-2xl bg-gradient-to-br text-white shadow-sm", c.gradient)}>
            <Icon className="size-5" aria-hidden />
          </span>
          <DialogTitle>{report?.name}</DialogTitle>
          <DialogDescription>{m?.blurb}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            if ((!needsCourse || course) && !invalidRange) gen.mutate();
          }}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Course" required={needsCourse} hint={needsCourse ? "Required for this report" : "Optional"}>
              {(aria) => <CourseSelect id={aria.id} value={course} onChange={setCourse} placeholder={needsCourse ? "Choose a course" : "All courses"} />}
            </FormField>
            <FormField label="Department" hint="Optional">
              {(aria) => <DepartmentSelect id={aria.id} value={dept} onChange={setDept} noneLabel="All departments" placeholder="All departments" />}
            </FormField>
            <FormField label="Learner" hint="Optional — one person's records">
              {(aria) => <MemberSelect id={aria.id} value={user} onChange={setUser} placeholder="Everyone" />}
            </FormField>
            <div className="grid grid-cols-2 gap-2">
              <FormField label="From" error={invalidRange ? "After end date" : null}>
                <Input type="date" value={start} max={end || undefined} onChange={(e) => setStart(e.target.value)} />
              </FormField>
              <FormField label="To">
                <Input type="date" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} />
              </FormField>
            </div>
          </div>
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-slate-800">Format</legend>
            <div className="grid grid-cols-3 gap-2">
              {FORMATS.filter((f) => !report || report.formats.includes(f.value)).map((f) => {
                const fc = colorClasses(f.color);
                const on = format === f.value;
                return (
                  <label
                    key={f.value}
                    className={cn(
                      "flex cursor-pointer flex-col items-center gap-1.5 rounded-2xl border p-3 text-center transition-all focus-within:ring-2 focus-within:ring-brand-500",
                      on ? cn("shadow-sm ring-1", fc.border, fc.soft, fc.ring) : "border-slate-200 hover:border-slate-300",
                    )}
                  >
                    <input type="radio" name="report-format" value={f.value} checked={on} onChange={() => setFormat(f.value)} className="sr-only" />
                    <f.icon className={cn("size-6", fc.icon)} aria-hidden />
                    <span className="text-sm font-semibold text-slate-900">{f.label}</span>
                    <span className="hidden text-2xs text-muted-foreground sm:block">{f.hint}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          {gen.isError && (
            <Alert tone="danger" title="Couldn't generate the report">
              {errorMessage(gen.error)}
            </Alert>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="gradient" leftIcon={<Download />} loading={gen.isPending} disabled={(needsCourse && !course) || invalidRange}>
              {gen.isPending ? "Generating…" : "Generate & download"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ReportsPage() {
  const types = useQuery({ queryKey: ak.reports.types, queryFn: ({ signal }) => api.get<ReportTypeOut[]>("/reports/types", { signal }) });
  const [open, setOpen] = React.useState<ReportTypeOut | null>(null);
  const [recent, setRecent] = React.useState<Generated[]>([]);

  return (
    <>
      <PageHeader
        icon={<ScrollText />}
        eyebrow="Insight"
        title="Reports"
        description="Generate audit-ready PDF, Excel and CSV reports with the filters you need."
        actions={
          <Can permission="analytics.view">
            <Button asChild variant="secondary" leftIcon={<BarChart3 />}>
              <Link href="/app/admin/analytics">Organisation analytics</Link>
            </Button>
          </Can>
        }
      />
      {types.isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-52 rounded-2xl" />
          ))}
        </div>
      ) : types.isError ? (
        <ErrorState error={types.error} onRetry={() => types.refetch()} />
      ) : !types.data?.length ? (
        <EmptyState illustration="chart" title="No reports available" description="Your role doesn't include any report types." />
      ) : (
        <div className="space-y-8">
          <ul className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {types.data.map((t) => {
              const m = META[t.type] ?? { icon: ScrollText, color: "indigo" as CategoryColor, blurb: "", audience: "" };
              const c = colorClasses(m.color);
              const Icon = m.icon;
              return (
                <li key={t.type}>
                  <article className={cn("group relative flex h-full flex-col overflow-hidden rounded-2xl border bg-white shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-lift", c.border)}>
                    <div className={cn("relative overflow-hidden bg-gradient-to-br p-5 text-white", deepGradient(m.color))}>
                      <div className="pointer-events-none absolute -right-8 -top-8 size-32 rounded-full bg-white/20 blur-2xl" aria-hidden />
                      <div className="relative flex items-start justify-between gap-3">
                        <span className="grid size-11 place-items-center rounded-2xl bg-white/20 ring-1 ring-white/30 backdrop-blur">
                          <Icon className="size-5" aria-hidden />
                        </span>
                        {t.requires.includes("course_id") && <span className="rounded-full bg-white/20 px-2 py-0.5 text-2xs font-semibold ring-1 ring-white/30">Per course</span>}
                      </div>
                      <h2 className="relative mt-4 font-display text-lg font-semibold">{t.name}</h2>
                      {m.audience && <p className="relative text-xs font-medium text-white/90">{m.audience}</p>}
                    </div>
                    <div className="flex flex-1 flex-col p-5">
                      <p className="text-sm text-slate-600">{m.blurb}</p>
                      <div className="mt-auto flex items-center justify-between gap-3 pt-4">
                        <div className="flex gap-1">
                          {t.formats.map((f) => (
                            <Badge key={f} tone="neutral" size="sm" className="uppercase">
                              {f}
                            </Badge>
                          ))}
                        </div>
                        <Button size="sm" variant="soft" leftIcon={<Download />} onClick={() => setOpen(t)}>
                          Generate
                        </Button>
                      </div>
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
          {recent.length > 0 && (
            <section aria-labelledby="recent-title" className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-soft">
              <h2 id="recent-title" className="font-display text-base font-semibold text-slate-900">
                Generated this session
              </h2>
              <ul className="mt-3 divide-y divide-slate-100">
                {recent.map((r, i) => (
                  <li key={i} className="flex items-center gap-3 py-2.5 text-sm">
                    <CheckCircle2 className="size-4 text-emerald-600" aria-hidden />
                    <span className="font-medium text-slate-900">{r.name}</span>
                    <span className="truncate font-mono text-xs text-slate-500">{r.file}</span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">{formatDateTime(r.at)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p className="text-xs text-muted-foreground">Every generated report is recorded in the audit log with its filters and row count.</p>
        </div>
      )}
      <GenerateDialog report={open} onClose={() => setOpen(null)} onDone={(g) => setRecent((r) => [g, ...r].slice(0, 10))} />
    </>
  );
}

export default function Page() {
  return (
    <PageGate permission="reports.export">
      <ReportsPage />
    </PageGate>
  );
}
