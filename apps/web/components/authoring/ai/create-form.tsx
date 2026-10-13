"use client";

import { Button, Card, FormField, Input, SimpleSelect, cn, colorClasses, type CategoryColor } from "@praxis/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, useReducedMotion } from "framer-motion";
import {
  BookOpen,
  Brain,
  ClipboardCheck,
  FileQuestion,
  Layers,
  Library,
  Lightbulb,
  type LucideIcon,
  MonitorPlay,
  NotebookText,
  Scale,
  ShieldCheck,
  Sparkles,
  Wand2,
} from "lucide-react";
import * as React from "react";
import { api } from "@/lib/api";
import { Can } from "@/lib/auth";
import { useDebounced } from "../hooks";
import { ak } from "../keys";
import { DIFFICULTIES, GENERATABLE_QUESTION_TYPES, questionMeta } from "../meta";
import { NumberInput, StringListEditor } from "../shared";
import type { Generation, GenerationKind, Structure } from "../types";
import { useCourseOptions } from "../use-options";
import { GenerationError } from "./generation-progress";
import { EXAMPLE_PROMPTS, parseRequest } from "./parse";
import { rovingRadio } from "../roving";

const KINDS: { value: GenerationKind; label: string; description: string; icon: LucideIcon; color: CategoryColor }[] = [
  { value: "course", label: "Full course", description: "Modules, lessons, quizzes, assignment, final exam, flashcards & notes", icon: BookOpen, color: "fuchsia" },
  { value: "quiz", label: "Quiz", description: "A question set for an assessment", icon: FileQuestion, color: "sky" },
  { value: "assignment", label: "Assignment", description: "Practical task with rubric", icon: ClipboardCheck, color: "amber" },
  { value: "rubric", label: "Rubric", description: "Weighted criteria & levels", icon: Scale, color: "emerald" },
  { value: "scenario", label: "Simulation scenario", description: "Characters, phases & root cause", icon: MonitorPlay, color: "violet" },
  { value: "flashcards", label: "Flashcards", description: "A spaced-repetition deck, ideally from a lesson", icon: Layers, color: "orange" },
  { value: "revision_notes", label: "Revision notes", description: "Summary, key points & glossary", icon: NotebookText, color: "teal" },
];

/** Kinds that can be grounded in an existing course / lesson (its content becomes source material). */
const GROUNDABLE = new Set<GenerationKind>(["quiz", "assignment", "rubric", "scenario", "flashcards", "revision_notes"]);

const FORMATS = [
  { value: "self-paced", label: "Self-paced" },
  { value: "instructor-led", label: "Instructor-led" },
  { value: "blended", label: "Blended" },
  { value: "microlearning", label: "Microlearning" },
];

type Fields = {
  subject: string;
  audience: string;
  difficulty: string;
  weeks: number | null;
  duration: string;
  industry: string;
  format: string;
  objectives: string[];
  question_types: string[];
  question_count: number;
};

const EMPTY: Fields = {
  subject: "",
  audience: "",
  difficulty: "beginner",
  weeks: null,
  duration: "",
  industry: "",
  format: "self-paced",
  objectives: [],
  question_types: ["multiple_choice", "multiple_select", "true_false", "short_answer"],
  question_count: 8,
};

