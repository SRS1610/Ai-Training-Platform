"use client";

import { Alert, FormField, Input, SimpleSelect, Switch, Textarea, cn, colorClasses } from "@praxis/ui";
import { useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Gauge, Infinity as InfinityIcon, MinusCircle, Repeat, Scale, Settings2, ShieldAlert, Shuffle, Timer, Wand2 } from "lucide-react";
import * as React from "react";
import { api } from "@/lib/api";
import { useAutosave, type AutosaveState } from "../hooks";
import { ak } from "../keys";
import { ASSESSMENT_KINDS, GRADING_MODES } from "../meta";
import { NumberInput, SaveIndicator, SectionCard, ToggleRow } from "../shared";
import type { AssessmentDetail } from "../types";
import { useCourseOptions } from "../use-options";

type Form = {
  title: string;
  description: string;
  course_id: string | null;
  kind: string;
  time_limit_minutes: number | null;
  max_attempts: number | null;
  pass_percentage: number;
  shuffle_questions: boolean;
  shuffle_options: boolean;
  negative_marking: boolean;
  grading_mode: string;
  high_stakes: boolean;
  show_feedback: string;
  weight_in_course: number;
};

function toForm(a: AssessmentDetail): Form {
  return {
    title: a.title,
    description: a.description ?? "",
    course_id: a.course_id,
    kind: a.kind,
    time_limit_minutes: a.time_limit_minutes,
    max_attempts: a.max_attempts,
    pass_percentage: a.pass_percentage,
    shuffle_questions: a.shuffle_questions,
    shuffle_options: a.shuffle_options,
    negative_marking: a.negative_marking,
    grading_mode: a.grading_mode,
    high_stakes: a.high_stakes,
    show_feedback: a.show_feedback,
    weight_in_course: a.weight_in_course,
  };
}

const FEEDBACK = [
  { value: "after_submit", label: "Right after submitting", description: "Score, correct answers and explanations", icon: Eye, color: "emerald" as const },
  { value: "after_close", label: "After the assessment closes", description: "Score now, answers once attempts are used up", icon: Timer, color: "amber" as const },
  { value: "never", label: "Score only", description: "Answers are never revealed", icon: EyeOff, color: "rose" as const },
];

