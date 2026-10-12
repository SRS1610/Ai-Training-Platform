"use client";

import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
  cn,
  toast,
} from "@praxis/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, RefreshCw, ShieldCheck, Sparkles, XCircle } from "lucide-react";
import * as React from "react";
import { api, errorMessage } from "@/lib/api";
import { ak } from "../keys";
import { GENERATABLE_QUESTION_TYPES, questionMeta } from "../meta";
import type { ApplyOut, Generation, GenQuiz } from "../types";
import { GenerationError, GenerationProgress, OfflineNotice, useGeneration } from "./generation-progress";
import { OutputView } from "./output-views";

export type QuickKind = "quiz" | "flashcards" | "revision_notes";

const LABEL: Record<QuickKind, { title: string; noun: string; description: string }> = {
  quiz: { title: "Generate a quiz", noun: "quiz", description: "Questions grounded in this lesson's content. The quiz is added as a draft quiz lesson." },
  flashcards: { title: "Generate flashcards", noun: "flashcard deck", description: "Key terms and ideas from this lesson as a flashcards lesson." },
  revision_notes: { title: "Generate revision notes", noun: "revision notes", description: "A concise summary lesson for revision." },
};

/** Small in-builder generator: lesson → quiz / flashcards / revision notes, with review before anything is added. */
export function QuickGenerateDialog({
  open,
  onOpenChange,
  kind,
  courseId,
  moduleId,
  lesson,
  onApplied,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  kind: QuickKind;
  courseId: string;
  moduleId: string;
  lesson: { id: string; title: string; position: number };
  onApplied?: () => void;
}) {
  const qc = useQueryClient();
  const meta = LABEL[kind];
  const [subject, setSubject] = React.useState(lesson.title);
  const [count, setCount] = React.useState(5);
  const [types, setTypes] = React.useState<string[]>(["multiple_choice", "true_false"]);
  const [genId, setGenId] = React.useState<string | null>(null);
  const gen = useGeneration(genId);
  const g = gen.data;

  const start = useMutation({
    mutationFn: () =>
      api.post<Generation>("/ai/generations", {
        kind,
        course_id: courseId,
        input: {
          subject: subject.trim() || lesson.title,
          course_id: courseId,
          lesson_id: lesson.id,
          module_id: moduleId,
          question_count: count,
          question_types: types.length ? types : ["multiple_choice"],
        },
      }),
    onSuccess: (out) => {
      qc.setQueryData(ak.generations.detail(out.id), out);
      setGenId(out.id);
    },
  });

  const apply = useMutation({
    mutationFn: async () => {
      if (!g) throw new Error("Nothing to apply");
      if (g.status === "completed") await api.post(`/ai/generations/${g.id}/approve`, { notes: "Approved in course builder" });
      const res = await api.post<ApplyOut>(`/ai/generations/${g.id}/apply`, { course_id: courseId, module_id: moduleId });
      if (kind === "quiz") {
        const quiz = (g.edited_output ?? g.output) as unknown as GenQuiz;
        await api.post(`/courses/${courseId}/modules/${moduleId}/lessons`, {
          title: quiz?.title?.slice(0, 255) || `Quiz: ${lesson.title}`,
          lesson_type: "quiz",
          assessment_id: res.entity_id,
          content: {},
          duration_minutes: Math.max(5, (quiz?.questions?.length ?? 5) * 2),
        });
      }
      return res;
    },
    onSuccess: (res) => {
      const n = Object.entries(res.created)
        .map(([k, v]) => `${v} ${k}`)
        .join(", ");
      toast.success(`Added to the course draft${n ? ` (${n})` : ""}`);
      qc.invalidateQueries({ queryKey: ak.generations.all });
      onApplied?.();
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const discard = useMutation({
    mutationFn: () => api.post(`/ai/generations/${g!.id}/reject`, { notes: "Discarded in course builder" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ak.generations.all });
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const regenerate = useMutation({
    mutationFn: () => api.post<Generation>(`/ai/generations/${g!.id}/regenerate`, { feedback: "Try a different set, keep it grounded in the lesson." }),
    onSuccess: (out) => {
      qc.setQueryData(ak.generations.detail(out.id), out);
      setGenId(out.id);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const output = g?.edited_output ?? g?.output;
  const running = g && (g.status === "pending" || g.status === "running");

  return (
    <Dialog open={open} onOpenChange={(o) => !apply.isPending && onOpenChange(o)}>
      <DialogContent size={g && output ? "xl" : "lg"}>
        <DialogHeader>
          <span className="mb-1 grid size-11 place-items-center rounded-2xl bg-brand-gradient text-white shadow-glow">
            <Sparkles className="size-5" aria-hidden />
          </span>
          <DialogTitle>{meta.title}</DialogTitle>
          <DialogDescription>{meta.description}</DialogDescription>
        </DialogHeader>

        {!genId && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              start.mutate();
            }}
          >
            <FormField label="Topic" hint="Defaults to the lesson title; the lesson's text grounds the generation.">
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={300} />
            </FormField>
            {kind === "quiz" && (
              <>
                <FormField label={`Number of questions: ${count}`}>
                  {(aria) => <input {...aria} type="range" min={2} max={15} value={count} onChange={(e) => setCount(Number(e.target.value))} className="w-full accent-brand-600" />}
                </FormField>
                <fieldset>
                  <legend className="mb-2 text-sm font-medium text-slate-800">Question types</legend>
                  <div className="flex flex-wrap gap-1.5">
                    {GENERATABLE_QUESTION_TYPES.map((t) => {
                      const m = questionMeta(t);
                      const on = types.includes(t);
                      return (
                        <button
                          key={t}
                          type="button"
                          aria-pressed={on}
                          onClick={() => setTypes((x) => (on ? x.filter((y) => y !== t) : [...x, t]))}
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset transition-colors focus-visible:focus-ring",
                            on ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50",
                          )}
                        >
                          <m.icon className="size-3.5" aria-hidden />
                          {m.label}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              </>
            )}
            {start.isError && <GenerationError error={start.error} onRetry={() => start.mutate()} />}
            <Alert tone="brand" icon={<ShieldCheck aria-hidden />}>
              You&apos;ll review the result first. Nothing is added to the course until you approve it, and nothing is ever published automatically.
            </Alert>
            <DialogFooter>
              <Button variant="secondary" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="gradient" leftIcon={<Sparkles />} loading={start.isPending}>
                Generate
              </Button>
            </DialogFooter>
          </form>
        )}

        {genId && gen.isLoading && <div className="h-40 animate-pulse rounded-3xl bg-slate-100" />}
        {g && running && <GenerationProgress gen={g} compact />}
        {g && g.status === "failed" && (
          <Alert tone="danger" icon={<XCircle aria-hidden />} title="Generation failed" action={<Button size="sm" variant="secondary" leftIcon={<RefreshCw />} loading={regenerate.isPending} onClick={() => regenerate.mutate()}>Retry</Button>}>
            {g.error ?? "The AI provider returned an error."}
          </Alert>
        )}
        {g && output && !running && g.status !== "failed" && (
          <div className="space-y-4">
            {g.offline && <OfflineNotice />}
            <div className="max-h-[55vh] overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50/50 p-4 scrollbar-thin">
              <p className="mb-3 font-display text-lg font-semibold text-slate-900">{String(output.title ?? meta.noun)}</p>
              <OutputView kind={kind} output={output} />
            </div>
            {g.status === "applied" ? (
              <Alert tone="success" icon={<CheckCircle2 aria-hidden />}>
                Already added to the course.
              </Alert>
            ) : g.status === "rejected" ? (
              <Alert tone="warning">This version was discarded.</Alert>
            ) : null}
            <DialogFooter>
              <Button variant="ghost" onClick={() => discard.mutate()} loading={discard.isPending} disabled={!["completed", "approved"].includes(g.status)}>
                Discard
              </Button>
              <Button variant="secondary" leftIcon={<RefreshCw />} onClick={() => regenerate.mutate()} loading={regenerate.isPending}>
                Regenerate
              </Button>
              <Button variant="gradient" leftIcon={<CheckCircle2 />} onClick={() => apply.mutate()} loading={apply.isPending} disabled={!["completed", "approved"].includes(g.status)}>
                Approve &amp; add to course
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
