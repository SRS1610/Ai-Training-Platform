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
  Textarea,
  cn,
  colorClasses,
  toast,
} from "@praxis/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, GraduationCap } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { api } from "@/lib/api";
import { problemsMessage } from "../hooks";
import { ak } from "../keys";
import { DIFFICULTIES } from "../meta";
import { NumberInput, SkillPicker, StringListEditor } from "../shared";
import type { Course } from "../types";

export function CreateCourseDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [title, setTitle] = React.useState("");
  const [category, setCategory] = React.useState("");
  const [difficulty, setDifficulty] = React.useState("beginner");
  const [description, setDescription] = React.useState("");
  const [objectives, setObjectives] = React.useState<string[]>([]);
  const [prereqs, setPrereqs] = React.useState<string[]>([]);
  const [audience, setAudience] = React.useState("");
  const [duration, setDuration] = React.useState<number | null>(60);
  const [skills, setSkills] = React.useState<string[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [touched, setTouched] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setTitle("");
      setCategory("");
      setDifficulty("beginner");
      setDescription("");
      setObjectives([]);
      setPrereqs([]);
      setAudience("");
      setDuration(60);
      setSkills([]);
      setError(null);
      setTouched(false);
    }
  }, [open]);

  const categories = useQuery({
    queryKey: ["catalog", "categories"],
    enabled: open,
    queryFn: ({ signal }) => api.get<{ category: string; count: number }[]>("/catalog/categories", { signal }),
    staleTime: 300_000,
  });

  const create = useMutation({
    mutationFn: () =>
      api.post<Course>("/courses", {
        title: title.trim(),
        category: category.trim() || null,
        difficulty,
        description,
        learning_objectives: objectives,
        prerequisites: prereqs,
        target_audience: audience.trim() || null,
        duration_minutes: duration ?? 0,
        skill_ids: skills,
      }),
    onSuccess: (c) => {
      toast.success(`“${c.title}” created as a draft`);
      qc.invalidateQueries({ queryKey: ak.courses.all });
      onOpenChange(false);
      router.push(`/app/instructor/courses/${c.id}`);
    },
    onError: (e) => setError(problemsMessage(e)),
  });

  const titleError = touched && !title.trim() ? "Give your course a title" : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <span className="mb-1 grid size-11 place-items-center rounded-2xl bg-brand-gradient text-white shadow-glow">
            <GraduationCap className="size-5" aria-hidden />
          </span>
          <DialogTitle>Create a course</DialogTitle>
          <DialogDescription>Start with the essentials — everything can be refined later in the builder.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (!title.trim()) return;
            setError(null);
            create.mutate();
          }}
        >
          <FormField label="Title" required error={titleError}>
            <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Incident response fundamentals" maxLength={255} />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Category">
              {(aria) => (
                <>
                  <Input {...aria} list="new-course-categories" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Security" />
                  <datalist id="new-course-categories">
                    {(categories.data ?? []).map((c) => (
                      <option key={c.category} value={c.category} />
                    ))}
                  </datalist>
                </>
              )}
            </FormField>
            <FormField label="Estimated duration">
              {(aria) => <NumberInput {...aria} value={duration} onChange={setDuration} min={0} suffix="min" />}
            </FormField>
          </div>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-slate-800">Difficulty</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Difficulty">
              {DIFFICULTIES.map((d) => {
                const on = difficulty === d.value;
                const c = colorClasses(d.color);
                return (
                  <button
                    key={d.value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setDifficulty(d.value)}
                    className={cn("rounded-xl border px-3 py-2 text-sm font-semibold transition-all focus-visible:focus-ring", on ? cn(c.soft, c.text, c.border, "shadow-sm") : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50")}
                  >
                    <span className="flex items-center justify-center gap-1" aria-hidden>
                      {Array.from({ length: 4 }, (_, i) => (
                        <span key={i} className={cn("h-1.5 w-3 rounded-full", i < d.level ? c.solid : "bg-slate-200")} />
                      ))}
                    </span>
                    <span className="mt-1 block">{d.label}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>
          <FormField label="Description" hint="Markdown supported.">
            <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What will learners get out of this course?" />
          </FormField>
          <FormField label="Learning objectives">
            {() => <StringListEditor label="objective" numbered value={objectives} onChange={setObjectives} placeholder="Learners will be able to…" color="emerald" />}
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Target audience">
              <Textarea rows={2} className="min-h-[72px]" value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="e.g. New support analysts" />
            </FormField>
            <FormField label="Prerequisites">
              {() => <StringListEditor label="prerequisite" value={prereqs} onChange={setPrereqs} placeholder="e.g. Basic networking" color="amber" />}
            </FormField>
          </div>
          <FormField label="Skills">
            {() => <SkillPicker value={skills} onChange={setSkills} />}
          </FormField>
          {error && <Alert tone="danger">{error}</Alert>}
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="gradient" rightIcon={<ArrowRight />} loading={create.isPending}>
              Create & open builder
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
