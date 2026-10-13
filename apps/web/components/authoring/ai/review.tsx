"use client";

import {
  Alert,
  Badge,
  Button,
  CATEGORY_COLORS,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  FormField,
  Input,
  SimpleSelect,
  Skeleton,
  Textarea,
  cn,
  colorClasses,
  toast,
  type CategoryColor,
} from "@praxis/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Coins,
  Cpu,
  FileQuestion,
  GitBranch,
  GraduationCap,
  Layers,
  Library,
  ListTree,
  type LucideIcon,
  MonitorPlay,
  NotebookText,
  PartyPopper,
  Pencil,
  Plus,
  RefreshCw,
  Scale,
  ShieldCheck,
  Trash2,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { ErrorState } from "@/components/common/error-state";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatMinutes, formatRelative } from "@/lib/format";
import { ContentEditor } from "../course/content-editors";
import { problemsMessage, useAutosave } from "../hooks";
import { ak } from "../keys";
import { MarkdownEditor } from "../markdown-editor";
import { DIFFICULTIES, GENERATION_STATUS_LABEL, questionMeta } from "../meta";
import { AStatus, SaveIndicator, StringListEditor, TypeChip } from "../shared";
import type {
  ApplyOut,
  GenAssignment,
  GenCourse,
  GenLesson,
  GenModule,
  GenQuestion,
  GenQuiz,
  GenRevisionNotes,
  GenScenario,
  Generation,
  GenerationSummary,
  Page,
  Structure,
} from "../types";
import { useCourseOptions } from "../use-options";
import { GenerationProgress, OfflineNotice, useGeneration } from "./generation-progress";
import { AssignmentView, CaseStudyView, FlashcardsView, OutputView, QuestionView, RevisionNotesView, RubricView, ScenarioView } from "./output-views";
import { rovingRadio } from "../roving";

type Doc = Record<string, unknown>;

/* ------------------------------------------------------------------ editors */

function QuizEditor({ quiz, onChange }: { quiz: GenQuiz; onChange: (q: GenQuiz) => void }) {
  const [editing, setEditing] = React.useState<number | null>(null);
  const setQ = (i: number, patch: Partial<GenQuestion>) => onChange({ ...quiz, questions: quiz.questions.map((q, j) => (j === i ? { ...q, ...patch } : q)) });
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_160px]">
        <FormField label="Quiz title">
          <Input value={quiz.title} onChange={(e) => onChange({ ...quiz, title: e.target.value })} />
        </FormField>
        <FormField label="Pass mark">
          <Input type="number" min={0} max={100} value={quiz.pass_percentage} onChange={(e) => onChange({ ...quiz, pass_percentage: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} />
        </FormField>
      </div>
      <div className="space-y-2.5">
        {quiz.questions.map((q, i) =>
          editing === i ? (
            <div key={i} className="space-y-3 rounded-2xl border-2 border-brand-200 bg-brand-50/30 p-4">
              <div className="flex items-center gap-2">
                <TypeChip meta={questionMeta(q.type)} size="xs" />
                <span className="text-sm font-semibold text-slate-800">Question {i + 1}</span>
                <Button size="xs" variant="primary" className="ml-auto" onClick={() => setEditing(null)}>
                  Done
                </Button>
              </div>
              <FormField label="Prompt">
                <Textarea rows={2} value={q.prompt} onChange={(e) => setQ(i, { prompt: e.target.value })} />
              </FormField>
              {q.choices.length > 0 && (
                <fieldset className="space-y-1.5">
                  <legend className="mb-1 text-sm font-medium text-slate-800">Choices · tick correct</legend>
                  {q.choices.map((c, ci) => {
                    const ids = ((q.answer_key.choice_ids as string[]) ?? []).map(String);
                    const on = ids.includes(String(c.id));
                    return (
                      <div key={c.id} className="flex items-center gap-2">
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={on}
                          aria-label={`Choice ${ci + 1} correct`}
                          onClick={() => {
                            const next = q.type === "multiple_choice" ? [String(c.id)] : on ? ids.filter((x) => x !== String(c.id)) : [...ids, String(c.id)];
                            setQ(i, { answer_key: { ...q.answer_key, choice_ids: next } });
                          }}
                          className={cn("grid size-7 shrink-0 place-items-center rounded-lg border-2 focus-visible:focus-ring", on ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 text-transparent")}
                        >
                          <CheckCircle2 className="size-4" aria-hidden />
                        </button>
                        <Input inputSize="sm" value={c.text} aria-label={`Choice ${ci + 1}`} onChange={(e) => setQ(i, { choices: q.choices.map((x, xi) => (xi === ci ? { ...x, text: e.target.value } : x)) })} />
                      </div>
                    );
                  })}
                </fieldset>
              )}
              {q.type === "true_false" && (
                <div className="flex gap-2" role="radiogroup" {...rovingRadio} aria-label="Correct answer">
                  {[true, false].map((v) => (
                    <button key={String(v)} type="button" role="radio" aria-checked={q.answer_key.value === v} onClick={() => setQ(i, { answer_key: { value: v } })} className={cn("rounded-xl px-4 py-2 text-sm font-semibold ring-1 ring-inset focus-visible:focus-ring", q.answer_key.value === v ? "bg-emerald-50 text-emerald-800 ring-emerald-300" : "bg-white text-slate-600 ring-slate-200")}>
                      {v ? "True" : "False"}
                    </button>
                  ))}
                </div>
              )}
              <FormField label="Explanation">
                <Textarea rows={2} value={q.explanation} onChange={(e) => setQ(i, { explanation: e.target.value })} />
              </FormField>
            </div>
          ) : (
            <div key={i} className="group relative">
              <QuestionView q={q} index={i} />
              <div className="absolute right-3 top-3 flex gap-1 opacity-100 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
                <Button size="icon-sm" variant="secondary" aria-label={`Edit question ${i + 1}`} onClick={() => setEditing(i)}>
                  <Pencil />
                </Button>
                <Button size="icon-sm" variant="secondary" aria-label={`Delete question ${i + 1}`} disabled={quiz.questions.length <= 1} onClick={() => onChange({ ...quiz, questions: quiz.questions.filter((_, j) => j !== i) })}>
                  <Trash2 />
                </Button>
              </div>
            </div>
          ),
        )}
      </div>
    </div>
  );
}

function LessonPane({ lesson, onChange }: { lesson: GenLesson; onChange: (l: GenLesson) => void }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_140px]">
        <FormField label="Lesson title">
          <Input value={lesson.title} onChange={(e) => onChange({ ...lesson, title: e.target.value })} />
        </FormField>
        <FormField label="Minutes">
          <Input type="number" min={1} max={600} value={lesson.duration_minutes} onChange={(e) => onChange({ ...lesson, duration_minutes: Math.max(1, Math.min(600, Number(e.target.value) || 1)) })} />
        </FormField>
      </div>
      <FormField label="Summary">
        <Input value={lesson.summary} onChange={(e) => onChange({ ...lesson, summary: e.target.value })} />
      </FormField>
      <FormField label="Lesson content">
        {(aria) => <MarkdownEditor {...aria} label="Lesson content" value={lesson.body_markdown} onChange={(v) => onChange({ ...lesson, body_markdown: v })} minRows={14} />}
      </FormField>
      <div className="grid gap-4 lg:grid-cols-2">
        <FormField label="Key points">
          {() => <StringListEditor label="key point" value={lesson.key_points} onChange={(v) => onChange({ ...lesson, key_points: v })} color="emerald" />}
        </FormField>
        <FormField label="Examples">
          {() => <StringListEditor label="example" value={lesson.examples} onChange={(v) => onChange({ ...lesson, examples: v })} color="sky" />}
        </FormField>
      </div>
      {lesson.case_study && <CaseStudyView cs={lesson.case_study} />}
      {lesson.knowledge_check && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/30 p-4">
          <p className="mb-3 text-sm font-semibold text-emerald-800">Knowledge check (becomes an in-lesson check)</p>
          <QuizEditor quiz={lesson.knowledge_check} onChange={(q) => onChange({ ...lesson, knowledge_check: q })} />
        </div>
      )}
    </div>
  );
}

