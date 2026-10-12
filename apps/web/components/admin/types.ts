/**
 * API types for the organisation-admin and platform areas, aliased from the generated OpenAPI schema
 * (`packages/types/src/openapi.ts`). Endpoints that return untyped dicts (analytics) are described by hand
 * after reading `apps/api/app/modules/analytics/service.py`.
 */
import type { components } from "@praxis/types/openapi";

type S = components["schemas"];

export type MemberOut = S["MemberOut"];
export type MemberDetail = S["MemberDetail"];
export type MemberCreate = S["MemberCreate"];
export type MemberCreated = S["MemberCreated"];
export type MemberUpdate = S["MemberUpdate"];
export type UsersImportResult = S["app__modules__users__schemas__ImportResult"];
export type InvitationOut = S["InvitationOut"];
export type BulkResult = S["BulkResult"];
export type RoleOut = S["RoleOut"];
export type PermissionOut = S["PermissionOut"];
export type DepartmentOut = S["DepartmentOut"];
export type DepartmentNode = S["DepartmentNode"];
export type TeamOut = S["TeamOut"];
export type TeamMemberOut = S["TeamMemberOut"];
export type PathOut = S["PathOut"];
export type PathItemOut = S["PathItemOut"];
export type PathEnrolOut = S["PathEnrolOut"];
export type AssignOut = S["AssignOut"];
export type EnrolmentOut = S["EnrolmentOut"];
export type CourseOut = S["CourseOut"];
export type ReportTypeOut = S["ReportTypeOut"];
export type AIConfigOut = S["AIConfigOut"];
export type AIConfigUpdate = S["AIConfigUpdate"];
export type AIUsageOut = S["app__modules__ai__schemas__UsageOut"];
export type ProviderInfo = S["ProviderInfo"];
export type PlanOut = S["app__modules__billing__schemas__PlanOut"];
export type SubscriptionOut = S["SubscriptionOut"];
export type PaymentOut = S["PaymentOut"];
export type BillingUsageOut = S["app__modules__billing__schemas__UsageOut"];
export type CheckoutOut = S["CheckoutOut"];
export type AuditLogOut = S["AuditLogOut"];
export type ChainVerification = S["ChainVerification"];
export type ApiKeyOut = S["ApiKeyOut"];
export type ApiKeyCreated = S["ApiKeyCreated"];
export type SSOOut = S["SSOOut"];
export type SSOTestResult = S["SSOTestResult"];
export type OrgOut = S["OrgOut"];
export type DomainStatus = S["DomainStatus"];
export type ConsentsOut = S["ConsentsOut"];
export type DataRequestOut = S["DataRequestOut"];
export type RetentionOut = S["RetentionOut"];
export type RetentionRunOut = S["RetentionRunOut"];
export type BadgeOut = S["BadgeOut"];
export type BadgeListOut = S["BadgeListOut"];
export type PlatformOrgOut = S["PlatformOrgOut"];
export type PlatformOrgDetail = S["PlatformOrgDetail"];
export type PlatformUserOut = S["PlatformUserOut"];
export type HealthOut = S["HealthOut"];

/* ------------------------------------------------------------------ analytics (hand-written) */

export interface OrgAnalyticsSummary {
  members: number;
  active_learners_30d: number;
  enrolments: number;
  completed: number;
  in_progress: number;
  overdue: number;
  avg_final_score: number | null;
  time_spent_seconds: number;
  certificates_issued: number;
  completion_rate: number | null;
  hours_learned: number | null;
}

export interface ComplianceRow {
  assigned: number;
  completed_on_time: number;
  completed_late: number;
  overdue: number;
  pending: number;
  compliance_rate: number | null;
}

export interface ComplianceByCourse extends ComplianceRow {
  course_id: string;
  title: string;
}

export interface EmployeePerformance {
  user_id: string;
  full_name: string;
  email: string;
  job_title: string | null;
  department_id: string | null;
  department: string | null;
  enrolments: number;
  completed: number;
  overdue: number;
  avg_final_score: number | null;
  time_spent_seconds: number;
  avg_assessment_pct: number | null;
  attempts: number;
  avg_simulation_score: number | null;
  simulations: number;
  completion_rate: number | null;
}

export interface SkillGap {
  competency_id: string;
  competency: string;
  skill_id: string;
  skill: string | null;
  min_level: number;
  learners: number;
  assessed: number;
  avg_proficiency: number | null;
  meeting: number;
  below: number;
  gap: number | null;
  coverage_rate: number | null;
}

export interface DepartmentPerf {
  department_id: string | null;
  department: string;
  members: number;
  enrolments: number;
  completed: number;
  overdue: number;
  avg_final_score: number | null;
  completion_rate: number | null;
}

export interface CourseOverviewRow {
  course_id: string;
  title: string;
  status: string;
  enrolments: number;
  completed: number;
  overdue: number;
  avg_final_score: number | null;
  avg_progress: number | null;
  completion_rate: number | null;
}

export interface OrgAnalytics {
  range: { start: string | null; end: string | null };
  filters: { department_id: string | null; course_id: string | null };
  summary: OrgAnalyticsSummary;
  compliance: ComplianceRow & { by_course: ComplianceByCourse[] };
  employee_performance: EmployeePerformance[];
  top_performers: EmployeePerformance[];
  skill_gaps: SkillGap[];
  departments: DepartmentPerf[];
  courses: CourseOverviewRow[];
  active_learners_trend: { date: string; active_learners: number; seconds: number }[];
}

export interface MetricsSnapshot {
  uptime_seconds: number;
  requests_total: number;
  status_counts: Record<string, number>;
  latency_ms: { p50: number; p95: number; p99: number };
  slowest_routes_p95: { route: string; p95_ms: number }[];
  ai_calls: Record<string, number>;
  ai_errors: number;
}

export interface PlatformAnalytics {
  range: { start: string | null; end: string | null };
  organisations: {
    total: number;
    active: number;
    suspended: number;
    new_in_range: number;
    by_plan: { plan_code: string; count: number }[];
    by_kind: { kind: string; count: number }[];
  };
  users: {
    total: number;
    new_in_range: number;
    logged_in_in_range: number;
    active_30d: number;
    signups_by_day: { date: string; signups: number }[];
  };
  revenue: {
    total_paid_cents: number;
    paid_in_range_cents: number;
    outstanding_invoices: number;
    by_month: { month: string; currency: string; amount_cents: number }[];
    mrr_cents_estimate: number;
    subscriptions_by_status: Record<string, number>;
  };
  courses: { total: number; published: number; ai_generated: number };
  activity: {
    enrolments: number;
    completions: number;
    attempts: number;
    submissions: number;
    simulation_sessions: number;
    certificates: number;
    tutor_messages: number;
  };
  ai_usage: {
    cost_usd: number;
    requests: number;
    tokens_in: number;
    tokens_out: number;
    errors: number;
    by_organisation: { organisation_id: string; name: string; cost_usd: number; requests: number }[];
    by_feature: { feature: string; cost_usd: number; requests: number }[];
    by_model: { provider: string; model: string; cost_usd: number; requests: number; tokens: number }[];
  };
  storage: {
    total_bytes: number;
    files: number;
    by_organisation: { organisation_id: string; name: string; bytes: number; files: number }[];
    by_purpose: { purpose: string; bytes: number; files: number }[];
  };
  api: MetricsSnapshot;
}
