"use client";

import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
  ProgressRing,
  Textarea,
  cn,
  toast,
} from "@praxis/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bot, CheckCircle2, ChevronDown, Gavel, MessageSquarePlus, Scale, Undo2 } from "lucide-react";
import * as React from "react";
import { ApiError, api, errorMessage } from "@/lib/api";
import { AIRecommendationCard } from "./ai-recommendation";
import { ListInput } from "./list-input";
import {
  criterionMax,
  gk,
  gradePct,
  partialTotal,
  weightedTotal,
  type BreakdownRow,
  type GradeOut,
  type GradingDetail,
  type RubricCriterion,
} from "./types";

const LEVEL_TONES = [
  "bg-rose-50 text-rose-800 ring-rose-200 data-[on=true]:bg-rose-600 data-[on=true]:text-white data-[on=true]:ring-rose-600",
  "bg-amber-50 text-amber-900 ring-amber-200 data-[on=true]:bg-amber-500 data-[on=true]:text-white data-[on=true]:ring-amber-500",
  "bg-sky-50 text-sky-800 ring-sky-200 data-[on=true]:bg-sky-600 data-[on=true]:text-white data-[on=true]:ring-sky-600",
  "bg-violet-50 text-violet-800 ring-violet-200 data-[on=true]:bg-violet-600 data-[on=true]:text-white data-[on=true]:ring-violet-600",
  "bg-emerald-50 text-emerald-800 ring-emerald-200 data-[on=true]:bg-emerald-600 data-[on=true]:text-white data-[on=true]:ring-emerald-600",
];

function toneForLevel(i: number, n: number) {
  if (n <= 1) return LEVEL_TONES[4]!;
  return LEVEL_TONES[Math.round((i / (n - 1)) * 4)]!;
}

interface FormState {
  scores: Record<string, number | null>;
  comments: Record<string, string>;
  score: number | null;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  improvements: string[];
  missing: string[];
  reason: string;
}

function initialState(criteria: RubricCriterion[], previous: GradeOut | null): FormState {
  const rows = ((previous?.rubric_breakdown ?? []) as BreakdownRow[]).reduce<Record<string, BreakdownRow>>((a, r) => ({ ...a, [r.criterion_id]: r }), {});
  return {
    scores: Object.fromEntries(criteria.map((c) => [c.id, rows[c.id]?.score ?? null])),
    comments: Object.fromEntries(criteria.map((c) => [c.id, rows[c.id]?.comment ?? ""])),
    score: previous && !criteria.length ? gradePct(previous) : null,
    summary: previous?.summary ?? "",
    strengths: (previous?.strengths ?? []) as string[],
    weaknesses: (previous?.weaknesses ?? []) as string[],
    improvements: (previous?.improvements ?? []) as string[],
    missing: (previous?.missing_requirements ?? []) as string[],
    reason: "",
  };
}

function CriterionRow({
  c,
  value,
  comment,
  ai,
  onScore,
  onComment,
  disabled,
}: {
  c: RubricCriterion;
  value: number | null;
  comment: string;
  ai?: BreakdownRow;
  onScore: (v: number | null) => void;
  onComment: (v: string) => void;
  disabled?: boolean;
}) {
  const max = criterionMax(c);
  const levels = [...(c.levels ?? [])].sort((a, b) => a.score - b.score);
  const [showComment, setShowComment] = React.useState(!!comment);
  const [showDesc, setShowDesc] = React.useState(false);
  const inputId = React.useId();
  return (
    <fieldset className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" disabled={disabled}>
      <legend className="sr-only">{c.name}</legend>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">{c.name}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge tone="brand" size="sm">
              <Scale aria-hidden /> Weight {c.weight}%
            </Badge>
            {ai && (
              <button
                type="button"
                onClick={() => onScore(ai.score)}
                className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-2xs font-semibold text-violet-700 ring-1 ring-inset ring-violet-200 transition-colors hover:bg-violet-100 focus-visible:focus-ring"
                title="Apply the AI's score for this criterion"
              >
                <Bot className="size-3" aria-hidden /> AI {ai.score}/{ai.max}
              </button>
            )}
            {c.description && (
              <button type="button" className="text-2xs font-medium text-slate-500 underline-offset-2 hover:underline" onClick={() => setShowDesc((s) => !s)} aria-expanded={showDesc}>
                {showDesc ? "Hide" : "Show"} guidance
              </button>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-baseline gap-1">
          <label htmlFor={inputId} className="sr-only">
            Score for {c.name} (0 to {max})
          </label>
          <Input
            id={inputId}
            type="number"
            inputMode="decimal"
            min={0}
            max={max}
            step={0.5}
            value={value ?? ""}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === "") return onScore(null);
              const n = Math.min(max, Math.max(0, Number(raw)));
              onScore(Number.isNaN(n) ? null : n);
            }}
            inputSize="sm"
            className="w-20 text-right font-semibold tabular-nums"
          />
          <span className="text-sm text-slate-500">/{max}</span>
        </div>
      </div>
      {showDesc && c.description && <p className="mt-2 rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">{c.description}</p>}
      {levels.length > 0 && (
        <div className="mt-3 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.min(levels.length, 5)}, minmax(0, 1fr))` }} role="group" aria-label={`${c.name} levels`}>
          {levels.map((l, i) => {
            const on = value !== null && Math.abs(value - l.score) < 1e-9;
            return (
              <button
                key={`${l.label}-${l.score}`}
                type="button"
                data-on={on}
                aria-pressed={on}
                title={l.description ?? undefined}
                onClick={() => onScore(on ? null : l.score)}
                className={cn("flex min-h-[52px] flex-col items-center justify-center rounded-xl px-1.5 py-2 text-center ring-1 ring-inset transition-all hover:-translate-y-px focus-visible:focus-ring", toneForLevel(i, levels.length))}
              >
                <span className="line-clamp-2 text-2xs font-semibold leading-tight">{l.label}</span>
                <span className="mt-0.5 text-xs font-bold tabular-nums">{l.score}</span>
              </button>
            );
          })}
        </div>
      )}
      {showComment ? (
        <Textarea
          className="mt-3 min-h-[64px] text-sm"
          rows={2}
          value={comment}
          onChange={(e) => onComment(e.target.value)}
          placeholder={`Feedback on ${c.name.toLowerCase()}…`}
          aria-label={`Comment for ${c.name}`}
        />
      ) : (
        <Button variant="link" size="xs" className="mt-2" leftIcon={<MessageSquarePlus />} onClick={() => setShowComment(true)}>
          Add comment
        </Button>
      )}
    </fieldset>
  );
}

