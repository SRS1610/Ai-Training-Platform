/**
 * Types for the instructor authoring area, mirroring the FastAPI schemas in
 * apps/api/app/modules/{courses,assessments,assignments,generations,knowledge,skills,files}.
 */

export type UUID = string;

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

/* ------------------------------------------------------------------ courses */

export type CourseStatus = "draft" | "in_review" | "published" | "archived";
export type Difficulty = "beginner" | "intermediate" | "advanced" | "expert";

export interface SkillRef {
  id: UUID;
  name: string;
}

export interface Skill {
  id: UUID;
  name: string;
  category: string | null;
  description: string | null;
  created_at: string;
}

export interface Course {
  id: UUID;
  slug: string;
  title: string;
  subtitle: string | null;
  description: string;
  category: string | null;
  difficulty: string;
  duration_minutes: number;
  learning_objectives: string[];
  prerequisites: string[];
  target_audience: string | null;
  tags: string[];
  thumbnail_url: string | null;
  status: CourseStatus | string;
  visibility: string;
  instructor_id: UUID | null;
  created_by: UUID | null;
  current_version_id: UUID | null;
  current_version_number: number | null;
  draft_version_number: number;
  certificate_enabled: boolean;
  pass_threshold: number;
  ai_tutor_enabled: boolean;
  ai_generated: boolean;
  sequential: boolean;
  skills: SkillRef[];
  module_count: number;
  lesson_count: number;
  enrolment_count: number;
  created_at: string;
  updated_at: string;
}

export interface CourseInput {
  title?: string;
  subtitle?: string | null;
  slug?: string | null;
  description?: string | null;
  category?: string | null;
  difficulty?: Difficulty | null;
  duration_minutes?: number | null;
  learning_objectives?: string[] | null;
  prerequisites?: string[] | null;
  target_audience?: string | null;
  tags?: string[] | null;
  thumbnail_url?: string | null;
  visibility?: "organisation" | "public" | null;
  certificate_enabled?: boolean | null;
  pass_threshold?: number | null;
  ai_tutor_enabled?: boolean | null;
  sequential?: boolean | null;
  skill_ids?: UUID[] | null;
  status?: "draft" | "in_review";
}

export interface LinkedItem {
  type: "assessment" | "assignment" | "simulation" | string;
  id: UUID;
  title: string;
  status?: string | null;
}

export interface Activity {
  id: UUID;
  lesson_id: UUID;
  activity_type: string;
  title: string | null;
  content: Record<string, unknown>;
  position: number;
}

export type LessonContent = Record<string, unknown>;

export interface Lesson {
  id: UUID;
  course_id: UUID;
  module_id: UUID;
  title: string;
  summary: string | null;
  lesson_type: string;
  content: LessonContent;
  duration_minutes: number;
  position: number;
  is_required: boolean;
  is_preview: boolean;
  assessment_id: UUID | null;
  assignment_id: UUID | null;
  simulation_id: UUID | null;
  skill_ids: UUID[];
  ai_generated: boolean;
  linked?: LinkedItem | null;
  activities: Activity[];
}

export interface LessonPatch {
  title?: string;
  summary?: string | null;
  lesson_type?: string;
  content?: LessonContent;
  duration_minutes?: number;
  position?: number;
  module_id?: UUID;
  is_required?: boolean;
  is_preview?: boolean;
  assessment_id?: UUID | null;
  assignment_id?: UUID | null;
  simulation_id?: UUID | null;
  skill_ids?: UUID[];
}

export interface CourseModule {
  id: UUID;
  course_id: UUID;
  title: string;
  description: string | null;
  position: number;
}

export interface StructureModule extends CourseModule {
  lessons: Lesson[];
}

export interface Structure {
  course: Course;
  modules: StructureModule[];
  has_unpublished_changes: boolean;
}

export interface VersionSummary {
  id: UUID;
  version_number: number;
  status: string;
  changelog: string | null;
  published_by: UUID | null;
  published_by_name: string | null;
  published_at: string | null;
  stats: { module_count?: number; lesson_count?: number; required_lesson_count?: number; duration_minutes?: number };
}

