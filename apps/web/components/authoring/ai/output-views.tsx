"use client";

import { Badge, CATEGORY_COLORS, cn, colorClasses } from "@praxis/ui";
import { CheckCircle2, Circle, EyeOff, KeyRound, Lightbulb, ListChecks, Target, Users } from "lucide-react";
import * as React from "react";
import { Markdown } from "@/components/common/markdown";
import { FlashcardDeck } from "../course/lesson-render";
import { questionMeta } from "../meta";
import { DifficultyDots, TypeChip } from "../shared";
import type {
  GenAssignment,
  GenCaseStudy,
  GenFlashcards,
  GenLesson,
  GenQuestion,
  GenQuiz,
  GenRevisionNotes,
  GenRubric,
  GenScenario,
} from "../types";

export function QuestionView({ q, index }: { q: GenQuestion; index: number }) {
  const meta = questionMeta(q.type);
  const key = q.answer_key ?? {};
  const correct = new Set(((key.choice_ids as string[]) ?? []).map(String));
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="grid size-6 place-items-center rounded-lg bg-slate-900 text-2xs font-bold text-white">{index + 1}</span>
        <TypeChip meta={meta} size="xs" />
        <span className="text-xs font-semibold text-slate-600">{meta.label}</span>
        <DifficultyDots value={q.difficulty} className="ml-auto" />
        <span className="text-2xs font-medium text-muted-foreground">{q.points} pt</span>
      </div>
      <p className="font-medium text-slate-900">{q.prompt}</p>
      {q.choices?.length > 0 && (
        <ul className="mt-2.5 grid gap-1.5">
          {q.choices.map((c) => {
            const ok = correct.has(String(c.id));
            return (
              <li key={c.id} className={cn("flex items-start gap-2 rounded-xl px-3 py-2 text-sm", ok ? "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200" : "bg-slate-50 text-slate-700")}>
                {ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-label="Correct" /> : <Circle className="mt-0.5 size-4 shrink-0 text-slate-300" aria-hidden />}
                {c.text}
              </li>
            );
          })}
        </ul>
      )}
      {q.type === "true_false" && (
        <p className="mt-2 text-sm">
          Answer: <Badge tone={key.value ? "success" : "danger"} size="sm">{key.value ? "True" : "False"}</Badge>
        </p>
      )}
      {Array.isArray(key.accepted) && (
        <p className="mt-2 flex flex-wrap items-center gap-1.5 text-sm text-slate-700">
          Accepted:
          {(key.accepted as string[]).map((a) => (
            <Badge key={a} tone="success" size="sm">
              {a}
            </Badge>
          ))}
        </p>
      )}
      {typeof key.model_answer === "string" && (
        <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <strong>Model answer:</strong> {key.model_answer as string}
        </p>
      )}
      {q.explanation && (
        <p className="mt-2 flex gap-1.5 text-sm text-slate-600">
          <Lightbulb className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden />
          {q.explanation}
        </p>
      )}
    </div>
  );
}

export function QuizView({ quiz }: { quiz: GenQuiz }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="info">{quiz.questions.length} questions</Badge>
        <Badge tone="success">Pass {Math.round(quiz.pass_percentage)}%</Badge>
      </div>
      {quiz.description && <p className="text-sm text-muted-foreground">{quiz.description}</p>}
      <div className="space-y-2.5">
        {quiz.questions.map((q, i) => (
          <QuestionView key={i} q={q} index={i} />
        ))}
      </div>
    </div>
  );
}