export function GradeForm({ detail, onGraded }: { detail: GradingDetail; onGraded?: () => void }) {
  const qc = useQueryClient();
  const sub = detail.submission;
  const assignment = detail.assignment;
  const criteria = React.useMemo(() => (((assignment.rubric?.criteria ?? []) as RubricCriterion[]) ?? []).filter((c) => c && c.id), [assignment.rubric]);
  const ai = detail.ai_recommendation ?? null;
  const aiRows = React.useMemo(
    () => ((ai?.rubric_breakdown ?? []) as BreakdownRow[]).reduce<Record<string, BreakdownRow>>((a, r) => ({ ...a, [r.criterion_id]: r }), {}),
    [ai],
  );
  const previousFinal = React.useMemo(() => detail.grades.find((g) => g.is_final && g.target_type === "submission") ?? null, [detail.grades]);
  const previousHuman = previousFinal && previousFinal.source === "human" ? previousFinal : null;

  const [form, setForm] = React.useState<FormState>(() => initialState(criteria, previousHuman));
  const [accepted, setAccepted] = React.useState(false);
  const [reasonError, setReasonError] = React.useState<string | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [returnOpen, setReturnOpen] = React.useState(false);
  const [returnText, setReturnText] = React.useState("");
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  // Reset only when the rubric or the final human grade actually changes (not on background refetches).
  const resetKey = `${assignment.rubric?.id ?? "none"}:${assignment.rubric?.updated_at ?? ""}:${previousHuman?.id ?? "none"}`;
  React.useEffect(() => {
    setForm(initialState(criteria, previousHuman));
    setAccepted(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  const patch = (p: Partial<FormState>) => {
    setForm((f) => ({ ...f, ...p }));
    setAccepted(false);
    setFormError(null);
  };

  const total = criteria.length ? weightedTotal(criteria, form.scores) : form.score;
  const partial = criteria.length ? partialTotal(criteria, form.scores) : (form.score ?? 0);
  const scoredCount = criteria.filter((c) => form.scores[c.id] !== null && form.scores[c.id] !== undefined).length;
  const aiPct = ai ? gradePct(ai) : null;
  const prevPct = previousHuman ? gradePct(previousHuman) : null;
  const differsFromAi = total !== null && aiPct !== null && Math.abs(total - aiPct) > 0.004;
  const differsFromPrev = total !== null && prevPct !== null && Math.abs(total - prevPct) > 0.004;
  const needsReason = differsFromAi || differsFromPrev;
  const passing = Number(assignment.passing_score ?? 70);
  const gradable = ["submitted", "ai_grading", "ai_graded", "under_review", "graded"].includes(sub.status);

  const acceptAi = () => {
    if (!ai) return;
    setForm((f) => ({
      ...f,
      scores: criteria.length ? Object.fromEntries(criteria.map((c) => [c.id, aiRows[c.id]?.score ?? f.scores[c.id] ?? null])) : f.scores,
      comments: criteria.length ? Object.fromEntries(criteria.map((c) => [c.id, aiRows[c.id]?.comment || f.comments[c.id] || ""])) : f.comments,
      score: criteria.length ? f.score : gradePct(ai),
      summary: ai.summary ?? f.summary,
      strengths: (ai.strengths ?? []) as string[],
      weaknesses: (ai.weaknesses ?? []) as string[],
      improvements: (ai.improvements ?? []) as string[],
      missing: (ai.missing_requirements ?? []) as string[],
    }));
    setAccepted(true);
    setReasonError(null);
    toast.success("AI recommendation applied — review it before submitting");
  };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: gk.detail(sub.id) });
    qc.invalidateQueries({ queryKey: gk.all });
  };

  const grade = useMutation({
    mutationFn: () =>
      api.post<GradeOut>(`/grading/submissions/${sub.id}/grade`, {
        rubric_scores: criteria.map((c) => ({ criterion_id: c.id, score: form.scores[c.id], comment: form.comments[c.id]?.trim() || null })),
        score: criteria.length ? null : form.score,
        summary: form.summary.trim() || null,
        strengths: form.strengths,
        weaknesses: form.weaknesses,
        improvements: form.improvements,
        missing_requirements: form.missing,
        override_reason: form.reason.trim() || null,
      }),
    onSuccess: (g) => {
      toast.success(`Grade submitted: ${Math.round(gradePct(g))}% · ${g.passed ? "passed" : "not passed"}`);
      invalidate();
      onGraded?.();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === "override_reason_required") {
        setReasonError("Explain why your score differs from the existing grade — it's recorded in the audit trail.");
        return;
      }
      if (e instanceof ApiError && e.code === "invalid_rubric_scores") {
        const errs = (e.details as { errors?: string[] } | undefined)?.errors;
        setFormError(errs?.join(" · ") ?? e.message);
        return;
      }
      setFormError(errorMessage(e));
    },
  });

  const returnMut = useMutation({
    mutationFn: () => api.post(`/grading/submissions/${sub.id}/return-for-resubmission`, { feedback: returnText.trim() }),
    onSuccess: () => {
      toast.success("Returned to the learner for resubmission");
      setReturnOpen(false);
      setReturnText("");
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const submit = () => {
    setFormError(null);
    if (total === null) {
      setFormError(criteria.length ? `Score every criterion (${scoredCount}/${criteria.length} done).` : "Enter a score.");
      return;
    }
    if (needsReason && !form.reason.trim()) {
      setReasonError("An override reason is required when your score differs from the AI recommendation or the previous grade.");
      document.getElementById("override-reason")?.focus();
      return;
    }
    setConfirmOpen(true);
  };

  const shown = total ?? partial;
  const passes = shown >= passing;

  return (
    <div className="space-y-4">
      {ai && <AIRecommendationCard grade={ai} passingScore={passing} onAccept={gradable ? acceptAi : undefined} accepted={accepted} />}

      <Card className="overflow-hidden">
        <div className="flex items-center gap-4 border-b border-slate-100 bg-gradient-to-br from-brand-50/70 via-white to-white p-5">
          <ProgressRing
            value={shown}
            size={76}
            stroke={8}
            color={passes ? "emerald" : "rose"}
            aria-label="Your weighted score"
            label={<span className="font-display text-lg font-bold tabular-nums text-slate-900">{shown.toFixed(shown % 1 ? 1 : 0)}</span>}
            sublabel={<span className="text-2xs">%</span>}
          />
          <div className="min-w-0 flex-1" aria-live="polite">
            <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-brand-700">
              <Gavel className="size-3.5" aria-hidden /> Your grade
            </p>
            <p className="mt-0.5 text-sm text-slate-700">
              {criteria.length ? (
                <>
                  {scoredCount}/{criteria.length} criteria scored · weighted total {total === null ? "(partial)" : ""}
                </>
              ) : (
                "No rubric — enter an overall percentage"
              )}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <Badge tone={passes ? "success" : "danger"} size="sm">
                {passes ? "Pass" : "Below pass mark"} ({passing}%)
              </Badge>
              {aiPct !== null && total !== null && (
                <Badge tone={differsFromAi ? "warning" : "violet"} size="sm">
                  {differsFromAi ? `${total - aiPct > 0 ? "+" : ""}${(total - aiPct).toFixed(1)} vs AI` : "Matches AI"}
                </Badge>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-3 p-4 sm:p-5">
          {!gradable && (
            <Alert tone="warning" title="Not gradable right now">
              This submission is {sub.status.replace(/_/g, " ")}. Only submitted work can be graded.
            </Alert>
          )}
          {criteria.length ? (
            criteria.map((c) => (
              <CriterionRow
                key={c.id}
                c={c}
                value={form.scores[c.id] ?? null}
                comment={form.comments[c.id] ?? ""}
                ai={aiRows[c.id]}
                disabled={!gradable}
                onScore={(v) => patch({ scores: { ...form.scores, [c.id]: v } })}
                onComment={(v) => patch({ comments: { ...form.comments, [c.id]: v } })}
              />
            ))
          ) : (
            <FormField label="Overall score (%)" hint="This assignment has no rubric." required>
              <Input
                type="number"
                min={0}
                max={100}
                step={0.5}
                value={form.score ?? ""}
                disabled={!gradable}
                onChange={(e) => patch({ score: e.target.value === "" ? null : Math.min(100, Math.max(0, Number(e.target.value))) })}
              />
            </FormField>
          )}
        </div>

        <details className="group border-t border-slate-100" open>
          <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3.5 text-sm font-semibold text-slate-900 hover:bg-slate-50 focus-visible:focus-ring">
            Feedback to the learner
            <ChevronDown className="size-4 text-slate-500 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <div className="space-y-4 px-5 pb-5">
            <FormField label="Summary" hint="Shown to the learner with their grade.">
              <Textarea rows={3} value={form.summary} onChange={(e) => patch({ summary: e.target.value })} placeholder="Overall feedback…" disabled={!gradable} />
            </FormField>
            <div className="grid gap-4">
              <FormField label="Strengths">
                {(aria) => <ListInput {...aria} aria-label="Strengths" value={form.strengths} onChange={(v) => patch({ strengths: v })} placeholder="What went well" />}
              </FormField>
              <FormField label="Weaknesses">
                {(aria) => <ListInput {...aria} aria-label="Weaknesses" value={form.weaknesses} onChange={(v) => patch({ weaknesses: v })} placeholder="What fell short" />}
              </FormField>
              <FormField label="Improvements">
                {(aria) => <ListInput {...aria} aria-label="Improvements" value={form.improvements} onChange={(v) => patch({ improvements: v })} placeholder="Concrete next steps" />}
              </FormField>
              <FormField label="Missing requirements">
                {(aria) => <ListInput {...aria} aria-label="Missing requirements" value={form.missing} onChange={(v) => patch({ missing: v })} placeholder="Required evidence that's absent" />}
              </FormField>
            </div>
          </div>
        </details>

        {needsReason && (
          <div className="border-t border-amber-200 bg-amber-50/70 p-5">
            <FormField
              label="Override reason"
              htmlFor="override-reason"
              required
              error={reasonError}
              hint={`Your score differs from ${differsFromAi ? `the AI recommendation (${aiPct}%)` : `the previous grade (${prevPct}%)`}. The reason is stored with the grade and the audit log.`}
            >
              <Textarea
                id="override-reason"
                rows={3}
                value={form.reason}
                onChange={(e) => {
                  patch({ reason: e.target.value });
                  setReasonError(null);
                }}
                placeholder="e.g. The AI missed that the fix was validated in the screenshot evidence…"
              />
            </FormField>
          </div>
        )}

        {formError && (
          <div className="px-5 pb-1 pt-4">
            <Alert tone="danger">{formError}</Alert>
          </div>
        )}

        <div className="sticky bottom-0 flex flex-col gap-2 border-t border-slate-100 bg-white/95 p-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
          <Button variant="destructive-soft" leftIcon={<Undo2 />} onClick={() => setReturnOpen(true)} disabled={!gradable}>
            Return for resubmission
          </Button>
          <Button variant="gradient" leftIcon={<CheckCircle2 />} onClick={submit} loading={grade.isPending} disabled={!gradable}>
            Submit grade
          </Button>
        </div>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Submit a final grade of ${total?.toFixed(1)}%?`}
        description={
          needsReason
            ? "This overrides the existing recommendation. The learner will be notified and your reason is recorded."
            : "The learner will be notified and the grade becomes final."
        }
        confirmLabel="Submit grade"
        onConfirm={async () => {
          await grade.mutateAsync().catch(() => undefined);
        }}
      />

      <Dialog open={returnOpen} onOpenChange={setReturnOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Return for resubmission</DialogTitle>
            <DialogDescription>The learner can revise and submit a new version. Tell them what to change.</DialogDescription>
          </DialogHeader>
          <FormField label="Feedback for the learner" required>
            <Textarea rows={5} value={returnText} onChange={(e) => setReturnText(e.target.value)} placeholder="Please add evidence that you validated the fix, e.g. a screenshot of nslookup…" />
          </FormField>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setReturnOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" loading={returnMut.isPending} disabled={!returnText.trim()} onClick={() => returnMut.mutate()} leftIcon={<Undo2 />}>
              Return to learner
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