export interface SnapshotLesson {
  id: string;
  module_id: string;
  title: string;
  summary: string | null;
  lesson_type: string;
  content: LessonContent;
  duration_minutes: number;
  position: number;
  is_required: boolean;
  is_preview: boolean;
  linked: LinkedItem | null;
  activities: { id: string; activity_type: string; title: string | null; content: Record<string, unknown>; position: number }[];
}

export interface Snapshot {
  schema_version: number;
  course: Partial<Course> & { title: string };
  modules: { id: string; title: string; description: string | null; position: number; lessons: SnapshotLesson[] }[];
  stats: VersionSummary["stats"];
}

export interface VersionDetail extends VersionSummary {
  snapshot: Snapshot;
}

export interface DiffLesson {
  id: string;
  title: string;
  lesson_type: string | null;
  module_id: string;
  module_title: string;
  fields?: string[];
  from_module_id?: string;
}

export interface VersionDiff {
  from: number;
  to: number | "draft";
  lessons_added: DiffLesson[];
  lessons_removed: DiffLesson[];
  lessons_changed: DiffLesson[];
  lessons_moved: DiffLesson[];
  modules_added: { id: string; title: string }[];
  modules_removed: { id: string; title: string }[];
  modules_renamed: { id: string; from: string; to: string }[];
  course_fields_changed: string[];
  summary: { added: number; removed: number; changed: number; moved: number };
}

export interface PublishProblem {
  code: string;
  message: string;
  lesson_id?: string;
  lesson_title?: string;
}

export interface FileOut {
  id: UUID;
  owner_id: UUID | null;
  filename: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  purpose: string;
  scan_status: string;
  created_at: string;
  download_url: string;
}

/* ------------------------------------------------------------------ generations */

export type GenerationKind =
  | "course"
  | "module"
  | "lesson"
  | "quiz"
  | "assignment"
  | "rubric"
  | "flashcards"
  | "revision_notes"
  | "case_study"
  | "scenario";

export type GenerationStatus = "pending" | "running" | "completed" | "failed" | "approved" | "rejected" | "applied";

export interface GenerationInput {
  subject: string;
  audience?: string;
  difficulty?: string;
  objectives?: string[];
  duration?: string | number | null;
  industry?: string | null;
  format?: string | null;
  weeks?: number | null;
  course_id?: string | null;
  lesson_id?: string | null;
  module_id?: string | null;
  question_count?: number;
  question_types?: string[];
  feedback?: string;
}

export interface GenerationSummary {
  id: UUID;
  kind: GenerationKind | string;
  status: GenerationStatus | string;
  version: number;
  parent_id: UUID | null;
  course_id: UUID | null;
  requested_by: UUID | null;
  reviewed_by: UUID | null;
  reviewed_at: string | null;
  applied_entity_type: string | null;
  applied_entity_id: UUID | null;
  provider: string | null;
  model: string | null;
  cost_usd: number;
  error: string | null;
  created_at: string;
  updated_at: string;
  title: string | null;
}

export interface Generation extends GenerationSummary {
  input: GenerationInput & Record<string, unknown>;
  output: Record<string, unknown> | null;
  edited_output: Record<string, unknown> | null;
  review_notes: string | null;
  tokens_in: number;
  tokens_out: number;
  safety: Record<string, unknown>;
  offline: boolean;
}

export interface ApplyOut {
  generation: Generation;
  entity_type: string;
  entity_id: UUID;
  created: Record<string, number>;
  link: string;
}

/* Generated output shapes (packages/ai/src/praxis_ai/generation.py) */

