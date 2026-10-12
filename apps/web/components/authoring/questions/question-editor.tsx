"use client";

import {
  Alert,
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  FormField,
  SimpleSelect,
  Textarea,
  cn,
  colorClasses,
  toast,
} from "@praxis/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Save, Scale } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { problemsFrom, problemsMessage } from "../hooks";
import { ak } from "../keys";
import { MarkdownEditor } from "../markdown-editor";
import { AUTO_GRADED_TYPES, QUESTION_TYPES, type QuestionTypeKey } from "../meta";
import { DifficultyPicker, NumberInput, SkillPicker, TagInput, TypeChip } from "../shared";
import type { Page, Question, QuestionInput, QuestionType, Rubric } from "../types";
import { QuestionPreview } from "./question-preview";
import { QuestionTypeEditor, defaultsFor, questionProblems, type QState } from "./question-types";

const RUBRIC_TYPES = new Set(["long_answer", "file_upload", "scenario", "practical_task", "code"]);

function fromQuestion(q: Question | null | undefined, bankId: string | null): QuestionInput {
  if (!q) {
    const d = defaultsFor("multiple_choice");
    return {
      bank_id: bankId,
      question_type: "multiple_choice",
      prompt: "",
      options: d.options,
      answer_key: d.answer_key,
      explanation: "",
      points: 1,
      negative_points: 0,
      difficulty: 2,
      tags: [],
      skill_ids: [],
      rubric_id: null,
      status: "active",
    };
  }
  return {
    bank_id: q.bank_id,
    question_type: q.question_type as QuestionType,
    prompt: q.prompt,
    options: q.options ?? {},
    answer_key: q.answer_key ?? {},
    explanation: q.explanation ?? "",
    points: q.points,
    negative_points: q.negative_points,
    difficulty: q.difficulty,
    tags: (q.tags ?? []).map(String),
    skill_ids: (q.skill_ids ?? []).map(String),
    rubric_id: q.rubric_id,
    status: (q.status as QuestionInput["status"]) ?? "active",
  };
}

function RubricSelect({ value, onChange }: { value: string | null | undefined; onChange: (id: string | null) => void }) {
  const { can } = useAuth();
  const rubrics = useQuery({
    queryKey: ak.rubrics.list({ picker: true }),
    queryFn: ({ signal }) => api.get<Page<Rubric>>("/rubrics", { signal, query: { page_size: 100 } }),
    enabled: can("assignments.manage") || can("submissions.review"),
    staleTime: 60_000,
  });
  return (
    <FormField label="Grading rubric" hint={rubrics.isError ? "Rubrics couldn't be loaded." : "Used by assessors and AI-assisted grading."}>
      {(aria) => (
        <div className="flex flex-wrap items-center gap-2">
          <SimpleSelect
            {...aria}
            value={value ?? "none"}
            onValueChange={(v) => onChange(v === "none" ? null : v)}
            options={[{ value: "none", label: "No rubric" }, ...(rubrics.data?.items ?? []).map((r) => ({ value: r.id, label: r.title }))]}
            className="min-w-60 flex-1"
          />
          {can("assignments.manage") && (
            <Button asChild variant="ghost" size="sm" leftIcon={<Scale />}>
              <Link href="/app/instructor/rubrics" target="_blank">
                Manage rubrics
              </Link>
            </Button>
          )}
        </div>
      )}
    </FormField>
  );
}

