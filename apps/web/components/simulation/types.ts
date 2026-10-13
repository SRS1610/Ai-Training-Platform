/**
 * Simulation player types. Top-level shapes come from the generated OpenAPI schema; the engine's
 * `view` / `outcome` / `result` dicts are typed here from `simulation_engine.learner_view` /
 * `public_outcome` / `scoring.finish` (packages/simulation-engine).
 */
import type { components } from "@praxis/types/openapi";

type S = components["schemas"];

export type Simulation = S["SimulationOut"];
export type SessionSummary = S["SessionSummary"];
export type Page<T> = { items: T[]; total: number; page: number; page_size: number };

export type InputType = "none" | "free_text" | "command" | "choice";
export type ActionKind = "ask" | "command" | "inspect" | "select" | "submit" | "document" | "escalate" | string;
export type Classification = "correct" | "neutral" | "incorrect" | "critical";

export interface ViewAction {
  id: string;
  tool: string | null;
  label: string;
  kind: ActionKind;
  description: string;
  character: string | null;
  input: { type: InputType; placeholder: string; min_length: number; choices: { id: string; label: string }[] };
}

export interface ViewPanel {
  id: string;
  type: string;
  title: string;
  data: Record<string, unknown>;
}

export interface ViewTool {
  id: string;
  name: string;
  panel: string | null;
  description: string;
  icon: string | null;
  prompt: string;
  accepts: string[];
}

export interface ViewCharacter {
  id: string;
  name: string;
  role: string;
  avatar: string | null;
  patience: number | null;
}

export interface TranscriptEntry {
  seq: number;
  minutes: number;
  kind: "message" | "notice" | "output" | "command" | "action" | "note" | string;
  from: string;
  name: string | null;
  text: string;
  tool?: string | null;
  panel?: string | null;
  format?: "text" | "terminal" | "markdown";
  to?: string | null;
  /** false for a rejected attempt kept for the record (e.g. a chat message matching a step that isn't
   * possible yet); it consumed no sequence number, score or time. Absent on accepted entries. */
  accepted?: boolean;
  reason?: string | null;
  label?: string | null;
}

export interface Fact {
  id: string;
  character: string;
  character_name: string;
  text: string;
}

export interface Problem {
  id: string;
  text: string;
  severity: "low" | "medium" | "high" | "critical" | string;
}

export interface PhaseItem {
  id: string;
  name: string;
  status: "done" | "current" | "upcoming";
}

export interface SessionView {
  schema_version: string;
  meta: {
    title: string;
    description: string;
    industry: string | null;
    environment_type: string | null;
    difficulty: string | null;
    estimated_minutes: number | null;
    briefing: string;
    learner_role: string;
    objectives: string[];
  };
  phase: { id: string; name: string; description: string };
  phases: PhaseItem[];
  panels: ViewPanel[];
  tools: ViewTool[];
  characters: ViewCharacter[];
  revealed_facts: Fact[];
  variables: Record<string, unknown>;
  problems: Problem[];
  transcript: TranscriptEntry[];
  available_actions: ViewAction[];
  sim_minutes: number;
  target_minutes: number | null;
  action_count: number;
  ended: boolean;
  end_reason: string | null;
}

export interface Dimension {
  id: string;
  name: string;
  weight: number;
  raw: number;
  max_points: number;
  percent: number;
  score: number;
}

export interface FeedbackItem {
  id?: string;
  text: string;
  type?: string;
  priority?: number;
}

export interface ActionFeedbackItem {
  action_id?: string;
  label: string;
  feedback?: string;
  minutes?: number | null;
}

export interface TimelineItem {
  seq: number;
  type: string;
  label: string;
  classification?: Classification | string;
  minutes: number;
  phase?: string | null;
}

export interface ResultFeedback {
  summary?: string;
  strengths?: FeedbackItem[];
  improvements?: FeedbackItem[];
  missed_steps?: FeedbackItem[];
  tips?: FeedbackItem[];
  critical_actions?: ActionFeedbackItem[];
  incorrect_actions?: ActionFeedbackItem[];
  timeline?: TimelineItem[];
}

export interface SimResult {
  session_id: string;
  simulation_id: string;
  status: string;
  attempt_number: number;
  total_score: number | null;
  band: string | null;
  passed: boolean | null;
  dimensions: Dimension[];
  feedback: ResultFeedback;
  narrative: string | null;
  end_reason: string | null;
  sim_minutes: number;
  target_minutes: number | null;
  started_at: string;
  completed_at: string | null;
}

export interface SimSession {
  id: string;
  simulation_id: string;
  scenario_id: string;
  status: string;
  attempt_number: number;
  is_graded: boolean;
  show_feedback: boolean;
  started_at: string;
  completed_at: string | null;
  expires_at: string | null;
  phase: string;
  sim_minutes: number;
  action_count: number;
  next_seq: number;
  resumed: boolean;
  view: SessionView;
  result: Record<string, unknown> | null;
}

export interface OutcomeOutput {
  tool: string | null;
  panel: string | null;
  format: "text" | "terminal" | "markdown";
  text: string;
}

export interface Outcome {
  seq: number;
  accepted: boolean;
  matched: "action" | "fact" | "unknown" | null;
  action_id: string | null;
  label: string | null;
  tool: string | null;
  kind: string | null;
  character: string | null;
  outputs: OutcomeOutput[];
  messages: { from: string; name: string | null; text: string }[];
  events: { id: string; title: string | null; notify: string }[];
  revealed_facts: Fact[];
  problems_added: Problem[];
  problems_removed: string[];
  phase_before: string;
  phase_after: string;
  phase_changed: boolean;
  time_cost: number;
  sim_minutes: number;
  ended: boolean;
  end_reason: string | null;
  notices: string[];
  reason: string | null;
  message: string | null;
  variables_changed: string[];
  /** Practice mode only. */
  classification?: Classification;
  feedback?: string;
  hint?: string;
  score_deltas?: Record<string, number>;
}

export interface StepOut {
  session_id: string;
  seq: number;
  replayed: boolean;
  accepted: boolean;
  outcome: Outcome;
  reply: { from: string; name: string | null; text: string; ai_phrased: boolean } | null;
  status: string;
  phase: string;
  sim_minutes: number;
  ended: boolean;
  next_seq: number;
  view: SessionView;
  result: Record<string, unknown> | null;
}

export interface ReplayAction {
  seq: number;
  action_id: string;
  tool: string | null;
  input: { action_id?: string | null; tool?: string | null; character?: string | null; input?: unknown };
  outcome: Outcome;
  reply: { text: string; name?: string | null } | null;
  phase_before: string;
  phase_after: string;
  classification: Classification | string | null;
  score_deltas: Record<string, number> | null;
  created_at: string;
}

export interface Replay {
  session: SessionSummary;
  actions: ReplayAction[];
  states: { seq: number; phase: string; reason: string; created_at: string; variables: Record<string, unknown> }[];
  transcript: TranscriptEntry[];
}

/** Learner-safe pre-start briefing (GET /simulations/{id}/briefing). */
export interface SimBriefing {
  simulation_id: string;
  version: number;
  title: string;
  description: string;
  industry: string;
  environment_type: string;
  difficulty: string;
  estimated_minutes: number;
  briefing: string;
  learner_role: string;
  objectives: string[];
  tags: string[];
  phases: string[];
  characters: { name: string; role: string }[];
  tools: { name: string; description: string; icon: string | null }[];
  dimensions: { id: string; name: string; weight: number; description: string }[];
  bands: { name: string; min: number }[];
  pass_mark: number;
  critical_cap: number | null;
  target_minutes: number | null;
  max_minutes: number | null;
}
