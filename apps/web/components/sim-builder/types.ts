/**
 * Simulation definition + builder graph types (mirrors packages/simulation-engine/simulation_engine/schema.py
 * and graph.py). Definitions are free-form JSON on the API, so these are hand-written.
 */
import type { components } from "@praxis/types/openapi";

type S = components["schemas"];
export type SimulationOut = S["SimulationOut"];
export type TemplateOut = S["TemplateOut"];
export type ValidationOut = S["ValidationOut"];
export type ValidationIssue = S["ValidationIssue"];
export type DraftOut = S["DraftOut"];
export type GraphOut = S["GraphOut"];
export type AIBuildOut = S["AIBuildOut"];
export type PublishOut = S["app__modules__simulations__schemas__PublishOut"];
export type VersionOut = S["app__modules__simulations__schemas__VersionOut"];
export type SessionSummary = S["SessionSummary"];
export type ReplayOut = S["ReplayOut"];

/** JSON-logic condition (`null` = always). */
export type Condition = unknown;

export type Classification = "correct" | "neutral" | "incorrect" | "critical";
export type ActionKind = "ask" | "command" | "inspect" | "select" | "submit" | "document" | "escalate";
export type InputType = "none" | "free_text" | "command" | "choice";

export interface Problem {
  id: string;
  text: string;
  severity?: "low" | "medium" | "high" | "critical";
}

export interface SimEffect {
  set?: Record<string, unknown> | null;
  inc?: Record<string, number> | null;
  reveal?: string[] | null;
  add_problem?: Problem | null;
  remove_problem?: string | null;
  transition?: string | null;
  trigger_event?: string | null;
  complete?: "success" | "failure" | "escalated" | null;
}

export interface SimOutput {
  text: string;
  when?: Condition;
  format?: "text" | "terminal" | "markdown";
  panel?: string | null;
}

export interface SimMessage {
  character?: string | null;
  text: string;
  when?: Condition;
}

export interface OutcomeSpec {
  effects?: SimEffect[];
  score?: Record<string, number> | null;
  classification?: Classification | null;
  feedback?: string | null;
  outputs?: SimOutput[] | null;
  messages?: SimMessage[];
  time_cost?: number | null;
}

export interface Choice {
  id: string;
  label: string;
}

export interface InputSpec {
  type?: InputType;
  intents?: string[];
  patterns?: string[];
  choices?: Choice[];
  placeholder?: string;
  min_length?: number;
}

export interface RepeatPolicy {
  mode?: "diminish" | "allow" | "penalize" | "block";
  free_repeats?: number;
  penalty?: Record<string, number>;
  message?: string;
}

export interface SimAction extends OutcomeSpec {
  id: string;
  tool: string;
  label: string;
  kind?: ActionKind;
  description?: string;
  character?: string | null;
  input?: InputSpec;
  preconditions?: Condition;
  precondition_message?: string;
  phases?: string[];
  branches?: SimBranch[];
  repeat?: RepeatPolicy | null;
  listed?: boolean | null;
  hint?: string;
  tags?: string[];
}

export interface SimBranch extends OutcomeSpec {
  id?: string | null;
  when?: Condition;
}

export interface EventTrigger {
  type: "time" | "condition" | "after_action";
  at_minutes?: number | null;
  condition?: Condition;
  action?: string | null;
}

export interface SimEvent extends OutcomeSpec {
  id: string;
  title?: string;
  description?: string;
  trigger: EventTrigger;
  once?: boolean;
  max_fires?: number | null;
  notify?: string;
}

export interface AutoAdvance {
  to: string;
  when: Condition;
}

export interface SimPhase {
  id: string;
  name: string;
  description?: string;
  transitions?: string[];
  auto_advance?: AutoAdvance[];
  terminal?: boolean;
}

export interface Meta {
  title: string;
  description?: string;
  industry?: string;
  environment_type?: string;
  difficulty?: string;
  estimated_minutes?: number;
  briefing?: string;
  learner_role?: string;
  objectives?: string[];
  tags?: string[];
}

export interface PanelVariant {
  when?: Condition;
  data?: Record<string, unknown>;
}

export interface Panel {
  id: string;
  type: string;
  title: string;
  data?: Record<string, unknown>;
  visible_when?: Condition;
  variants?: PanelVariant[];
}

export interface Tool {
  id: string;
  name: string;
  panel?: string | null;
  description?: string;
  icon?: string | null;
  prompt?: string;
  unknown_input_output?: string;
  visible_when?: Condition;
}

export interface Fact {
  id: string;
  text: string;
  intents?: string[];
  when?: Condition;
  auto_reveal?: boolean;
}