/** Create / edit a question of any of the 14 types, with a live learner preview. */
export function QuestionEditorDialog({
  open,
  onOpenChange,
  bankId,
  question,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  bankId: string | null;
  question?: Question | null;
  onSaved?: (q: Question) => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = React.useState<QuestionInput>(() => fromQuestion(question, bankId));
  const [touched, setTouched] = React.useState(false);
  const [serverErrors, setServerErrors] = React.useState<string[]>([]);
  const [pendingType, setPendingType] = React.useState<QuestionType | null>(null);
  const [mobilePreview, setMobilePreview] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setForm(fromQuestion(question, bankId));
      setTouched(false);
      setServerErrors([]);
      setMobilePreview(false);
    }
  }, [open, question, bankId]);

  const s: QState = { options: form.options, answer_key: form.answer_key };
  const problems = [...(form.prompt.trim() ? [] : ["Write the question prompt"]), ...questionProblems(form.question_type, form.options, form.answer_key)];
  const dirty = JSON.stringify(form) !== JSON.stringify(fromQuestion(question, bankId));

  const save = useMutation({
    mutationFn: () => {
      const body = { ...form, explanation: form.explanation?.trim() || null };
      return question ? api.patch<Question>(`/questions/${question.id}`, body) : api.post<Question>("/questions", body);
    },
    onSuccess: (q) => {
      toast.success(question ? "Question updated" : "Question added");
      qc.invalidateQueries({ queryKey: ak.questions.all });
      qc.invalidateQueries({ queryKey: ak.banks.all });
      onSaved?.(q);
      onOpenChange(false);
    },
    onError: (e) => {
      const p = problemsFrom(e);
      setServerErrors(p.length ? p : [problemsMessage(e)]);
    },
  });

  const changeType = (t: QuestionType) => {
    const d = defaultsFor(t);
    setForm((f) => ({ ...f, question_type: t, options: d.options, answer_key: d.answer_key, rubric_id: RUBRIC_TYPES.has(t) ? f.rubric_id : null }));
    setPendingType(null);
  };

  const meta = QUESTION_TYPES[form.question_type as QuestionTypeKey];
  const c = colorClasses(meta.color);

  return (
    <Dialog open={open} onOpenChange={(o) => !save.isPending && onOpenChange(o)}>
      <DialogContent className="max-w-6xl gap-0 p-0" aria-describedby={undefined}>
        <div className={cn("h-1.5 rounded-t-3xl bg-gradient-to-r", c.gradient)} aria-hidden />
        <div className="grid lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-5 p-5 sm:p-6">
            <DialogHeader>
              <DialogTitle>{question ? "Edit question" : "New question"}</DialogTitle>
              <DialogDescription>
                {meta.label} · {AUTO_GRADED_TYPES.has(form.question_type) ? "auto-graded" : form.question_type === "code" ? "pattern-checked or reviewed" : form.question_type === "simulation" ? "scored from the simulation" : "graded by an assessor or AI with a rubric"}
              </DialogDescription>
            </DialogHeader>

            <fieldset>
              <legend className="mb-2 text-sm font-medium text-slate-800">Question type</legend>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 xl:grid-cols-7" role="radiogroup" aria-label="Question type">
                {(Object.keys(QUESTION_TYPES) as QuestionTypeKey[]).map((t) => {
                  const m = QUESTION_TYPES[t];
                  const on = form.question_type === t;
                  const mc = colorClasses(m.color);
                  return (
                    <button
                      key={t}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      title={m.description}
                      onClick={() => {
                        if (on) return;
                        if (dirty || question) setPendingType(t);
                        else changeType(t);
                      }}
                      className={cn(
                        "flex flex-col items-center gap-1 rounded-xl border px-1.5 py-2 text-center transition-all focus-visible:focus-ring",
                        on ? cn(mc.border, mc.soft, "shadow-sm ring-1", mc.ring) : "border-slate-200 bg-white hover:-translate-y-0.5 hover:border-slate-300",
                      )}
                    >
                      <TypeChip meta={m} size="xs" />
                      <span className={cn("text-[11px] font-semibold leading-tight", on ? mc.text : "text-slate-700")}>{m.label}</span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <FormField label="Prompt" required error={touched && !form.prompt.trim() ? "Write the question prompt" : null}>
              {(aria) => <MarkdownEditor {...aria} label="Prompt" value={form.prompt} onChange={(v) => setForm((f) => ({ ...f, prompt: v }))} minRows={3} compact placeholder="Ask a clear, single question…" />}
            </FormField>

            <div className={cn("rounded-2xl border bg-gradient-to-br p-4", c.border, c.tint)}>
              <p className={cn("mb-3 flex items-center gap-2 text-sm font-semibold", c.text)}>
                <TypeChip meta={meta} size="xs" /> {meta.label} answer setup
              </p>
              <QuestionTypeEditor type={form.question_type} s={s} onChange={(ns) => setForm((f) => ({ ...f, options: ns.options, answer_key: ns.answer_key }))} />
            </div>

            {RUBRIC_TYPES.has(form.question_type) && <RubricSelect value={form.rubric_id} onChange={(id) => setForm((f) => ({ ...f, rubric_id: id }))} />}

            <FormField label="Explanation" hint="Shown to learners after submission when feedback is enabled.">
              <Textarea rows={2} value={form.explanation ?? ""} onChange={(e) => setForm((f) => ({ ...f, explanation: e.target.value }))} />
            </FormField>

            <div className="grid gap-4 sm:grid-cols-3">
              <FormField label="Points">
                {(aria) => <NumberInput {...aria} value={form.points} min={0} max={1000} step={0.5} onChange={(v) => setForm((f) => ({ ...f, points: v ?? 0 }))} />}
              </FormField>
              <FormField label="Negative marking" hint="Deducted for a wrong answer when the assessment enables it.">
                {(aria) => <NumberInput {...aria} value={form.negative_points} min={0} max={1000} step={0.25} onChange={(v) => setForm((f) => ({ ...f, negative_points: v ?? 0 }))} suffix="pts" />}
              </FormField>
              <FormField label="Status">
                {(aria) => (
                  <SimpleSelect
                    {...aria}
                    value={form.status}
                    onValueChange={(v) => setForm((f) => ({ ...f, status: v as QuestionInput["status"] }))}
                    options={[
                      { value: "active", label: "Active — can be drawn" },
                      { value: "draft", label: "Draft" },
                      { value: "retired", label: "Retired" },
                    ]}
                  />
                )}
              </FormField>
            </div>
            <FormField label="Difficulty">
              {(aria) => <DifficultyPicker id={aria.id} value={form.difficulty} onChange={(v) => setForm((f) => ({ ...f, difficulty: v }))} />}
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Tags" hint="Used to filter random pools.">
                {(aria) => <TagInput id={aria.id} lowercase value={form.tags} onChange={(v) => setForm((f) => ({ ...f, tags: v }))} />}
              </FormField>
              <FormField label="Skills">{() => <SkillPicker value={form.skill_ids} onChange={(v) => setForm((f) => ({ ...f, skill_ids: v }))} />}</FormField>
            </div>

            {serverErrors.length > 0 && (
              <Alert tone="danger" title="The question couldn't be saved">
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {serverErrors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </Alert>
            )}
            {touched && problems.length > 0 && (
              <Alert tone="warning" title="Almost there">
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {problems.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </Alert>
            )}

            <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
              <Button variant="ghost" leftIcon={<Eye />} className="lg:hidden" onClick={() => setMobilePreview((v) => !v)}>
                {mobilePreview ? "Hide preview" : "Learner preview"}
              </Button>
              <Button variant="secondary" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                leftIcon={<Save />}
                loading={save.isPending}
                onClick={() => {
                  setTouched(true);
                  setServerErrors([]);
                  if (problems.length) return;
                  save.mutate();
                }}
              >
                {question ? "Save question" : "Add question"}
              </Button>
            </div>
          </div>
          <aside className={cn("border-t border-slate-100 bg-gradient-to-b from-slate-50 to-white p-5 lg:block lg:border-l lg:border-t-0", !mobilePreview && "hidden")} aria-label="Learner preview">
            <div className="lg:sticky lg:top-0">
              <p className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-violet-100 px-2.5 py-1 text-2xs font-bold uppercase tracking-wider text-violet-700">
                <Eye className="size-3.5" aria-hidden /> Learner preview
              </p>
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
                <QuestionPreview type={form.question_type} prompt={form.prompt} options={form.options} points={form.points} />
              </div>
              <p className="mt-3 text-2xs text-muted-foreground">Answer keys, model answers and rubric details are never sent to learners.</p>
            </div>
          </aside>
        </div>
        <ConfirmDialog
          open={!!pendingType}
          onOpenChange={(o) => !o && setPendingType(null)}
          title={`Switch to ${pendingType ? QUESTION_TYPES[pendingType as QuestionTypeKey].label : ""}?`}
          description="The answer setup is replaced with a starter for the new type. The prompt, explanation, points and tags are kept."
          confirmLabel="Switch type"
          onConfirm={() => {
            if (pendingType) changeType(pendingType);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