export interface GenChoice {
  id: string;
  text: string;
}
export interface GenQuestion {
  type: string;
  prompt: string;
  choices: GenChoice[];
  answer_key: Record<string, unknown>;
  explanation: string;
  difficulty: number;
  points: number;
  skills?: string[];
}
export interface GenQuiz {
  title: string;
  description: string;
  pass_percentage: number;
  questions: GenQuestion[];
}
export interface GenRubricLevel {
  score: number;
  label: string;
  description: string;
}
export interface GenRubricCriterion {
  id: string;
  name: string;
  description: string;
  weight: number;
  levels: GenRubricLevel[];
}
export interface GenRubric {
  title: string;
  description: string;
  total_points: number;
  criteria: GenRubricCriterion[];
}
export interface GenEvidence {
  id: string;
  label: string;
  type: string;
  required: boolean;
}
export interface GenAssignment {
  title: string;
  scenario: string;
  objective: string;
  instructions: string;
  required_evidence: GenEvidence[];
  expected_output: string;
  evaluation_criteria: string;
  passing_score: number;
  rubric: GenRubric;
}
export interface GenFlashcards {
  title: string;
  cards: { front: string; back: string }[];
}
export interface GenRevisionNotes {
  title: string;
  summary: string;
  sections: { heading: string; points: string[] }[];
  key_terms: { term: string; definition: string }[];
}
export interface GenCaseStudy {
  title: string;
  context: string;
  challenge: string;
  questions: string[];
  model_analysis: string;
}
export interface GenScenario {
  title: string;
  industry: string;
  environment_type: string;
  description: string;
  learner_role: string;
  objectives: string[];
  phases: string[];
  characters: { name: string; role: string; persona: string }[];
  hidden_root_cause: string;
  key_actions: string[];
  red_herrings: string[];
}
export interface GenLesson {
  title: string;
  summary: string;
  duration_minutes: number;
  body_markdown: string;
  examples: string[];
  key_points: string[];
  case_study: GenCaseStudy | null;
  knowledge_check: GenQuiz | null;
}
export interface GenModule {
  title: string;
  description: string;
  week: number | null;
  lessons: GenLesson[];
  quiz: GenQuiz | null;
}
export interface GenCourse {
  title: string;
  subtitle: string;
  description: string;
  audience: string;
  difficulty: string;
  duration_minutes: number;
  learning_objectives: string[];
  prerequisites: string[];
  modules: GenModule[];
  assignments: GenAssignment[];
  final_assessment: GenQuiz | null;
  flashcards: GenFlashcards | null;
  revision_notes: GenRevisionNotes | null;
  simulation_suggestion: GenScenario | null;
}

/* ------------------------------------------------------------------ assessments */

export type QuestionType =
  | "multiple_choice"
  | "multiple_select"
  | "true_false"
  | "short_answer"
  | "long_answer"
  | "matching"
  | "ordering"
  | "fill_blank"
  | "code"
  | "file_upload"
  | "scenario"
  | "decision_tree"
  | "practical_task"
  | "simulation";

export type GradingMode = "auto" | "manual" | "ai_assisted" | "ai_recommend_human_final";

export interface Bank {
  id: UUID;
  title: string;
  description: string | null;
  course_id: UUID | null;
  created_by: UUID | null;
  created_at: string;
  updated_at: string;
  question_count: number;
}

export interface Question {
  id: UUID;
  bank_id: UUID | null;
  question_type: QuestionType | string;
  prompt: string;
  options: Record<string, unknown>;
  answer_key: Record<string, unknown>;
  explanation: string | null;
  points: number;
  negative_points: number;
  difficulty: number;
  tags: string[];
  skill_ids: UUID[];
  rubric_id: UUID | null;
  version: number;
  status: "draft" | "active" | "retired" | string;
  ai_generated: boolean;
  created_at: string;
  updated_at: string;
}

export interface QuestionInput {
  bank_id?: UUID | null;
  question_type: QuestionType;
  prompt: string;
  options: Record<string, unknown>;
  answer_key: Record<string, unknown>;
  explanation?: string | null;
  points: number;
  negative_points: number;
  difficulty: number;
  tags: string[];
  skill_ids: UUID[];
  rubric_id?: UUID | null;
  status: "draft" | "active" | "retired";
}

export interface ItemFilters {
  difficulty?: number[];
  tags?: string[];
  question_types?: string[];
}

export interface ItemIn {
  question_id?: UUID | null;
  bank_id?: UUID | null;
  draw_count: number;
  filters: ItemFilters;
  weight: number;
}

export interface ItemOut extends ItemIn {
  id: UUID;
  position: number;
}

export type AssessmentKind = "quiz" | "final" | "practice" | "survey";