export function FlashcardsView({ set }: { set: GenFlashcards }) {
  return (
    <div className="space-y-4">
      <FlashcardDeck cards={set.cards} />
      <ol className="grid gap-2 sm:grid-cols-2">
        {set.cards.map((c, i) => (
          <li key={i} className="rounded-xl border border-amber-200/70 bg-amber-50/40 p-3 text-sm">
            <p className="font-semibold text-slate-900">{c.front}</p>
            <p className="mt-1 text-slate-600">{c.back}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function RevisionNotesView({ notes }: { notes: GenRevisionNotes }) {
  return (
    <div className="space-y-4">
      <p className="text-slate-700">{notes.summary}</p>
      <div className="grid gap-3 md:grid-cols-2">
        {notes.sections.map((s, i) => {
          const c = colorClasses(CATEGORY_COLORS[i % CATEGORY_COLORS.length]!);
          return (
            <section key={i} className={cn("rounded-2xl border bg-gradient-to-br p-4", c.border, c.tint)}>
              <h4 className={cn("font-semibold", c.text)}>{s.heading}</h4>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
                {s.points.map((p, j) => (
                  <li key={j}>{p}</li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      {notes.key_terms.length > 0 && (
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-800">
            <KeyRound className="size-4 text-violet-600" aria-hidden /> Key terms
          </p>
          <dl className="grid gap-2 sm:grid-cols-2">
            {notes.key_terms.map((t) => (
              <div key={t.term} className="rounded-xl bg-violet-50/70 px-3 py-2 text-sm">
                <dt className="font-semibold text-violet-900">{t.term}</dt>
                <dd className="text-slate-700">{t.definition}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}

export function RubricView({ rubric }: { rubric: GenRubric }) {
  const levels = rubric.criteria[0]?.levels ?? [];
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">{rubric.description}</p>
      <div className="overflow-x-auto rounded-2xl border border-slate-200 scrollbar-thin">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left font-semibold text-slate-700">Criterion</th>
              {levels.map((l) => (
                <th key={l.label} className="px-3 py-2 text-left font-semibold text-slate-700">
                  {l.label} <span className="font-normal text-muted-foreground">({l.score})</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rubric.criteria.map((c) => (
              <tr key={c.id} className="border-t border-slate-100 align-top">
                <td className="px-3 py-2">
                  <p className="font-semibold text-slate-900">{c.name}</p>
                  <p className="text-xs text-muted-foreground">{c.description}</p>
                </td>
                {c.levels.map((l, i) => (
                  <td key={i} className="px-3 py-2 text-xs text-slate-600">
                    {l.description}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AssignmentView({ a }: { a: GenAssignment }) {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-4">
        <p className="mb-1 text-2xs font-bold uppercase tracking-wider text-amber-800">Scenario</p>
        <Markdown>{a.scenario}</Markdown>
      </div>
      <p className="flex gap-2 text-sm text-slate-700">
        <Target className="mt-0.5 size-4 shrink-0 text-rose-600" aria-hidden />
        <span>
          <strong>Objective:</strong> {a.objective}
        </span>
      </p>
      <div>
        <p className="mb-1 text-sm font-semibold text-slate-800">Instructions</p>
        <Markdown>{a.instructions}</Markdown>
      </div>
      {a.required_evidence.length > 0 && (
        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-slate-800">
            <ListChecks className="size-4 text-emerald-600" aria-hidden /> Required evidence
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {a.required_evidence.map((e) => (
              <Badge key={e.id} tone={e.required ? "success" : "neutral"}>
                {e.label} · {e.type}
              </Badge>
            ))}
          </ul>
        </div>
      )}
      {a.expected_output && (
        <div className="rounded-2xl border border-dashed border-rose-300 bg-rose-50/50 p-4">
          <p className="mb-1 flex items-center gap-1.5 text-2xs font-bold uppercase tracking-wider text-rose-700">
            <EyeOff className="size-3.5" aria-hidden /> Expected output · instructors only
          </p>
          <p className="text-sm text-slate-700">{a.expected_output}</p>
        </div>
      )}
      <RubricView rubric={a.rubric} />
    </div>
  );
}

export function GenLessonView({ lesson }: { lesson: GenLesson }) {
  return (
    <div className="space-y-4">
      <Markdown>{lesson.body_markdown}</Markdown>
      {lesson.key_points.length > 0 && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4">
          <p className="mb-1.5 text-2xs font-bold uppercase tracking-wider text-emerald-700">Key points</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
            {lesson.key_points.map((k, i) => (
              <li key={i}>{k}</li>
            ))}
          </ul>
        </div>
      )}
      {lesson.examples.length > 0 && (
        <div className="rounded-2xl border border-sky-200 bg-sky-50/50 p-4">
          <p className="mb-1.5 text-2xs font-bold uppercase tracking-wider text-sky-700">Examples</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
            {lesson.examples.map((k, i) => (
              <li key={i}>{k}</li>
            ))}
          </ul>
        </div>
      )}
      {lesson.case_study && <CaseStudyView cs={lesson.case_study} />}
      {lesson.knowledge_check && (
        <div>
          <p className="mb-2 text-sm font-semibold text-slate-800">Knowledge check</p>
          <QuizView quiz={lesson.knowledge_check} />
        </div>
      )}
    </div>
  );
}

export function CaseStudyView({ cs }: { cs: GenCaseStudy }) {
  return (
    <div className="space-y-2 rounded-2xl border border-teal-200 bg-gradient-to-br from-teal-50 to-white p-4">
      <p className="text-2xs font-bold uppercase tracking-wider text-teal-700">Case study · {cs.title}</p>
      <p className="text-sm text-slate-700">{cs.context}</p>
      <p className="text-sm font-semibold text-slate-900">{cs.challenge}</p>
      <ul className="list-disc space-y-0.5 pl-5 text-sm text-slate-700">
        {cs.questions.map((q, i) => (
          <li key={i}>{q}</li>
        ))}
      </ul>
    </div>
  );
}

export function ScenarioView({ s }: { s: GenScenario }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-700">{s.description}</p>
      <div className="flex flex-wrap gap-1.5">
        <Badge tone="violet">{s.environment_type}</Badge>
        <Badge tone="info">{s.industry}</Badge>
        <Badge tone="brand">Role: {s.learner_role}</Badge>
      </div>
      {s.phases.length > 0 && (
        <ol className="flex flex-wrap items-center gap-1 text-2xs font-semibold text-slate-600">
          {s.phases.map((p, i) => (
            <li key={p} className="flex items-center gap-1">
              <span className="rounded-full bg-slate-100 px-2 py-0.5">{p}</span>
              {i < s.phases.length - 1 && <span aria-hidden>→</span>}
            </li>
          ))}
        </ol>
      )}
      {s.characters.length > 0 && (
        <p className="flex flex-wrap items-center gap-1.5 text-sm text-slate-700">
          <Users className="size-4 text-sky-600" aria-hidden />
          {s.characters.map((c) => `${c.name} (${c.role})`).join(", ")}
        </p>
      )}
      {s.hidden_root_cause && (
        <p className="rounded-xl border border-dashed border-rose-300 bg-rose-50/60 px-3 py-2 text-sm text-rose-900">
          <strong>Hidden root cause (never shown to learners):</strong> {s.hidden_root_cause}
        </p>
      )}
    </div>
  );
}

/** Renders any generation output by kind. */
export function OutputView({ kind, output }: { kind: string; output: Record<string, unknown> }) {
  switch (kind) {
    case "quiz":
      return <QuizView quiz={output as unknown as GenQuiz} />;
    case "flashcards":
      return <FlashcardsView set={output as unknown as GenFlashcards} />;
    case "revision_notes":
      return <RevisionNotesView notes={output as unknown as GenRevisionNotes} />;
    case "rubric":
      return <RubricView rubric={output as unknown as GenRubric} />;
    case "assignment":
      return <AssignmentView a={output as unknown as GenAssignment} />;
    case "lesson":
      return <GenLessonView lesson={output as unknown as GenLesson} />;
    case "case_study":
      return <CaseStudyView cs={output as unknown as GenCaseStudy} />;
    case "scenario":
      return <ScenarioView s={output as unknown as GenScenario} />;
    default:
      return <pre className="overflow-x-auto rounded-xl bg-slate-50 p-3 text-xs">{JSON.stringify(output, null, 2)}</pre>;
  }
}
