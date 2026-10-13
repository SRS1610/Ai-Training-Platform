/**
 * Learner-experience API types. Aliases over the generated OpenAPI schema (`@praxis/types/openapi`), with
 * the loosely-typed JSON blobs (lesson content, outline, question options) refined to what the API stores.
 */
import type { components } from "@praxis/types/openapi";

type S = components["schemas"];

/* ------------------------------------------------------------------ catalog */

export type EnrolmentState = S["EnrolmentState"];
export interface SkillChip {
  id: string;
  name: string;
}
export type CatalogItem = Omit<S["CatalogItem"], "skills" | "tags"> & { skills: SkillChip[]; tags: string[] };

export interface CatalogOutlineLesson {
  id: string;
  title: string;
  lesson_type: string;
  duration_minutes: number;
  is_preview: boolean;
  is_required: boolean;
}
export interface CatalogOutlineModule {
  id: string;
  title: string;
  description: string | null;
  lessons: CatalogOutlineLesson[];
}
export interface CatalogInstructor {
  id: string;
  full_name: string;
  avatar_url?: string | null;
  job_title?: string | null;
}
export type CatalogDetail = Omit<S["CatalogDetail"], "skills" | "tags" | "outline" | "learning_objectives" | "prerequisites"> & {
  skills: SkillChip[];
  tags: string[];
  learning_objectives: string[];
  prerequisites: string[];
  outline: CatalogOutlineModule[];
  /** Course instructor (added to `GET /catalog/{id}`; optional until the OpenAPI types are regenerated). */
  instructor?: CatalogInstructor | null;
};
export type CategoryCount = S["CategoryCount"];
export type SkillOut = S["app__modules__skills__schemas__SkillOut"];

/* ------------------------------------------------------------------ enrolments + player */

export type MyEnrolment = S["MyEnrolmentOut"];
export type EnrolmentOut = S["EnrolmentOut"];
export type LessonState = S["LessonState"];
export type NextLesson = S["NextLesson"];

export interface LinkedInfo {
  type: "assessment" | "assignment" | "simulation" | string;
  id: string;
  title: string;
  kind?: string;
  pass_percentage?: number | null;
  passing_score?: number | null;
  time_limit_minutes?: number | null;
  max_attempts?: number | null;
  [key: string]: unknown;
}

export type OutlineLesson = Omit<S["OutlineLesson"], "linked"> & { linked?: LinkedInfo | null };
export type OutlineModule = Omit<S["OutlineModule"], "lessons"> & { lessons: OutlineLesson[] };

export interface SnapshotCourse {
  id?: string;
  title?: string;
  subtitle?: string | null;
  description?: string | null;
  category?: string | null;
  difficulty?: string | null;
  duration_minutes?: number;
  learning_objectives?: string[];
  thumbnail_url?: string | null;
  sequential?: boolean;
  certificate_enabled?: boolean;
  pass_threshold?: number;
  ai_tutor_enabled?: boolean;
  skills?: SkillChip[];
}

export type LearnCourse = Omit<S["LearnCourseOut"], "modules" | "course"> & {
  modules: OutlineModule[];
  course: SnapshotCourse;
};

export interface Activity {
  id: string;
  activity_type: string;
  title: string | null;
  content: Record<string, unknown>;
  position: number;
}

export interface LessonPayload {
  id: string;
  module_id?: string;
  title: string;
  summary?: string | null;
  lesson_type: string;
  content: Record<string, unknown>;
  duration_minutes?: number;
  is_required?: boolean;
  is_preview?: boolean;
  assessment_id?: string | null;
  assignment_id?: string | null;
  simulation_id?: string | null;
  linked?: LinkedInfo | null;
  activities?: Activity[];
}

export type LearnLesson = Omit<S["LearnLessonOut"], "lesson" | "module"> & {
  lesson: LessonPayload;
  module: { id: string; title: string };
};

export type ProgressOut = S["ProgressOut"];
export type CheckOut = S["CheckOut"];

/* ------------------------------------------------------------------ learning paths */

export type MyPath = S["MyPath"];
export type PathOut = S["PathOut"];
export type PathEnrolOut = S["PathEnrolOut"];