/** Prompt-first generation form: natural language request + structured fields it pre-fills. */
export function CreateGenerationForm({ onCreated }: { onCreated: (g: Generation) => void }) {
  const qc = useQueryClient();
  const reduce = useReducedMotion();
  const [prompt, setPrompt] = React.useState("");
  const [kind, setKind] = React.useState<GenerationKind>("course");
  const [f, setF] = React.useState<Fields>(EMPTY);
  const touched = React.useRef<Set<keyof Fields>>(new Set());
  const debounced = useDebounced(prompt, 350);
  const parsed = React.useMemo(() => parseRequest(debounced), [debounced]);

  // Auto-fill structured fields from the natural-language request (unless the author edited them).
  React.useEffect(() => {
    setF((cur) => {
      const next = { ...cur };
      const assign = <K extends keyof Fields>(k: K, v: Fields[K] | undefined) => {
        if (v !== undefined && !touched.current.has(k)) next[k] = v;
      };
      assign("subject", parsed.subject ?? (debounced.trim() ? undefined : ""));
      assign("audience", parsed.audience);
      assign("difficulty", parsed.difficulty);
      assign("weeks", parsed.weeks ?? null);
      assign("duration", parsed.duration);
      assign("industry", parsed.industry);
      assign("format", parsed.format);
      return next;
    });
  }, [parsed, debounced]);

  const courses = useCourseOptions(GROUNDABLE.has(kind));
  const [groundCourse, setGroundCourse] = React.useState("none");
  const [groundLesson, setGroundLesson] = React.useState("none");
  const structure = useQuery({
    queryKey: ak.courses.structure(groundCourse),
    enabled: GROUNDABLE.has(kind) && groundCourse !== "none",
    queryFn: ({ signal }) => api.get<Structure>(`/courses/${groundCourse}/structure`, { signal }),
  });
  const lessons = (structure.data?.modules ?? []).flatMap((m, mi) => m.lessons.map((l) => ({ ...l, moduleTitle: `${mi + 1}. ${m.title}` })));
  const lesson = lessons.find((l) => l.id === groundLesson);
  const grounded = GROUNDABLE.has(kind) && groundCourse !== "none";

  const set = <K extends keyof Fields>(k: K, v: Fields[K]) => {
    touched.current.add(k);
    setF((cur) => ({ ...cur, [k]: v }));
  };

  const start = useMutation({
    mutationFn: () =>
      api.post<Generation>("/ai/generations", {
        kind,
        input: {
          subject: f.subject.trim(),
          audience: f.audience.trim() || "professionals",
          difficulty: f.difficulty,
          objectives: f.objectives,
          duration: f.duration.trim() || null,
          industry: f.industry.trim() || null,
          format: f.format || null,
          weeks: kind === "course" ? f.weeks : null,
          question_count: f.question_count,
          question_types: f.question_types.length ? f.question_types : ["multiple_choice"],
          ...(grounded ? { course_id: groundCourse } : {}),
          ...(grounded && lesson ? { lesson_id: lesson.id, module_id: lesson.module_id } : {}),
        },
        course_id: grounded ? groundCourse : null,
      }),
    onSuccess: (g) => {
      qc.setQueryData(ak.generations.detail(g.id), g);
      qc.invalidateQueries({ queryKey: ak.generations.all });
      onCreated(g);
    },
  });

  const subjectError = f.subject.trim().length > 0 && f.subject.trim().length < 2 ? "Subject is too short" : null;
  const canSubmit = f.subject.trim().length >= 2;
  const understood = [
    parsed.subject && { k: "Topic", v: parsed.subject, c: "fuchsia" as const },
    parsed.audience && { k: "Audience", v: parsed.audience, c: "sky" as const },
    parsed.weeks && { k: "Length", v: `${parsed.weeks} weeks`, c: "emerald" as const },
    parsed.difficulty && { k: "Level", v: parsed.difficulty, c: "violet" as const },
    parsed.industry && { k: "Industry", v: parsed.industry, c: "amber" as const },
    parsed.format && { k: "Format", v: parsed.format, c: "teal" as const },
  ].filter(Boolean) as { k: string; v: string; c: CategoryColor }[];

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) start.mutate();
      }}
    >
      <section aria-labelledby="ai-prompt" className="relative overflow-hidden rounded-3xl bg-brand-gradient p-6 text-white shadow-glow sm:p-8">
        <div className="pointer-events-none absolute inset-0 bg-grid-faint opacity-20 [background-size:28px_28px]" aria-hidden />
        <div className="pointer-events-none absolute -right-16 -top-24 size-80 rounded-full bg-fuchsia-300/40 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-28 left-1/4 size-72 rounded-full bg-sky-300/30 blur-3xl" aria-hidden />
        <div className="relative">
          <p className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold ring-1 ring-white/25">
            <Sparkles className="size-3.5" aria-hidden /> AI course builder
          </p>
          <h2 id="ai-prompt" className="mt-3 font-display text-2xl font-bold tracking-tight sm:text-3xl">
            What do you want your people to be able to do?
          </h2>
          <p className="mt-1 max-w-2xl text-indigo-100">Describe it in plain words. Praxis drafts the structure, lessons, assessments and rubric — you review every piece before anything goes live.</p>
          <label htmlFor="ai-request" className="sr-only">
            Describe the course
          </label>
          <textarea
            id="ai-request"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            maxLength={1000}
            placeholder="e.g. Create a 4-week cybersecurity incident response course for junior SOC analysts"
            className="mt-5 w-full resize-none rounded-2xl border-0 bg-white px-5 py-4 text-base text-slate-900 shadow-lift outline-none ring-4 ring-white/20 placeholder:text-slate-400 focus-visible:ring-white/60"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            {EXAMPLE_PROMPTS.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => {
                  touched.current.clear();
                  setPrompt(ex);
                }}
                className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-left text-xs font-medium text-white ring-1 ring-white/25 transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                <Lightbulb className="size-3.5 shrink-0" aria-hidden />
                <span className="line-clamp-1">{ex}</span>
              </button>
            ))}
          </div>
          {understood.length > 0 && (
            <motion.div initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl bg-white/10 p-3 ring-1 ring-white/20" aria-live="polite">
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-50">
                <Brain className="size-4" aria-hidden /> We understood:
              </span>
              {understood.map((u) => {
                const c = colorClasses(u.c);
                return (
                  <span key={u.k} className={cn("rounded-full bg-white px-2.5 py-1 text-xs font-semibold shadow-sm", c.text)}>
                    <span className="font-medium text-slate-500">{u.k}:</span> <span className="capitalize">{u.v}</span>
                  </span>
                );
              })}
            </motion.div>
          )}
        </div>
      </section>

      <fieldset>
        <legend className="mb-3 font-display text-lg font-semibold text-slate-900">What should we generate?</legend>
        <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4" role="radiogroup" {...rovingRadio} aria-label="Generation type">
          {KINDS.map((k) => {
            const on = kind === k.value;
            const c = colorClasses(k.color);
            return (
              <button
                key={k.value}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setKind(k.value)}
                className={cn(
                  "flex items-center gap-3 rounded-2xl border bg-white p-3 text-left shadow-sm transition-all focus-visible:focus-ring sm:items-start sm:p-4",
                  k.value === "course" && "col-span-2",
                  on ? cn(c.border, "bg-gradient-to-br ring-2", c.tint, c.ring) : "border-slate-200 hover:-translate-y-0.5 hover:shadow-lift",
                )}
              >
                <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-white shadow-sm sm:size-10", c.gradient)}>
                  <k.icon className="size-5" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className={cn("block text-sm font-semibold leading-tight sm:text-base", on ? c.text : "text-slate-900")}>{k.label}</span>
                  <span className={cn("text-xs leading-snug text-muted-foreground", k.value === "course" ? "block" : "hidden sm:block")}>{k.description}</span>
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>

      {GROUNDABLE.has(kind) && (
        <Card className="overflow-hidden p-0">
          <div className="flex flex-col gap-4 bg-gradient-to-br from-teal-50 via-white to-sky-50 p-5 sm:p-6 lg:flex-row lg:items-end">
            <div className="flex min-w-0 items-start gap-3 lg:w-80 lg:shrink-0">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-teal-400 to-sky-500 text-white shadow-sm" aria-hidden>
                <Library className="size-5" />
              </span>
              <div>
                <h3 className="font-display text-base font-semibold text-slate-900">Ground it in your content</h3>
                <p className="text-xs text-muted-foreground">Optional — the lesson (or course) text and approved knowledge become the AI&apos;s source material.</p>
              </div>
            </div>
            <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
              <FormField label="Course">
                {(aria) => (
                  <SimpleSelect
                    {...aria}
                    value={groundCourse}
                    onValueChange={(v) => {
                      setGroundCourse(v);
                      setGroundLesson("none");
                    }}
                    options={[{ value: "none", label: "No course — use the brief only" }, ...courses.options]}
                  />
                )}
              </FormField>
              <FormField label="Lesson" hint={groundCourse === "none" ? "Pick a course first." : lesson ? `In ${lesson.moduleTitle}` : "Whole course if none is chosen."}>
                {(aria) => (
                  <SimpleSelect
                    {...aria}
                    value={groundLesson}
                    onValueChange={setGroundLesson}
                    disabled={groundCourse === "none" || structure.isLoading}
                    options={[{ value: "none", label: "Any lesson (whole course)" }, ...lessons.map((l) => ({ value: l.id, label: l.title }))]}
                  />
                )}
              </FormField>
            </div>
          </div>
        </Card>
      )}

      <Card className="p-5 sm:p-6">
        <h3 className="mb-4 font-display text-lg font-semibold text-slate-900">Fine-tune the brief</h3>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <FormField label="Subject" required error={subjectError} hint="Pre-filled from your request." className="md:col-span-2 xl:col-span-3">
            <Input value={f.subject} onChange={(e) => set("subject", e.target.value)} maxLength={300} placeholder="e.g. Cybersecurity incident response" />
          </FormField>
          <FormField label="Audience">
            <Input value={f.audience} onChange={(e) => set("audience", e.target.value)} placeholder="e.g. junior SOC analysts" />
          </FormField>
          <FormField label="Industry">
            <Input value={f.industry} onChange={(e) => set("industry", e.target.value)} placeholder="e.g. financial services" />
          </FormField>
          <FormField label="Format">
            {(aria) => <SimpleSelect {...aria} value={f.format} onValueChange={(v) => set("format", v)} options={FORMATS} />}
          </FormField>
          <fieldset className="space-y-1.5 md:col-span-2 xl:col-span-1">
            <legend className="text-sm font-medium text-slate-800">Difficulty</legend>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" {...rovingRadio} aria-label="Difficulty">
              {DIFFICULTIES.map((d) => {
                const on = f.difficulty === d.value;
                const c = colorClasses(d.color);
                return (
                  <button key={d.value} type="button" role="radio" aria-checked={on} onClick={() => set("difficulty", d.value)} className={cn("rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset focus-visible:focus-ring", on ? cn(c.soft, c.text, c.ring) : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50")}>
                    {d.label}
                  </button>
                );
              })}
            </div>
          </fieldset>
          {kind === "course" && (
            <FormField label="Weeks" hint="Each week becomes a module (1–26).">
              {(aria) => <NumberInput {...aria} value={f.weeks} onChange={(v) => set("weeks", v === null ? null : Math.max(1, Math.min(26, Math.round(v))))} min={1} max={26} placeholder="e.g. 4" />}
            </FormField>
          )}
          <FormField label="Duration" hint="Free text, e.g. “4 weeks, 2 hours/week”.">
            <Input value={f.duration} onChange={(e) => set("duration", e.target.value)} />
          </FormField>
          <FormField label="Learning objectives" className="md:col-span-2 xl:col-span-3" hint="Optional — the AI proposes objectives if you leave this empty.">
            {() => <StringListEditor label="objective" numbered value={f.objectives} onChange={(v) => set("objectives", v)} placeholder="e.g. Contain a ransomware incident within the first hour" color="emerald" />}
          </FormField>
          {(kind === "course" || kind === "quiz") && (
            <>
              <fieldset className="md:col-span-2">
                <legend className="mb-2 text-sm font-medium text-slate-800">Question types</legend>
                <div className="flex flex-wrap gap-1.5">
                  {GENERATABLE_QUESTION_TYPES.map((t) => {
                    const m = questionMeta(t);
                    const on = f.question_types.includes(t);
                    const c = colorClasses(m.color);
                    return (
                      <button
                        key={t}
                        type="button"
                        aria-pressed={on}
                        onClick={() => set("question_types", on ? f.question_types.filter((x) => x !== t) : [...f.question_types, t])}
                        className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset transition-colors focus-visible:focus-ring", on ? cn(c.soft, c.text, c.ring) : "bg-white text-slate-500 ring-slate-200 hover:bg-slate-50")}
                      >
                        <m.icon className="size-3.5" aria-hidden />
                        {m.label}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
              <FormField label={`Questions per quiz: ${f.question_count}`}>
                {(aria) => <input {...aria} type="range" min={3} max={25} value={f.question_count} onChange={(e) => set("question_count", Number(e.target.value))} className="w-full accent-brand-600" />}
              </FormField>
            </>
          )}
        </div>
      </Card>

      {start.isError && <GenerationError error={start.error} onRetry={() => start.mutate()} />}

      <div className="flex flex-col-reverse items-stretch gap-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-soft sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-start gap-2 text-sm text-slate-600">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
          Nothing is published automatically. You&apos;ll review, edit and approve before a draft is created.
        </p>
        <Can anyOf={["courses.create", "courses.edit"]}>
          <Button type="submit" variant="gradient" size="lg" leftIcon={<Wand2 />} loading={start.isPending} disabled={!canSubmit}>
            Generate {KINDS.find((k) => k.value === kind)?.label.toLowerCase()}
          </Button>
        </Can>
      </div>
    </form>
  );
}