function AssignmentPane({ a, onChange }: { a: GenAssignment; onChange: (a: GenAssignment) => void }) {
  const [edit, setEdit] = React.useState(false);
  if (!edit)
    return (
      <div className="space-y-3">
        <Button size="sm" variant="soft" leftIcon={<Pencil />} onClick={() => setEdit(true)}>
          Edit assignment
        </Button>
        <AssignmentView a={a} />
      </div>
    );
  return (
    <div className="space-y-4">
      <Button size="sm" variant="primary" onClick={() => setEdit(false)}>
        Done editing
      </Button>
      <FormField label="Title">
        <Input value={a.title} onChange={(e) => onChange({ ...a, title: e.target.value })} />
      </FormField>
      <FormField label="Scenario">
        <Textarea rows={4} value={a.scenario} onChange={(e) => onChange({ ...a, scenario: e.target.value })} />
      </FormField>
      <FormField label="Objective">
        <Textarea rows={2} value={a.objective} onChange={(e) => onChange({ ...a, objective: e.target.value })} />
      </FormField>
      <FormField label="Instructions">
        {(aria) => <MarkdownEditor {...aria} label="Instructions" value={a.instructions} onChange={(v) => onChange({ ...a, instructions: v })} minRows={6} compact />}
      </FormField>
      <FormField label="Expected output (instructors only)">
        <Textarea rows={3} value={a.expected_output} onChange={(e) => onChange({ ...a, expected_output: e.target.value })} />
      </FormField>
      <FormField label="Evaluation criteria">
        <Textarea rows={2} value={a.evaluation_criteria} onChange={(e) => onChange({ ...a, evaluation_criteria: e.target.value })} />
      </FormField>
      <RubricView rubric={a.rubric} />
    </div>
  );
}

/* ------------------------------------------------------------------ tree */

type NodeId = string;

interface TreeNode {
  id: NodeId;
  label: string;
  icon: LucideIcon;
  color: CategoryColor;
  meta?: string;
  children?: TreeNode[];
}