/* ------------------------------------------------------------------ assessments */

export type LearnerAssessment = S["LearnerAssessment"];
export type AttemptSummary = S["AttemptSummary"];
export type QuizOverview = S["Overview"];
export type AttemptQuestion = S["AttemptQuestion"];
export type Attempt = S["AttemptOut"];
export type AnswerSaved = S["AnswerSaved"];
export type AttemptResult = S["AttemptResult"];
export type ResultQuestion = S["ResultQuestion"];

/** Learner-answer payload for `PUT /attempts/{id}/answers/{qid}` (shape depends on the question type). */
export type AnswerResponse = Record<string, unknown>;

/* ------------------------------------------------------------------ assignments */

export interface EvidenceItem {
  id: string;
  label: string;
  type: "text" | "file" | "screenshot" | "video" | "audio" | "code" | "document" | "structured" | string;
  required?: boolean;
}
export interface StructuredField {
  id: string;
  label: string;
  type?: string;
  help?: string | null;
  required?: boolean;
}
export interface ResourceRef {
  title: string;
  url?: string | null;
  file_id?: string | null;
}
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
  levels?: RubricLevel[];
}
export type Rubric = Omit<S["RubricOut"], "criteria"> & { criteria: RubricCriterion[] };
export type LearnerAssignment = Omit<
  S["LearnerAssignmentOut"],
  "required_evidence" | "structured_fields" | "resources" | "rubric" | "allowed_file_types"
> & {
  required_evidence: EvidenceItem[];
  structured_fields: StructuredField[];
  resources: ResourceRef[];
  allowed_file_types: string[];
  rubric?: Rubric | null;
};
export type FileRef = S["FileRef"];
export type SubmissionVersion = S["app__modules__assignments__schemas__VersionOut"];
export interface RubricBreakdownRow {
  criterion_id?: string;
  name?: string;
  score: number;
  max: number;
  weight?: number;
  comment?: string | null;
  evidence?: unknown;
}
export type Grade = S["GradeOut"];
export type Submission = S["SubmissionOut"];
export type SubmitResult = S["SubmitResult"];
export type FileOut = S["FileOut"];

/* ------------------------------------------------------------------ certificates */

export type Certificate = S["CertificateOut"];
export type Verification = S["VerificationOut"];

/* ------------------------------------------------------------------ skills + recommendations */

export type MySkills = S["MySkillsOut"];
export type MySkill = S["MySkill"];
export type MyCompetency = S["MyCompetency"];
export type RecommendationOut = S["RecommendationOut"];
export type MyRecommendations = S["MyRecommendations"];

export interface PlanActivity {
  title: string;
  type: string;
  target_id?: string | null;
  reason?: string;
}
export interface PlanStep {
  week: number;
  focus: string;
  activities: PlanActivity[];
}
export interface LearningPlan {
  summary: string;
  strengths: string[];
  focus_areas: string[];
  difficulty_adjustment: Record<string, string>;
  steps: PlanStep[];
  generated_by: string;
  model: string | null;
  offline: boolean;
  pace: string | null;
  avg_score: number | null;
}

export interface WeakArea {
  answered: number;
  incorrect: number;
  error_rate: number | null;
}
export interface LearnerAnalytics {
  summary: Record<string, number | null>;
  weak_areas: {
    by_tag: (WeakArea & { tag: string })[];
    by_skill: (WeakArea & { skill_id: string; skill: string })[];
    most_missed_questions: (WeakArea & { question_id: string; prompt: string | null })[];
  };
  simulations?: { by_dimension: { dimension: string; avg_score: number | null; sessions: number }[] };
  scores_over_time?: Record<string, unknown>[];
}

/* ------------------------------------------------------------------ gamification */

/** `department` = the viewer's own department (lets members scope the leaderboard without users.view). */
export type GamificationMe = S["GamificationMeOut"] & { department?: { id: string; name: string } | null };
export type Badge = S["BadgeOut"];
export type BadgeList = S["BadgeListOut"];
export type Leaderboard = S["LeaderboardOut"];
export type LeaderboardEntry = S["LeaderboardEntry"];
