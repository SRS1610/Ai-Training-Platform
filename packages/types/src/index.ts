/**
 * Hand-written Praxis API types.
 *
 * These mirror the FastAPI response models for the modules the web foundation depends on
 * (auth, me, dashboard, notifications, search, invitations). For everything else prefer the
 * generated schema: `import type { components } from "@praxis/types/openapi"` (run `pnpm gen:types`).
 */

export type UUID = string;
/** ISO-8601 datetime string. */
export type ISODateTime = string;
/** YYYY-MM-DD. */
export type ISODate = string;

/* ------------------------------------------------------------------ common */

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    request_id?: string;
  };
}

export interface ValidationErrorDetail {
  loc: (string | number)[];
  msg: string;
  type: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface PageQuery {
  page?: number;
  page_size?: number;
}

/* ------------------------------------------------------------------ permissions */

export const PERMISSIONS = [
  "users.view",
  "users.create",
  "users.edit",
  "users.delete",
  "roles.manage",
  "courses.view",
  "courses.create",
  "courses.edit",
  "courses.publish",
  "courses.delete",
  "lessons.manage",
  "assignments.manage",
  "simulations.manage",
  "assessments.manage",
  "enrolments.manage",
  "submissions.review",
  "certificates.issue",
  "analytics.view",
  "reports.export",
  "organisation.manage",
  "billing.manage",
  "ai.manage",
  "knowledge.manage",
  "audit.view",
  "api_keys.manage",
  "learning.access",
  "system.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type SystemRoleKey =
  | "org_admin"
  | "training_manager"
  | "instructor"
  | "sme"
  | "assessor"
  | "auditor"
  | "learner"
  | "super_admin";

/* ------------------------------------------------------------------ auth */

export interface RegisterIn {
  email: string;
  password: string;
  full_name: string;
  organisation_name?: string | null;
  accept_terms: boolean;
  marketing_opt_in?: boolean;
}

export interface LoginIn {
  email: string;
  password: string;
  device_label?: string | null;
}

export interface TokenOut {
  access_token: string;
  token_type: "bearer";
  expires_at: ISODateTime;
  refresh_token: string | null;
  csrf_token: string;
  user_id: UUID;
}

export interface LoginOut {
  mfa_required: boolean;
  mfa_token: string | null;
  tokens: TokenOut | null;
}

export interface MFAVerifyIn {
  mfa_token: string;
  code?: string | null;
  recovery_code?: string | null;
}

export interface MFASetupOut {
  secret: string;
  otpauth_uri: string;
  qr_svg: string;
}

export interface MFAEnableOut {
  recovery_codes: string[];
}

export interface PasswordChangeIn {
  current_password: string;
  new_password: string;
}

export interface AuthSession {
  id: UUID;
  user_agent: string | null;
  ip_address: string | null;
  device_label: string | null;
  auth_method: string;
  mfa_verified: boolean;
  created_at: ISODateTime;
  last_used_at: ISODateTime | null;
  expires_at: ISODateTime;
  revoked_at: ISODateTime | null;
  current: boolean;
}

export interface AuthProviders {
  password: boolean;
  google: boolean;
  microsoft: boolean;
  sso: boolean;
}

export interface SSODiscoverOut {
  sso_available: boolean;
  connection_id: UUID | null;
  name: string | null;
  enforce_sso: boolean;
}

export interface OAuthAuthorizeOut {
  authorize_url: string;
}

/* ------------------------------------------------------------------ me */

export interface OrgBranding {
  primary_color?: string;
  logo_url?: string;
  [key: string]: unknown;
}

export interface OrgSummary {
  id: UUID;
  name: string;
  slug: string;
  kind: "personal" | "business" | "enterprise" | "education" | string;
  logo_url: string | null;
  branding: OrgBranding;
  plan_code: string;
  roles: SystemRoleKey[] | string[];
}

export interface User {
  id: UUID;
  email: string;
  full_name: string;
  avatar_url: string | null;
  locale: string;
  timezone: string;
  email_verified: boolean;
  mfa_enabled: boolean;
  is_superadmin: boolean;
  default_organisation_id: UUID | null;
  preferences: Record<string, unknown>;
  created_at: ISODateTime;
}

export interface Me {
  user: User;
  organisation: OrgSummary;
  permissions: Permission[] | string[];
  organisations: OrgSummary[];
  settings: { gamification_enabled: boolean; require_mfa: boolean; [key: string]: unknown };
}

export interface MeUpdate {
  full_name?: string;
  avatar_url?: string | null;
  locale?: string;
  timezone?: string;
  default_organisation_id?: UUID | null;
  preferences?: Record<string, unknown>;
}

/* ------------------------------------------------------------------ invitations */

export interface InvitationLookup {
  organisation_id: UUID;
  organisation_name: string;
  organisation_logo_url: string | null;
  email: string;
  roles: string[];
  invited_by_name: string | null;
  expires_at: ISODateTime;
  existing_account: boolean;
}

export interface InvitationAcceptIn {
  token: string;
  full_name?: string | null;
  password?: string | null;
  accept_terms?: boolean;
}

export interface InvitationAcceptOut {
  organisation_id: UUID;
  user_id: UUID;
  account_created: boolean;
  access_token: string | null;
  refresh_token: string | null;
  csrf_token: string | null;
  expires_at: ISODateTime | null;
}

/* ------------------------------------------------------------------ dashboard */

export type Difficulty = "beginner" | "intermediate" | "advanced" | "expert" | string;
export type EnrolmentStatus = "not_started" | "in_progress" | "completed" | "overdue" | "withdrawn" | string;
export type LessonType =
  | "video"
  | "text"
  | "pdf"
  | "code"
  | "flashcards"
  | "scenario"
  | "quiz"
  | "assignment"
  | "simulation"
  | string;
export type SimulationBand = "fail" | "needs_improvement" | "competent" | "advanced" | "expert";

export interface LearnerStats {
  courses_in_progress: number;
  courses_completed: number;
  certificates: number;
  streak_days: number;
  longest_streak: number;
  average_score: number | null;
  learning_minutes_week: number;
}

export interface CurrentCourse {
  enrolment_id: UUID;
  course_id: UUID;
  title: string;
  thumbnail_url: string | null;
  category: string | null;
  difficulty: Difficulty | null;
  progress_pct: number;
  status: EnrolmentStatus;
  due_date: ISODateTime | ISODate | null;
  last_accessed_at: ISODateTime | null;
  next_lesson: { id: UUID; title: string; lesson_type: LessonType } | null;
}

export interface UpcomingDeadline {
  type: "course" | "assignment";
  id: UUID;
  title: string;
  course_id: UUID | null;
  course_title: string | null;
  due_at: ISODateTime;
  status: string;
}

export interface SimulationResult {
  session_id: UUID;
  simulation_id: UUID;
  title: string;
  total_score: number;
  band: SimulationBand | string;
  passed: boolean;
  completed_at: ISODateTime;
}

export interface SkillProficiency {
  skill_id: UUID;
  name: string;
  category: string | null;
  /** 0-100 */
  proficiency: number;
}

export interface CertificateSummary {
  id: UUID;
  certificate_number: string;
  course_title: string;
  issued_at: ISODateTime;
}

export interface Recommendation {
  id: UUID;
  kind: string;
  title: string;
  reason: string;
  target_type: string | null;
  target_id: UUID | null;
  course_id: UUID | null;
}

export interface ActivityItem {
  type: string;
  title: string;
  at: ISODateTime;
  link: string | null;
}

export interface HeatmapDay {
  day: ISODate;
  seconds: number;
}

export interface LearnerDashboard {
  stats: LearnerStats;
  current_courses: CurrentCourse[];
  upcoming_deadlines: UpcomingDeadline[];
  simulation_results: SimulationResult[];
  skills: SkillProficiency[];
  certificates: CertificateSummary[];
  recommendations: Recommendation[];
  recent_activity: ActivityItem[];
  activity_heatmap: HeatmapDay[];
}

/* ------------------------------------------------------------------ notifications */

export interface Notification {
  id: UUID;
  type: string;
  title: string;
  body: string;
  link: string | null;
  data?: Record<string, unknown>;
  read_at: ISODateTime | null;
  created_at: ISODateTime;
}

export interface UnreadCount {
  count: number;
}

/* ------------------------------------------------------------------ search */

export interface SearchItem {
  id: UUID | string;
  type: string;
  title: string;
  subtitle?: string | null;
  snippet?: string | null;
  status?: string | null;
  link: string;
  score?: number;
  meta?: Record<string, unknown>;
}

export interface SearchGroup {
  type: string;
  label: string;
  items: SearchItem[];
}

export interface SearchResponse {
  query: string;
  total: number;
  groups: SearchGroup[];
  types_searched: string[];
  fuzzy: boolean;
}

/** @deprecated use SearchItem */
export type SearchHit = SearchItem;