function courseTree(c: GenCourse): TreeNode[] {
  const nodes: TreeNode[] = [{ id: "course", label: "Course overview", icon: GraduationCap, color: "indigo", meta: `${c.learning_objectives.length} objectives` }];
  c.modules.forEach((m, i) =>
    nodes.push({
      id: `m:${i}`,
      label: m.week ? `Week ${m.week} · ${m.title}` : m.title,
      icon: ListTree,
      color: CATEGORY_COLORS[i % CATEGORY_COLORS.length]!,
      meta: `${m.lessons.length} lessons${m.quiz ? " · quiz" : ""}`,
      children: [
        ...m.lessons.map((l, j) => ({ id: `m:${i}:l:${j}`, label: l.title, icon: BookOpen, color: "sky" as const, meta: `${l.duration_minutes} min${l.knowledge_check ? " · check" : ""}` })),
        ...(m.quiz ? [{ id: `m:${i}:quiz`, label: m.quiz.title, icon: FileQuestion, color: "violet" as const, meta: `${m.quiz.questions.length} questions` }] : []),
      ],
    }),
  );
  c.assignments.forEach((a, i) => nodes.push({ id: `a:${i}`, label: a.title, icon: ClipboardCheck, color: "amber", meta: `Assignment · ${a.rubric.criteria.length}-criterion rubric` }));
  if (c.final_assessment) nodes.push({ id: "final", label: c.final_assessment.title, icon: FileQuestion, color: "rose", meta: `Final · ${c.final_assessment.questions.length} questions` });
  if (c.flashcards) nodes.push({ id: "flashcards", label: c.flashcards.title, icon: Layers, color: "orange", meta: `Flashcards · ${c.flashcards.cards.length} cards` });
  if (c.revision_notes) nodes.push({ id: "notes", label: c.revision_notes.title, icon: NotebookText, color: "teal", meta: `Revision notes · ${c.revision_notes.sections.length} sections` });
  if (c.simulation_suggestion) nodes.push({ id: "sim", label: c.simulation_suggestion.title, icon: MonitorPlay, color: "fuchsia", meta: "Simulation idea" });
  return nodes;
}

