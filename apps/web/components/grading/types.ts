/**
 * Grading types. API shapes come from the generated OpenAPI schema; free-form JSON columns (rubric criteria,
 * breakdown rows, AI feedback) get narrower local types here.
 */
import type { components } from "@praxis/types/openapi";

type S = components["schemas"];

export type QueueItem = S["QueueItem"];
export type ReviewQueueItem = S["ReviewQueueItem"];
export type GradingDetail = S["GradingDetail"];
export type GradeOut = S["GradeOut"];
export type IntegritySignal = S["IntegritySignalOut"];
export type SubmissionOut = S["SubmissionOut"];
export type AssignmentOut = S["AssignmentOut"];
export type SubmissionVersion = S["app__modules__assignments__schemas__VersionOut"];
export type FileRef = S["FileRef"];
export type AttemptResult = S["AttemptResult"];
export type ResultQuestion = S["ResultQuestion"];
export type AttemptSummary = S["AttemptSummary"];

export interface RubricLevel {
  score: number;
  label: string;
  description?: string | null;
}

export interface RubricCriterion {
  id: string;
  name: string;
  description?: string | null;
  weight: number;
  max_score?: number | null;
  levels?: RubricLevel[];
}

/** One row of `Grade.rubric_breakdown` (human or AI). */
export interface BreakdownRow {
  criterion_id: string;
  name?: string | null;
  score: number;
  max: number;
  weight?: number;
  comment?: string | null;
  evidence?: string[] | null;
}

export interface EvidenceItem {
  id: string;
  label: string;
  type: string;
  required?: boolean;
}

export interface StructuredField {
  id: string;
  label: string;
  type?: string;
  help?: string | null;
  required?: boolean;
}

/** `AttemptAnswer.ai_feedback` for AI-graded free-text quiz answers. */
export interface AnswerAIFeedback {
  score?: number;
  max?: number;
  feedback?: string;
  strengths?: string[];
  improvements?: string[];
  evidence?: string[];
  confidence?: number;
  model?: string;
  injection_flagged?: boolean;
}

/** Mirrors the API: an explicit `max_score` wins, else the highest level score, else 10. */
export const criterionMax = (c: RubricCriterion): number => {
  if (Number(c.max_score)) return Number(c.max_score);
  const levels = c.levels ?? [];
  if (levels.length) return Math.max(...levels.map((l) => Number(l.score) || 0));
  return 10;
};

/** AI grades are stored to 1 dp and rubric totals to 2 dp; the API treats ≤ 0.05 as agreement (AI_AGREEMENT_TOLERANCE). */
export const AI_AGREEMENT_TOLERANCE = 0.05 + 1e-9;

/** Same weighting as the API (`logic.score_rubric`): Σ weight/Σweights × score/max × 100, rounded to 2dp. */
export function weightedTotal(criteria: RubricCriterion[], scores: Record<string, number | null | undefined>): number | null {
  if (!criteria.length) return null;
  const totalWeight = criteria.reduce((a, c) => a + (Number(c.weight) || 0), 0) || 100;
  let pct = 0;
  for (const c of criteria) {
    const s = scores[c.id];
    if (s === null || s === undefined || Number.isNaN(s)) return null;
    const max = criterionMax(c);
    pct += ((Number(c.weight) || 0) / totalWeight) * (s / max) * 100;
  }
  return Math.round(pct * 100) / 100;
}

/** Partial total for display while not every criterion is scored. */
export function partialTotal(criteria: RubricCriterion[], scores: Record<string, number | null | undefined>): number {
  const totalWeight = criteria.reduce((a, c) => a + (Number(c.weight) || 0), 0) || 100;
  let pct = 0;
  for (const c of criteria) {
    const s = scores[c.id];
    if (s === null || s === undefined || Number.isNaN(s)) continue;
    pct += ((Number(c.weight) || 0) / totalWeight) * (s / criterionMax(c)) * 100;
  }
  return Math.round(pct * 100) / 100;
}

/** Percentage of a grade (mirrors the API's `_pct`). */
export function gradePct(g: Pick<GradeOut, "score" | "max_score">): number {
  if (g.max_score && g.max_score !== 100) return Math.round((g.score / g.max_score) * 10000) / 100;
  return Math.round(g.score * 100) / 100;
}

export const QUEUE_TABS = [
  { id: "needs_review", label: "Needs review", status: undefined, hint: "Everything awaiting a human decision" },
  { id: "ai_recommended", label: "AI recommended", status: "ai_graded", hint: "AI has scored — confirm or override" },
  { id: "under_review", label: "Under review", status: "under_review", hint: "Picked up for review" },
  { id: "graded", label: "Graded", status: "graded", hint: "Final grades (re-grade with a reason)" },
  { id: "quiz", label: "Quiz answers", status: undefined, hint: "Free-text answers awaiting manual marks" },
] as const;

export type QueueTabId = (typeof QUEUE_TABS)[number]["id"];

export const GRADING_MODE_LABEL: Record<string, string> = {
  auto: "Auto",
  manual: "Manual",
  ai_assisted: "AI-assisted",
  ai_recommend_human_final: "AI recommends · human final",
};

export const SUBMISSION_STATUS: Record<string, { label: string; tone: "neutral" | "info" | "success" | "warning" | "danger" | "violet" | "brand" }> = {
  draft: { label: "Draft", tone: "neutral" },
  submitted: { label: "Submitted", tone: "info" },
  ai_grading: { label: "AI grading", tone: "brand" },
  ai_graded: { label: "AI recommended", tone: "violet" },
  under_review: { label: "Under review", tone: "warning" },
  graded: { label: "Graded", tone: "success" },
  returned: { label: "Returned", tone: "danger" },
};

/** SLA colouring for waiting time (hours). */
export function slaTone(submittedAt: string | null | undefined, now = Date.now()) {
  if (!submittedAt) return { tone: "neutral" as const, label: "—", hours: 0 };
  const hours = Math.max(0, (now - new Date(submittedAt).getTime()) / 3_600_000);
  const label = hours < 1 ? `${Math.max(1, Math.round(hours * 60))}m` : hours < 48 ? `${Math.round(hours)}h` : `${Math.round(hours / 24)}d`;
  const tone = hours < 24 ? ("success" as const) : hours < 72 ? ("warning" as const) : ("danger" as const);
  return { tone, label, hours };
}

export const gk = {
  all: ["grading"] as const,
  queue: (params: Record<string, unknown>) => ["grading", "queue", params] as const,
  count: (params: Record<string, unknown>) => ["grading", "count", params] as const,
  quiz: (params: Record<string, unknown>) => ["grading", "quiz-queue", params] as const,
  detail: (id: string) => ["grading", "detail", id] as const,
  attempt: (id: string) => ["grading", "attempt", id] as const,
  member: (id: string) => ["users", "member", id] as const,
  assignments: ["grading", "assignments-filter"] as const,
  courses: ["grading", "courses-filter"] as const,
};