export interface Assessment {
  id: UUID;
  course_id: UUID | null;
  title: string;
  description: string | null;
  kind: AssessmentKind | string;
  time_limit_minutes: number | null;
  max_attempts: number | null;
  pass_percentage: number;
  shuffle_questions: boolean;
  shuffle_options: boolean;
  negative_marking: boolean;
  grading_mode: GradingMode | string;
  high_stakes: boolean;
  show_feedback: "after_submit" | "after_close" | "never" | string;
  status: "draft" | "published" | "archived" | string;
  weight_in_course: number;
  created_by: UUID | null;
  created_at: string;
  updated_at: string;
}

export interface AssessmentDetail extends Assessment {
  items: ItemOut[];
  question_count: number;
}

export interface QuestionStat {
  question_id: string;
  prompt: string;
  question_type: string;
  responses: number;
  answered: number;
  mean_score_pct: number | null;
  correct_rate: number | null;
  discrimination: number | null;
  choice_distribution: Record<string, number>;
}

export interface AssessmentStats {
  assessment_id: UUID;
  attempts: number;
  graded_attempts: number;
  mean_percentage: number | null;
  pass_rate: number | null;
  questions: QuestionStat[];
}

/* ------------------------------------------------------------------ assignments & rubrics */

export interface RubricLevel {
  score: number;
  label: string;
  description?: string | null;
}

export interface RubricCriterion {
  id?: string | null;
  name: string;
  description?: string | null;
  weight: number;
  max_score?: number | null;
  levels: RubricLevel[];
}

export interface Rubric {
  id: UUID;
  title: string;
  description: string | null;
  criteria: RubricCriterion[];
  total_points: number;
  ai_generated: boolean;
  created_by: UUID | null;
  created_at: string;
  updated_at: string;
}

export type EvidenceType = "text" | "file" | "screenshot" | "video" | "audio" | "code" | "document" | "structured";

export interface EvidenceItem {
  id: string;
  label: string;
  type: EvidenceType;
  required: boolean;
}

export interface StructuredField {
  id: string;
  label: string;
  type: string;
  help?: string | null;
  required: boolean;
}

export interface AssignmentResource {
  title: string;
  url?: string | null;
  file_id?: UUID | null;
}

export interface Assignment {
  id: UUID;
  course_id: UUID | null;
  title: string;
  scenario: string;
  objective: string;
  instructions: string;
  required_evidence: EvidenceItem[];
  structured_fields: StructuredField[];
  resources: AssignmentResource[];
  evaluation_criteria: string | null;
  rubric_id: UUID | null;
  time_limit_minutes: number | null;
  due_days_after_enrolment: number | null;
  passing_score: number;
  grading_mode: GradingMode | string;
  high_stakes: boolean;
  max_submissions: number | null;
  allowed_file_types: string[];
  status: "draft" | "published" | "archived" | string;
  skill_ids: UUID[];
  created_at: string;
  updated_at: string;
  rubric?: Rubric | null;
  expected_output?: string | null;
  created_by?: UUID | null;
  ai_generated?: boolean;
}

/* ------------------------------------------------------------------ knowledge */

export type DocStatus = "pending" | "processing" | "ready" | "failed";

export interface KnowledgeDocument {
  id: UUID;
  title: string;
  course_id: UUID | null;
  source_type: string;
  source_url: string | null;
  file_id: UUID | null;
  category: string | null;
  status: DocStatus | string;
  approved: boolean;
  approved_by: UUID | null;
  approved_at: string | null;
  chunk_count: number;
  char_count: number;
  error: string | null;
  created_by: UUID | null;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeChunk {
  id: UUID;
  document_id: UUID;
  chunk_index: number;
  heading: string | null;
  content: string;
  token_count: number;
  embedding_model: string | null;
  course_id: UUID | null;
}

export interface SearchHit {
  chunk_id: UUID;
  document_id: UUID;
  title: string;
  heading: string | null;
  snippet: string;
  score: number;
  source: string;
  course_id: UUID | null;
}

export interface SearchOut {
  query: string;
  results: SearchHit[];
  embedding_model: string;
}

/* ------------------------------------------------------------------ simulations (for linking) */

export interface SimulationLite {
  id: UUID;
  title: string;
  description: string;
  industry: string;
  environment_type: string;
  difficulty: string;
  estimated_minutes: number;
  status: string;
  course_id: UUID | null;
}