function TreeItem({ node, selected, onSelect, depth = 0 }: { node: TreeNode; selected: NodeId; onSelect: (id: NodeId) => void; depth?: number }) {
  const [open, setOpen] = React.useState(true);
  const c = colorClasses(node.color);
  const on = selected === node.id;
  return (
    <li>
      <div className={cn("flex items-center gap-1 rounded-xl", on ? "bg-brand-50 ring-1 ring-inset ring-brand-200" : "hover:bg-slate-50")} style={{ paddingLeft: depth * 14 }}>
        {node.children?.length ? (
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={`${open ? "Collapse" : "Expand"} ${node.label}`} className="grid size-6 shrink-0 place-items-center rounded-md text-slate-500 hover:bg-white focus-visible:focus-ring">
            {open ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronRight className="size-3.5" aria-hidden />}
          </button>
        ) : (
          <span className="w-6 shrink-0" aria-hidden />
        )}
        <button type="button" onClick={() => onSelect(node.id)} aria-current={on ? "true" : undefined} className="flex min-w-0 flex-1 items-center gap-2 rounded-lg py-1.5 pr-2 text-left focus-visible:focus-ring">
          <span className={cn("grid size-6 shrink-0 place-items-center rounded-md", depth === 0 ? cn("bg-gradient-to-br text-white", c.gradient) : cn(c.soft, c.icon))} aria-hidden>
            <node.icon className="size-3.5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className={cn("line-clamp-2 block text-sm leading-snug", on ? "font-semibold text-brand-900" : depth === 0 ? "font-semibold text-slate-900" : "text-slate-700")}>{node.label}</span>
            {node.meta && <span className="block truncate text-2xs text-muted-foreground">{node.meta}</span>}
          </span>
        </button>
      </div>
      {open && node.children?.length ? (
        <ul className="mt-0.5 space-y-0.5">
          {node.children.map((ch) => (
            <TreeItem key={ch.id} node={ch} selected={selected} onSelect={onSelect} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/* ------------------------------------------------------------------ course pane switch */

function CoursePane({ doc, node, onChange, onSelect }: { doc: GenCourse; node: NodeId; onChange: (c: GenCourse) => void; onSelect: (id: NodeId) => void }) {
  const setModule = (i: number, m: GenModule) => onChange({ ...doc, modules: doc.modules.map((x, j) => (j === i ? m : x)) });
  if (node === "course") {
    const lessons = doc.modules.reduce((s, m) => s + m.lessons.length, 0);
    const quizzes = doc.modules.filter((m) => m.quiz).length + (doc.final_assessment ? 1 : 0);
    const questions = doc.modules.reduce((s, m) => s + (m.quiz?.questions.length ?? 0) + m.lessons.reduce((t, l) => t + (l.knowledge_check?.questions.length ?? 0), 0), 0) + (doc.final_assessment?.questions.length ?? 0);
    const tiles = [
      { label: "Modules", v: doc.modules.length, icon: ListTree, c: "indigo" as const },
      { label: "Lessons", v: lessons, icon: BookOpen, c: "sky" as const },
      { label: "Quizzes", v: quizzes, icon: FileQuestion, c: "violet" as const },
      { label: "Questions", v: questions, icon: CheckCircle2, c: "emerald" as const },
      { label: "Assignments", v: doc.assignments.length, icon: ClipboardCheck, c: "amber" as const },
      { label: "Duration", v: formatMinutes(doc.duration_minutes || doc.modules.reduce((s, m) => s + m.lessons.reduce((t, l) => t + l.duration_minutes, 0), 0)), icon: Layers, c: "fuchsia" as const },
    ];
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
          {tiles.map((t) => {
            const c = colorClasses(t.c);
            return (
              <div key={t.label} className={cn("rounded-2xl border bg-gradient-to-br p-3", c.border, c.tint)}>
                <t.icon className={cn("size-4", c.icon)} aria-hidden />
                <p className="mt-1 font-display text-xl font-bold tabular-nums text-slate-900">{t.v}</p>
                <p className="text-2xs font-semibold uppercase tracking-wider text-slate-500">{t.label}</p>
              </div>
            );
          })}
        </div>
        <FormField label="Course title">
          <Input value={doc.title} onChange={(e) => onChange({ ...doc, title: e.target.value })} />
        </FormField>
        <FormField label="Subtitle">
          <Input value={doc.subtitle} onChange={(e) => onChange({ ...doc, subtitle: e.target.value })} />
        </FormField>
        <FormField label="Description">
          <Textarea rows={4} value={doc.description} onChange={(e) => onChange({ ...doc, description: e.target.value })} />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Audience">
            <Input value={doc.audience} onChange={(e) => onChange({ ...doc, audience: e.target.value })} />
          </FormField>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-slate-800">Difficulty</legend>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" {...rovingRadio} aria-label="Difficulty">
              {DIFFICULTIES.map((d) => {
                const on = doc.difficulty === d.value;
                const c = colorClasses(d.color);
                return (
                  <button key={d.value} type="button" role="radio" aria-checked={on} onClick={() => onChange({ ...doc, difficulty: d.value })} className={cn("rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset focus-visible:focus-ring", on ? cn(c.soft, c.text, c.ring) : "bg-white text-slate-600 ring-slate-200")}>
                    {d.label}
                  </button>
                );
              })}
            </div>
          </fieldset>
        </div>
        <FormField label="Learning objectives">
          {() => <StringListEditor label="objective" numbered value={doc.learning_objectives} onChange={(v) => onChange({ ...doc, learning_objectives: v })} color="emerald" />}
        </FormField>
        <FormField label="Prerequisites">
          {() => <StringListEditor label="prerequisite" value={doc.prerequisites} onChange={(v) => onChange({ ...doc, prerequisites: v })} color="amber" />}
        </FormField>
      </div>
    );
  }
  const mm = node.match(/^m:(\d+)$/);
  if (mm) {
    const i = Number(mm[1]);
    const m = doc.modules[i];
    if (!m) return null;
    return (
      <div className="space-y-4">
        <FormField label="Module title">
          <Input value={m.title} onChange={(e) => setModule(i, { ...m, title: e.target.value })} />
        </FormField>
        <FormField label="Description">
          <Textarea rows={3} value={m.description} onChange={(e) => setModule(i, { ...m, description: e.target.value })} />
        </FormField>
        <div className="space-y-2">
          <p className="text-sm font-semibold text-slate-800">Lessons</p>
          {m.lessons.map((l, j) => (
            <div key={j} className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
              <TypeChip meta={{ icon: BookOpen, color: "sky", label: "Lesson" }} size="sm" />
              <button type="button" className="min-w-0 flex-1 rounded text-left focus-visible:focus-ring" onClick={() => onSelect(`m:${i}:l:${j}`)}>
                <span className="block truncate text-sm font-semibold text-slate-900">{l.title}</span>
                <span className="block truncate text-xs text-muted-foreground">{l.summary}</span>
              </button>
              <Badge size="sm" tone="info">
                {l.duration_minutes} min
              </Badge>
              <Button size="icon-sm" variant="ghost" aria-label={`Remove lesson ${l.title}`} disabled={m.lessons.length <= 1} onClick={() => setModule(i, { ...m, lessons: m.lessons.filter((_, k) => k !== j) })}>
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button
            size="sm"
            variant="soft"
            leftIcon={<Plus />}
            onClick={() =>
              setModule(i, {
                ...m,
                lessons: [...m.lessons, { title: "New lesson", summary: "", duration_minutes: 10, body_markdown: "## New lesson\n\nWrite the content here.", examples: [], key_points: [], case_study: null, knowledge_check: null }],
              })
            }
          >
            Add lesson
          </Button>
        </div>
        <Button size="sm" variant="destructive-soft" leftIcon={<Trash2 />} disabled={doc.modules.length <= 1} onClick={() => {
          onChange({ ...doc, modules: doc.modules.filter((_, k) => k !== i) });
          onSelect("course");
        }}>
          Remove this module
        </Button>
      </div>
    );
  }
  const ml = node.match(/^m:(\d+):l:(\d+)$/);
  if (ml) {
    const i = Number(ml[1]);
    const j = Number(ml[2]);
    const m = doc.modules[i];
    const l = m?.lessons[j];
    if (!m || !l) return null;
    return <LessonPane key={node} lesson={l} onChange={(nl) => setModule(i, { ...m, lessons: m.lessons.map((x, k) => (k === j ? nl : x)) })} />;
  }
  const mq = node.match(/^m:(\d+):quiz$/);
  if (mq) {
    const i = Number(mq[1]);
    const m = doc.modules[i];
    if (!m?.quiz) return null;
    return <QuizEditor key={node} quiz={m.quiz} onChange={(q) => setModule(i, { ...m, quiz: q })} />;
  }
  const ma = node.match(/^a:(\d+)$/);
  if (ma) {
    const i = Number(ma[1]);
    const a = doc.assignments[i];
    if (!a) return null;
    return <AssignmentPane key={node} a={a} onChange={(na) => onChange({ ...doc, assignments: doc.assignments.map((x, k) => (k === i ? na : x)) })} />;
  }
  if (node === "final" && doc.final_assessment) return <QuizEditor quiz={doc.final_assessment} onChange={(q) => onChange({ ...doc, final_assessment: q })} />;
  if (node === "flashcards" && doc.flashcards)
    return (
      <div className="space-y-5">
        <FlashcardsView set={doc.flashcards} />
        <ContentEditor type="flashcards" content={{ cards: doc.flashcards.cards }} onChange={(c) => onChange({ ...doc, flashcards: { ...doc.flashcards!, cards: (c.cards as { front: string; back: string }[]) ?? [] } })} />
      </div>
    );
  if (node === "notes" && doc.revision_notes)
    return (
      <div className="space-y-4">
        <FormField label="Summary">
          <Textarea rows={3} value={doc.revision_notes.summary} onChange={(e) => onChange({ ...doc, revision_notes: { ...(doc.revision_notes as GenRevisionNotes), summary: e.target.value } })} />
        </FormField>
        <RevisionNotesView notes={doc.revision_notes} />
      </div>
    );
  if (node === "sim" && doc.simulation_suggestion)
    return (
      <div className="space-y-3">
        <Alert tone="info">Simulation ideas are not created automatically — use this as the brief in the simulation builder after applying.</Alert>
        <ScenarioView s={doc.simulation_suggestion as GenScenario} />
      </div>
    );
  return null;
}

/* ------------------------------------------------------------------ dialogs */

function NotesDialog({
  open,
  onOpenChange,
  title,
  description,
  required,
  confirmLabel,
  tone,
  onSubmit,
  busy,
  label = "Notes",
  placeholder,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: string;
  required?: boolean;
  confirmLabel: string;
  tone: "primary" | "destructive" | "gradient";
  onSubmit: (notes: string) => void;
  busy: boolean;
  label?: string;
  placeholder?: string;
}) {
  const [notes, setNotes] = React.useState("");
  React.useEffect(() => {
    if (open) setNotes("");
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <FormField label={label} required={required}>
          <Textarea autoFocus rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} placeholder={placeholder} />
        </FormField>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant={tone} loading={busy} disabled={required && !notes.trim()} onClick={() => onSubmit(notes.trim())}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const CREATED_META: Record<string, { label: string; icon: LucideIcon; color: CategoryColor }> = {
  courses: { label: "Course", icon: GraduationCap, color: "indigo" },
  modules: { label: "Modules", icon: ListTree, color: "sky" },
  lessons: { label: "Lessons", icon: BookOpen, color: "emerald" },
  assessments: { label: "Assessments", icon: FileQuestion, color: "violet" },
  questions: { label: "Questions", icon: CheckCircle2, color: "teal" },
  question_banks: { label: "Question banks", icon: Library, color: "sky" },
  assignments: { label: "Assignments", icon: ClipboardCheck, color: "amber" },
  rubrics: { label: "Rubrics", icon: Scale, color: "rose" },
  activities: { label: "Blocks", icon: Layers, color: "fuchsia" },
  simulations: { label: "Simulations", icon: MonitorPlay, color: "orange" },
};

const humanize = (k: string) => k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

function AppliedPanel({ result }: { result: ApplyOut }) {
  const reduce = useReducedMotion();
  const entries = Object.entries(result.created).filter(([, v]) => v > 0);
  const label = result.entity_type === "course" ? "Open the draft course in the builder" : `Open the ${result.entity_type}`;
  return (
    <motion.div initial={reduce ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="overflow-hidden rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-teal-50 p-6 shadow-soft sm:p-8">
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        <span className="grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500 text-white shadow-glow">
          <PartyPopper className="size-7" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-xl font-bold text-slate-900">Draft created — nothing has been published</p>
          <p className="text-sm text-slate-600">Review it in the builder, adjust anything, then publish when it&apos;s ready.</p>
        </div>
        <Button asChild variant="gradient" rightIcon={<ArrowRight />}>
          <Link href={result.link.replace(/\/builder$/, "")}>{label}</Link>
        </Button>
      </div>
      {entries.length > 0 && (
        <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))]">
          {entries.map(([k, v]) => {
            const m = CREATED_META[k] ?? { label: humanize(k), icon: Layers, color: "indigo" as const };
            const c = colorClasses(m.color);
            return (
              <div key={k} className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-100">
                <m.icon className={cn("size-4", c.icon)} aria-hidden />
                <p className="mt-1 font-display text-xl font-bold tabular-nums text-slate-900">{v}</p>
                <p className="text-2xs font-semibold uppercase tracking-wider text-slate-500">{m.label}</p>
              </div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}

/** Lesson-level generations (flashcards, notes, case studies…) are added to a course module. */
const NEEDS_COURSE = new Set(["module", "lesson", "flashcards", "revision_notes", "case_study"]);

function ApplyTargetDialog({
  open,
  onOpenChange,
  kind,
  busy,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  kind: string;
  busy: boolean;
  onSubmit: (t: { course_id: string; module_id: string | null }) => void;
}) {
  const courses = useCourseOptions(open);
  const [courseId, setCourseId] = React.useState("");
  const [moduleId, setModuleId] = React.useState("auto");
  React.useEffect(() => {
    if (open) {
      setCourseId("");
      setModuleId("auto");
    }
  }, [open]);
  const structure = useQuery({
    queryKey: ak.courses.structure(courseId),
    enabled: open && !!courseId,
    queryFn: ({ signal }) => api.get<Structure>(`/courses/${courseId}/structure`, { signal }),
  });
  const modules = structure.data?.modules ?? [];
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Where should the {kind.replace("_", " ")} go?</DialogTitle>
          <DialogDescription>It&apos;s added as a new draft lesson at the end of the module you choose. Nothing is published.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <FormField label="Course" required>
            {(aria) => <SimpleSelect {...aria} value={courseId} onValueChange={(v) => { setCourseId(v); setModuleId("auto"); }} options={courses.options} placeholder="Choose a course" />}
          </FormField>
          <FormField label="Module" hint="Defaults to the last module (one is created if the course has none).">
            {(aria) => (
              <SimpleSelect
                {...aria}
                value={moduleId}
                onValueChange={setModuleId}
                disabled={!courseId}
                options={[{ value: "auto", label: "Last module" }, ...modules.map((m, i) => ({ value: m.id, label: `${i + 1}. ${m.title}` }))]}
              />
            )}
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="gradient" leftIcon={<Plus />} loading={busy} disabled={!courseId} onClick={() => onSubmit({ course_id: courseId, module_id: moduleId === "auto" ? null : moduleId })}>
            Create draft lesson
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ workspace */

function useFamily(gen: Generation | undefined) {
  const list = useQuery({
    queryKey: ak.generations.list({ kind: gen?.kind, family: true }),
    enabled: !!gen,
    queryFn: ({ signal }) => api.get<Page<GenerationSummary>>("/ai/generations", { signal, query: { kind: gen!.kind, page_size: 100 } }),
    staleTime: 10_000,
  });
  return React.useMemo(() => {
    if (!gen) return [];
    const all = new Map((list.data?.items ?? []).map((g) => [g.id, g]));
    all.set(gen.id, gen);
    const root = (id: string): string => {
      let cur = all.get(id);
      const seen = new Set<string>();
      while (cur?.parent_id && all.has(cur.parent_id) && !seen.has(cur.id)) {
        seen.add(cur.id);
        cur = all.get(cur.parent_id);
      }
      return cur?.id ?? id;
    };
    const r = root(gen.id);
    return [...all.values()].filter((g) => root(g.id) === r).sort((a, b) => a.version - b.version);
  }, [gen, list.data]);
}

function Workspace({ gen, onOpen }: { gen: Generation; onOpen: (id: string) => void }) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const family = useFamily(gen);
  const [doc, setDoc] = React.useState<Doc | null>(() => (gen.edited_output ?? gen.output) as Doc | null);
  const [node, setNode] = React.useState<NodeId>("course");
  const editorRef = React.useRef<HTMLDivElement>(null);
  /** Select a node; below lg the editor sits under the picker, so bring it into view. */
  const jumpTo = React.useCallback((id: NodeId) => {
    setNode(id);
    if (typeof window === "undefined" || !window.matchMedia("(max-width: 1023px)").matches) return;
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    requestAnimationFrame(() => editorRef.current?.scrollIntoView({ block: "start", behavior: smooth ? "smooth" : "auto" }));
  }, []);
  const [dialog, setDialog] = React.useState<null | "approve" | "reject" | "regenerate">(null);
  const [applied, setApplied] = React.useState<ApplyOut | null>(null);
  const [applyTarget, setApplyTarget] = React.useState(false);
  const knownCourse = gen.course_id ?? (typeof gen.input?.course_id === "string" ? gen.input.course_id : null);
  const startApply = () => {
    if (NEEDS_COURSE.has(gen.kind) && !knownCourse) setApplyTarget(true);
    else apply.mutate({});
  };
  const editable = (gen.status === "completed" || gen.status === "approved") && can("courses.edit");

  const save = useAutosave(async (d: Doc) => {
    const out = await api.patch<Generation>(`/ai/generations/${gen.id}`, { edited_output: d });
    qc.setQueryData(ak.generations.detail(gen.id), out);
  }, 1200);

  const change = (d: Doc) => {
    setDoc(d);
    if (editable) save.schedule(d);
  };

  const refresh = (g: Generation) => {
    qc.setQueryData(ak.generations.detail(g.id), g);
    qc.invalidateQueries({ queryKey: ak.generations.all });
  };
  const approve = useMutation({
    mutationFn: async (notes: string) => {
      await save.flush();
      return api.post<Generation>(`/ai/generations/${gen.id}/approve`, { notes: notes || null });
    },
    onSuccess: (g) => {
      refresh(g);
      setDialog(null);
      toast.success("Approved — ready to create the draft");
    },
    onError: (e) => toast.error(problemsMessage(e)),
  });
  const reject = useMutation({
    mutationFn: (notes: string) => api.post<Generation>(`/ai/generations/${gen.id}/reject`, { notes }),
    onSuccess: (g) => {
      refresh(g);
      setDialog(null);
      toast.success("Generation rejected");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const regenerate = useMutation({
    mutationFn: (feedback: string) => api.post<Generation>(`/ai/generations/${gen.id}/regenerate`, { feedback: feedback || null }),
    onSuccess: (g) => {
      refresh(g);
      setDialog(null);
      toast.success(`Generating version ${g.version}…`);
      onOpen(g.id);
    },
    onError: (e) => toast.error(problemsMessage(e)),
  });
  const apply = useMutation({
    mutationFn: async (target: { course_id?: string | null; module_id?: string | null } = {}) => {
      await save.flush();
      return api.post<ApplyOut>(`/ai/generations/${gen.id}/apply`, {
        course_id: target.course_id || null,
        module_id: target.module_id || null,
      });
    },
    onSuccess: (res) => {
      setApplyTarget(false);
      setApplied(res);
      refresh(res.generation);
      qc.invalidateQueries({ queryKey: ["courses"] });
      toast.success("Draft created");
    },
    onError: (e) => toast.error(problemsMessage(e)),
  });

  const isCourse = gen.kind === "course" && doc;
  const tree = isCourse ? courseTree(doc as unknown as GenCourse) : [];
  const flatTree = tree.flatMap((n) => [{ id: n.id, label: n.label, depth: 0 }, ...(n.children ?? []).map((ch) => ({ id: ch.id, label: ch.label, depth: 1 }))]);
  const appliedLink =
    gen.applied_entity_id && gen.applied_entity_type
      ? gen.applied_entity_type === "course"
        ? `/app/instructor/courses/${gen.applied_entity_id}`
        : gen.applied_entity_type === "assessment"
          ? `/app/instructor/assessments/${gen.applied_entity_id}`
          : gen.applied_entity_type === "assignment"
            ? `/app/instructor/assignments/${gen.applied_entity_id}`
            : gen.applied_entity_type === "rubric"
              ? `/app/instructor/rubrics/${gen.applied_entity_id}`
              : gen.applied_entity_type === "simulation"
                ? `/app/instructor/simulations/${gen.applied_entity_id}`
                : null
      : null;

  return (
    <div className="space-y-5">
      <Alert tone="brand" icon={<ShieldCheck aria-hidden />} title="AI-generated content is never published automatically">
        Review and edit everything here, approve it, then create a draft. Publishing always happens from the course builder by someone with publish rights.
      </Alert>
      {gen.offline && <OfflineNotice />}

      <Card className="p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <AStatus status={gen.status} label={GENERATION_STATUS_LABEL[gen.status] ?? gen.status} />
              <Badge tone="violet" size="sm" className="capitalize">
                {gen.kind.replace("_", " ")}
              </Badge>
              {family.length > 1 ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700 ring-1 ring-inset ring-slate-200 hover:bg-slate-200 focus-visible:focus-ring">
                      <GitBranch className="size-3.5" aria-hidden /> Version {gen.version} of {family.length}
                      <ChevronDown className="size-3" aria-hidden />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-72">
                    <DropdownMenuLabel>Version history</DropdownMenuLabel>
                    {family.map((v) => (
                      <DropdownMenuItem key={v.id} onSelect={() => onOpen(v.id)} disabled={v.id === gen.id}>
                        <span className="grid size-6 place-items-center rounded-md bg-violet-100 text-2xs font-bold text-violet-700">v{v.version}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">{v.title ?? "Untitled"}</span>
                          <span className="block text-2xs text-muted-foreground">
                            {GENERATION_STATUS_LABEL[v.status] ?? v.status} · {formatRelative(v.created_at)}
                            {v.parent_id ? ` · from v${family.find((p) => p.id === v.parent_id)?.version ?? "?"}` : " · original"}
                          </span>
                        </span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <Badge size="sm" tone="neutral">
                  <GitBranch aria-hidden /> v{gen.version}
                </Badge>
              )}
            </div>
            <h2 className="line-clamp-2 font-display text-xl font-bold tracking-tight text-slate-900 sm:line-clamp-1 sm:text-2xl">{String((doc as { title?: string } | null)?.title ?? gen.title ?? "Generation")}</h2>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Cpu className="size-3.5" aria-hidden /> {gen.provider ?? "—"}
                {gen.model ? ` · ${gen.model}` : ""}
              </span>
              <span className="inline-flex items-center gap-1">
                <Coins className="size-3.5" aria-hidden /> ${gen.cost_usd.toFixed(4)} · {(gen.tokens_in + gen.tokens_out).toLocaleString()} tokens
              </span>
              <span>Created {formatRelative(gen.created_at)}</span>
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {editable && <SaveIndicator status={save.status} error={save.error} savedAt={save.savedAt} onRetry={() => void save.flush()} />}
            {gen.status !== "applied" && (
              <Button variant="secondary" leftIcon={<RefreshCw />} onClick={() => setDialog("regenerate")}>
                Regenerate
              </Button>
            )}
            {editable && (
              <Button variant="destructive-soft" leftIcon={<XCircle />} onClick={() => setDialog("reject")}>
                Reject
              </Button>
            )}
            {gen.status === "completed" && can("courses.edit") && (
              <Button variant="success" leftIcon={<CheckCircle2 />} onClick={() => setDialog("approve")}>
                Approve
              </Button>
            )}
            {gen.status === "approved" && can("courses.edit") && (
              <Button variant="gradient" leftIcon={<Plus />} loading={apply.isPending} onClick={startApply}>
                {gen.kind === "course" ? "Create draft course" : `Create draft ${gen.kind.replace("_", " ")}`}
              </Button>
            )}
            {gen.status === "applied" && appliedLink && !applied && (
              <Button asChild variant="gradient" rightIcon={<ArrowRight />}>
                <Link href={appliedLink}>Open draft</Link>
              </Button>
            )}
          </div>
        </div>
        {gen.review_notes && (
          <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <strong>Review notes:</strong> {gen.review_notes}
          </p>
        )}
        {gen.status === "approved" && <p className="mt-3 text-xs text-emerald-700">Approved. Editing now will send it back for review.</p>}
      </Card>

      {applied && <AppliedPanel result={applied} />}

      {gen.status === "failed" && (
        <Alert tone="danger" title="This generation failed" action={<Button size="sm" variant="secondary" leftIcon={<RefreshCw />} onClick={() => regenerate.mutate("")} loading={regenerate.isPending}>Try again</Button>}>
          {gen.error ?? "The AI provider returned an error."}
        </Alert>
      )}

      {doc && isCourse ? (
        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
          {/* Below lg the full tree would push the editor ~2000px down: use a compact jump-to picker instead. */}
          <Card className="p-3 lg:hidden">
            <label htmlFor="gen-jump" className="mb-1.5 flex items-center justify-between text-2xs font-bold uppercase tracking-wider text-slate-500">
              <span>Jump to</span>
              <span className="font-medium normal-case tracking-normal text-muted-foreground">
                {flatTree.findIndex((n) => n.id === node) + 1} of {flatTree.length}
              </span>
            </label>
            <SimpleSelect
              id="gen-jump"
              value={node}
              onValueChange={jumpTo}
              aria-label="Jump to part of the proposed course"
              options={flatTree.map((n) => ({ value: n.id, label: `${n.depth ? "\u00a0\u00a0\u00a0· " : ""}${n.label}` }))}
            />
          </Card>
          <Card className="hidden p-2 lg:sticky lg:top-20 lg:block lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto lg:scrollbar-thin">
            <p className="px-2 pb-2 pt-1 text-2xs font-bold uppercase tracking-wider text-slate-500">Proposed structure</p>
            <ul className="space-y-0.5" aria-label="Proposed course structure">
              {tree.map((n) => (
                <TreeItem key={n.id} node={n} selected={node} onSelect={setNode} />
              ))}
            </ul>
          </Card>
          <Card ref={editorRef} className="scroll-mt-20 p-5 sm:p-6">
            {!editable && gen.status !== "failed" && (
              <p className="mb-4 rounded-xl bg-slate-50 px-3 py-2 text-xs text-muted-foreground">Read-only — only completed or approved generations can be edited.</p>
            )}
            <fieldset disabled={!editable} className="min-w-0">
              <CoursePane doc={doc as unknown as GenCourse} node={node} onChange={(c) => change(c as unknown as Doc)} onSelect={jumpTo} />
            </fieldset>
          </Card>
        </div>
      ) : doc ? (
        <Card className="p-5 sm:p-6">
          <fieldset disabled={!editable} className="min-w-0">
            {gen.kind === "quiz" ? (
              <QuizEditor quiz={doc as unknown as GenQuiz} onChange={(q) => change(q as unknown as Doc)} />
            ) : gen.kind === "assignment" ? (
              <AssignmentPane a={doc as unknown as GenAssignment} onChange={(a) => change(a as unknown as Doc)} />
            ) : (
              <OutputView kind={gen.kind} output={doc} />
            )}
          </fieldset>
        </Card>
      ) : null}

      <ApplyTargetDialog
        open={applyTarget}
        onOpenChange={setApplyTarget}
        kind={gen.kind}
        busy={apply.isPending}
        onSubmit={(t) => apply.mutate(t)}
      />
      <NotesDialog
        open={dialog === "approve"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Approve this draft?"
        description="Approval records you as the reviewer. You can then create draft entities — nothing is published."
        confirmLabel="Approve"
        tone="primary"
        label="Review notes (optional)"
        busy={approve.isPending}
        onSubmit={(n) => approve.mutate(n)}
      />
      <NotesDialog
        open={dialog === "reject"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Reject this generation?"
        description="Tell the team why — the notes are kept in the audit trail. You can still regenerate later."
        confirmLabel="Reject"
        tone="destructive"
        required
        label="Reason"
        placeholder="e.g. Too generic for our SOC tooling; missing containment steps."
        busy={reject.isPending}
        onSubmit={(n) => reject.mutate(n)}
      />
      <NotesDialog
        open={dialog === "regenerate"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Regenerate as version ${(family.at(-1)?.version ?? gen.version) + 1}`}
        description="Describe what to change. The current version is kept so you can compare and switch back."
        confirmLabel="Regenerate"
        tone="gradient"
        label="Feedback for the AI"
        placeholder="e.g. Make week 2 more hands-on, add a lesson on log analysis, use Microsoft Sentinel examples."
        busy={regenerate.isPending}
        onSubmit={(n) => regenerate.mutate(n)}
      />
    </div>
  );
}

/** Review workspace for a generation id: progress while running, then review → approve → apply. */
export function GenerationReview({ id, onOpen }: { id: string; onOpen: (id: string) => void }) {
  const q = useGeneration(id);
  if (q.isLoading)
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 rounded-2xl" />
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    );
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const g = q.data;
  if (g.status === "pending" || g.status === "running")
    return (
      <div className="space-y-5">
        <Alert tone="brand" icon={<ShieldCheck aria-hidden />}>
          AI-generated content is never published automatically — you&apos;ll review every module, lesson and question first.
        </Alert>
        <GenerationProgress gen={g} />
      </div>
    );
  return <Workspace key={`${g.id}`} gen={g} onOpen={onOpen} />;
}