function RadioCards<T extends string>({
  value,
  onChange,
  options,
  label,
  columns = "sm:grid-cols-2",
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; description: string; color: Parameters<typeof colorClasses>[0]; icon?: React.ComponentType<{ className?: string }> }[];
  label: string;
  columns?: string;
}) {
  return (
    <div className={cn("grid gap-2", columns)} role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const on = value === o.value;
        const c = colorClasses(o.color);
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex items-start gap-3 rounded-2xl border p-3 text-left transition-all focus-visible:focus-ring",
              on ? cn(c.border, c.soft, "shadow-sm ring-1", c.ring) : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50",
            )}
          >
            <span className={cn("mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border-2", on ? cn("border-transparent", c.solid) : "border-slate-300")} aria-hidden>
              {on && <span className="size-1.5 rounded-full bg-white" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className={cn("flex items-center gap-1.5 text-sm font-semibold", on ? c.text : "text-slate-900")}>
                {Icon && <Icon className="size-4" />}
                {o.label}
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{o.description}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Assessment rules: kind, timing, attempts, pass mark, shuffling, negative marking, grading, feedback. Autosaves. */
export function AssessmentSettings({ assessment, onSaveState }: { assessment: AssessmentDetail; onSaveState?: (s: AutosaveState & { flush: () => Promise<void> }) => void }) {
  const qc = useQueryClient();
  const courses = useCourseOptions();
  const [form, setForm] = React.useState<Form>(() => toForm(assessment));
  const errors: Partial<Record<keyof Form, string>> = {};
  if (!form.title.trim()) errors.title = "Title is required";
  if (form.pass_percentage < 0 || form.pass_percentage > 100) errors.pass_percentage = "0–100";
  if (form.time_limit_minutes !== null && (form.time_limit_minutes < 1 || form.time_limit_minutes > 1440)) errors.time_limit_minutes = "1–1440 minutes";
  if (form.max_attempts !== null && (form.max_attempts < 1 || form.max_attempts > 100)) errors.max_attempts = "1–100";

  const save = useAutosave(async (f: Form) => {
    if (!f.title.trim()) throw new Error("A title is required to save");
    const out = await api.patch<AssessmentDetail>(`/assessments/${assessment.id}`, {
      ...f,
      title: f.title.trim(),
      description: f.description.trim() || null,
      pass_percentage: Math.max(0, Math.min(100, f.pass_percentage)),
    });
    qc.setQueryData(ak.assessments.detail(assessment.id), out);
    qc.invalidateQueries({ queryKey: ["assessments", "list"] });
  });
  const { status, error, savedAt, flush } = save;
  React.useEffect(() => onSaveState?.({ status, error, savedAt, flush }), [status, error, savedAt, flush, onSaveState]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    const next = { ...form, [k]: v };
    setForm(next);
    if (k === "time_limit_minutes" && v !== null && ((v as number) < 1 || (v as number) > 1440)) return;
    if (k === "max_attempts" && v !== null && ((v as number) < 1 || (v as number) > 100)) return;
    save.schedule(next);
  };

  const timed = form.time_limit_minutes !== null;
  const limited = form.max_attempts !== null;

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-6">
        <SaveIndicator status={save.status} error={save.error} savedAt={save.savedAt} onRetry={() => void save.flush()} />
        <SectionCard title="Basics" description="What learners see before they start" icon={Settings2} color="indigo">
          <div className="space-y-4">
            <FormField label="Title" required error={errors.title}>
              <Input value={form.title} onChange={(e) => set("title", e.target.value)} maxLength={255} />
            </FormField>
            <FormField label="Instructions" hint="Shown on the start screen: scope, rules, what to have ready.">
              <Textarea rows={4} value={form.description} onChange={(e) => set("description", e.target.value)} maxLength={20000} />
            </FormField>
            <FormField label="Course" hint="Linking scopes reporting and lets quiz lessons use it.">
              {(aria) => (
                <SimpleSelect
                  {...aria}
                  value={form.course_id ?? "none"}
                  onValueChange={(v) => set("course_id", v === "none" ? null : v)}
                  options={[{ value: "none", label: "Not linked to a course" }, ...courses.options]}
                />
              )}
            </FormField>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-slate-800">Kind</legend>
              <RadioCards label="Kind" value={form.kind} onChange={(v) => set("kind", v)} options={ASSESSMENT_KINDS} columns="grid-cols-2 lg:grid-cols-4" />
            </fieldset>
          </div>
        </SectionCard>

        <SectionCard title="Timing & attempts" description="How long and how often learners can sit it" icon={Timer} color="sky">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="as-timed" className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Timer className="size-4 text-sky-600" aria-hidden /> Time limit
                </label>
                <Switch id="as-timed" checked={timed} onCheckedChange={(v) => set("time_limit_minutes", v ? (assessment.time_limit_minutes ?? 30) : null)} />
              </div>
              {timed ? (
                <FormField label="Minutes" error={errors.time_limit_minutes}>
                  {(aria) => <NumberInput {...aria} value={form.time_limit_minutes} onChange={(v) => set("time_limit_minutes", v ?? 1)} min={1} max={1440} suffix="min" />}
                </FormField>
              ) : (
                <p className="text-xs text-muted-foreground">Untimed — learners can take as long as they need.</p>
              )}
            </div>
            <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="as-limited" className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Repeat className="size-4 text-violet-600" aria-hidden /> Limit attempts
                </label>
                <Switch id="as-limited" checked={limited} onCheckedChange={(v) => set("max_attempts", v ? (assessment.max_attempts ?? 3) : null)} />
              </div>
              {limited ? (
                <FormField label="Attempts allowed" error={errors.max_attempts}>
                  {(aria) => <NumberInput {...aria} value={form.max_attempts} onChange={(v) => set("max_attempts", v ?? 1)} min={1} max={100} />}
                </FormField>
              ) : (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <InfinityIcon className="size-3.5" aria-hidden /> Unlimited attempts
                </p>
              )}
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Scoring" description="Pass mark, weighting and penalties" icon={Gauge} color="emerald">
          <div className="space-y-4">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label htmlFor="as-pass" className="text-sm font-medium text-slate-800">
                  Pass mark
                </label>
                <span className="font-display text-2xl font-bold tabular-nums text-emerald-700">{Math.round(form.pass_percentage)}%</span>
              </div>
              <input
                id="as-pass"
                type="range"
                min={0}
                max={100}
                step={5}
                value={form.pass_percentage}
                onChange={(e) => set("pass_percentage", Number(e.target.value))}
                className="w-full accent-emerald-600"
                aria-valuetext={`${form.pass_percentage}%`}
              />
              <div className="mt-1 flex justify-between text-2xs font-medium text-slate-500" aria-hidden>
                <span>0%</span>
                <span>50%</span>
                <span>100%</span>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Weight in course" hint="Relative weight when the course computes a final grade.">
                {(aria) => <NumberInput {...aria} value={form.weight_in_course} onChange={(v) => set("weight_in_course", Math.max(0, Math.min(100, v ?? 0)))} min={0} max={100} step={0.5} />}
              </FormField>
              <div className="sm:pt-6">
                <ToggleRow
                  icon={MinusCircle}
                  color="rose"
                  label="Negative marking"
                  description="Subtract each question's negative points for wrong answers."
                  checked={form.negative_marking}
                  onCheckedChange={(v) => set("negative_marking", v)}
                />
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Delivery" description="Order, integrity and grading" icon={Shuffle} color="violet">
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <ToggleRow icon={Shuffle} color="violet" label="Shuffle questions" description="Each attempt gets a different order." checked={form.shuffle_questions} onCheckedChange={(v) => set("shuffle_questions", v)} />
              <ToggleRow icon={Shuffle} color="sky" label="Shuffle answer options" description="Randomise choice order per learner." checked={form.shuffle_options} onCheckedChange={(v) => set("shuffle_options", v)} />
            </div>
            <ToggleRow
              icon={ShieldAlert}
              color="rose"
              label="High stakes"
              description="Certification-grade: integrity signals are recorded and attempts jump to the top of the review queue."
              checked={form.high_stakes}
              onCheckedChange={(v) => set("high_stakes", v)}
            />
            <fieldset className="space-y-2">
              <legend className="flex items-center gap-2 text-sm font-medium text-slate-800">
                <Wand2 className="size-4 text-fuchsia-600" aria-hidden /> Grading mode for open answers
              </legend>
              <RadioCards label="Grading mode" value={form.grading_mode} onChange={(v) => set("grading_mode", v)} options={GRADING_MODES} />
            </fieldset>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-slate-800">Show feedback</legend>
              <RadioCards label="Show feedback" value={form.show_feedback} onChange={(v) => set("show_feedback", v)} options={FEEDBACK} columns="sm:grid-cols-3" />
            </fieldset>
          </div>
        </SectionCard>
      </div>

      <aside className="space-y-4 xl:sticky xl:top-20 xl:self-start">
        <div className="rounded-3xl border border-slate-200 bg-gradient-to-br from-indigo-50 via-white to-violet-50 p-5 shadow-soft">
          <p className="text-xs font-semibold uppercase tracking-wider text-brand-700">Learner sees</p>
          <ul className="mt-3 space-y-2.5 text-sm text-slate-700">
            <li className="flex items-center gap-2.5">
              <Timer className="size-4 shrink-0 text-sky-600" aria-hidden />
              {timed ? `${form.time_limit_minutes} minutes, auto-submits when time is up` : "No time limit"}
            </li>
            <li className="flex items-center gap-2.5">
              <Repeat className="size-4 shrink-0 text-violet-600" aria-hidden />
              {limited ? `${form.max_attempts} attempt${form.max_attempts === 1 ? "" : "s"}` : "Unlimited attempts"}
            </li>
            <li className="flex items-center gap-2.5">
              <Gauge className="size-4 shrink-0 text-emerald-600" aria-hidden />
              Pass with {Math.round(form.pass_percentage)}%{form.negative_marking ? " · wrong answers cost points" : ""}
            </li>
            <li className="flex items-center gap-2.5">
              <Eye className="size-4 shrink-0 text-amber-600" aria-hidden />
              {FEEDBACK.find((f) => f.value === form.show_feedback)?.label ?? "Feedback"}
            </li>
            <li className="flex items-center gap-2.5">
              <Scale className="size-4 shrink-0 text-fuchsia-600" aria-hidden />
              {GRADING_MODES.find((g) => g.value === form.grading_mode)?.label ?? form.grading_mode}
            </li>
          </ul>
        </div>
        {form.high_stakes && (
          <Alert tone="warning" title="High-stakes assessment">
            Integrity events such as tab switches are logged with each attempt, and open answers are reviewed first in the grading queue.
          </Alert>
        )}
        {assessment.status === "published" && (
          <Alert tone="info" title="This assessment is live">
            Rule changes apply to new attempts. Attempts already started keep the rules they began with.
          </Alert>
        )}
      </aside>
    </div>
  );
}