export interface Character {
  id: string;
  name: string;
  role?: string;
  persona?: string;
  avatar?: string | null;
  tone?: string;
  facts?: Fact[];
  fallback_reply?: string;
  patience_var?: string | null;
  patience_decay_per_minute?: number;
}

export interface Intent {
  id: string;
  description?: string;
  patterns?: string[];
  examples?: string[];
}

export interface VariableSpec {
  type?: "bool" | "int" | "float" | "str" | "list" | "dict" | "any";
  initial?: unknown;
  visibility?: "public" | "internal" | "secret";
  label?: string;
  description?: string;
  pool?: unknown[] | null;
  min?: number | null;
  max?: number | null;
}

export interface Dimension {
  id: string;
  name: string;
  weight: number;
  max_points?: number;
  baseline?: "zero" | "full";
  description?: string;
}

export interface BandSpec {
  name: string;
  min: number;
}

export interface Scoring {
  dimensions: Dimension[];
  efficiency?: { dimension?: string; target_minutes: number; max_minutes: number; require_success?: boolean } | null;
  process?: { dimension?: string; required_order?: string[]; skip_penalty?: number } | null;
  bands?: BandSpec[];
  pass_mark?: number;
  critical_cap?: number | null;
  require_completion?: boolean;
}

export interface Completion {
  success?: Condition;
  failure?: Condition;
  max_sim_minutes?: number | null;
  max_actions?: number | null;
}

export interface FeedbackRule {
  id: string;
  when: Condition;
  type: "strength" | "improvement" | "missed_step" | "tip";
  text: string;
  priority?: number;
}

export interface Settings {
  unknown_input?: Record<string, unknown>;
  repeat?: RepeatPolicy;
  show_feedback?: boolean;
  show_feedback_when_graded?: boolean;
  ai_character_voice?: boolean;
  session_timeout_minutes?: number;
}

export interface SimDefinition {
  schema_version?: string;
  key?: string | null;
  meta: Meta;
  environment?: { layout?: string; panels?: Panel[] };
  tools?: Tool[];
  characters?: Character[];
  intents?: Intent[];
  synonyms?: Record<string, string[]>;
  phases?: SimPhase[];
  initial_phase?: string;
  variables?: Record<string, VariableSpec>;
  variations?: { id: string; label?: string; weight?: number; set?: Record<string, unknown> }[];
  opening_messages?: SimMessage[];
  actions?: SimAction[];
  events?: SimEvent[];
  scoring: Scoring;
  completion?: Completion;
  feedback_rules?: FeedbackRule[];
  settings?: Settings;
}

/* ------------------------------------------------------------------ builder graph */

export type SimNodeType = "phase" | "action" | "branch" | "event";
export type SimEdgeKind = "transition" | "contains" | "branch" | "effect_transition" | "triggers";

export interface GraphNodeJson {
  id: string;
  type: SimNodeType;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface GraphEdgeJson {
  id: string;
  source: string;
  target: string;
  type: SimEdgeKind;
  data?: Record<string, unknown> | null;
}

export interface BuilderGraph {
  version: number;
  initial_phase: string;
  nodes: GraphNodeJson[];
  edges: GraphEdgeJson[];
}

/** Context passed to editors: ids that conditions/effects can reference. */
export interface RefContext {
  variables: { id: string; type?: string; visibility?: string; label?: string }[];
  phases: { id: string; name: string }[];
  actions: { id: string; label: string }[];
  events: { id: string; title: string }[];
  facts: { id: string; text: string; character: string }[];
  characters: { id: string; name: string }[];
  tools: { id: string; name: string }[];
  panels: { id: string; title: string }[];
  dimensions: { id: string; name: string }[];
  intents: { id: string }[];
  problems: string[];
}

export const sk = {
  all: ["simulations"] as const,
  list: (p: Record<string, unknown>) => ["simulations", "list", p] as const,
  templates: ["simulations", "templates"] as const,
  detail: (id: string) => ["simulations", "detail", id] as const,
  draft: (id: string) => ["simulations", "draft", id] as const,
  graph: (id: string) => ["simulations", "graph", id] as const,
  versions: (id: string) => ["simulations", "versions", id] as const,
  version: (id: string, v: number) => ["simulations", "version", id, v] as const,
  analytics: (id: string) => ["simulations", "analytics", id] as const,
  sessions: (id: string, p: Record<string, unknown>) => ["simulations", "sessions", id, p] as const,
  sessionsCount: (id: string) => ["simulations", "sessions-count", id] as const,
  replay: (id: string) => ["simulation-sessions", "replay", id] as const,
};
