/**
 * App navigation, grouped into sections and gated by permission.
 * A nav item is visible when the user has ANY of `anyOf` (or `superadmin` for platform pages).
 * Every entry is a built page; unknown /app/* paths get the app-wide 404 (app/not-found.tsx).
 */
import type { CategoryColor } from "@praxis/ui";
import {
  Award,
  BarChart3,
  BookOpen,
  Bot,
  Building2,
  ClipboardCheck,
  ClipboardList,
  CreditCard,
  FileClock,
  FileQuestion,
  FolderKanban,
  Gauge,
  GraduationCap,
  Grid3x3,
  KeyRound,
  LayoutDashboard,
  Library,
  ListChecks,
  type LucideIcon,
  MonitorPlay,
  Network,
  PieChart,
  Route,
  ScrollText,
  Settings,
  ShieldCheck,
  Sparkles,
  Target,
  Trophy,
  UsersRound,
  Wand2,
  Workflow,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  anyOf?: string[];
  superadmin?: boolean;
  color: CategoryColor;
  description?: string;
  badge?: string;
}

export interface NavSection {
  id: "learn" | "teach" | "manage" | "platform";
  label: string;
  items: NavItem[];
}

const LEARN = ["learning.access"];
/** Any permission that unlocks at least one Manage page (the admin overview lists only those). */
const ADMIN_AREAS = [
  "users.view",
  "users.edit",
  "roles.manage",
  "enrolments.manage",
  "analytics.view",
  "reports.export",
  "ai.manage",
  "billing.manage",
  "audit.view",
  "api_keys.manage",
  "organisation.manage",
];

export const NAV: NavSection[] = [
  {
    id: "learn",
    label: "Learn",
    items: [
      { label: "Dashboard", href: "/app/dashboard", icon: LayoutDashboard, color: "indigo", description: "Your learning at a glance" },
      { label: "Catalog", href: "/app/catalog", icon: Library, anyOf: LEARN, color: "sky", description: "Browse and enrol in courses" },
      { label: "My learning", href: "/app/learning", icon: BookOpen, anyOf: LEARN, color: "emerald", description: "Courses and learning paths you're enrolled in" },
      { label: "Assignments", href: "/app/assignments", icon: ClipboardCheck, anyOf: LEARN, color: "orange", description: "Practical work, drafts and feedback" },
      { label: "Simulations", href: "/app/simulations", icon: MonitorPlay, anyOf: LEARN, color: "violet", description: "Practise in realistic work environments" },
      { label: "AI Tutor", href: "/app/tutor", icon: Bot, anyOf: LEARN, color: "fuchsia", description: "Ask questions, get explanations and hints" },
      { label: "Certificates", href: "/app/certificates", icon: Award, anyOf: LEARN, color: "amber", description: "Your earned credentials" },
      { label: "Skills", href: "/app/skills", icon: Target, anyOf: LEARN, color: "teal", description: "Competency profile and personalised plan" },
      { label: "Achievements", href: "/app/achievements", icon: Trophy, anyOf: LEARN, color: "rose", description: "Points, levels, streaks, badges and leaderboard" },
    ],
  },
  {
    id: "teach",
    label: "Teach",
    items: [
      { label: "Courses", href: "/app/instructor/courses", icon: GraduationCap, anyOf: ["courses.create", "courses.edit"], color: "indigo", description: "Build, version and publish courses" },
      { label: "AI Course Builder", href: "/app/instructor/ai-builder", icon: Wand2, anyOf: ["courses.create"], color: "fuchsia", badge: "AI", description: "Generate a course draft with AI, then review" },
      { label: "Question banks", href: "/app/instructor/question-banks", icon: FileQuestion, anyOf: ["assessments.manage"], color: "sky", description: "Reusable question libraries" },
      { label: "Assessments", href: "/app/instructor/assessments", icon: ClipboardList, anyOf: ["assessments.manage"], color: "indigo", description: "Quizzes and exams built from your banks" },
      { label: "Assignments", href: "/app/instructor/assignments", icon: ClipboardCheck, anyOf: ["assignments.manage"], color: "amber", description: "Practical assignments and briefs" },
      { label: "Rubrics", href: "/app/instructor/rubrics", icon: Grid3x3, anyOf: ["assignments.manage"], color: "orange", description: "Reusable grading criteria and levels" },
      { label: "Simulation builder", href: "/app/instructor/simulations", icon: Workflow, anyOf: ["simulations.manage"], color: "violet", description: "Design data-driven simulations" },
      { label: "Grading", href: "/app/instructor/grading", icon: ListChecks, anyOf: ["submissions.review"], color: "rose", description: "Review queue with AI recommendations" },
      { label: "Knowledge base", href: "/app/instructor/knowledge", icon: FolderKanban, anyOf: ["knowledge.manage"], color: "teal", description: "Documents that ground the AI tutor" },
      { label: "Analytics", href: "/app/instructor/analytics", icon: BarChart3, anyOf: ["analytics.view"], color: "emerald", description: "Course, question and simulation insights" },
    ],
  },
  {
    id: "manage",
    label: "Manage",
    items: [
      { label: "Admin overview", href: "/app/admin", icon: Gauge, anyOf: ADMIN_AREAS, color: "indigo", description: "Everything you can manage, at a glance" },
      { label: "Users", href: "/app/admin/users", icon: UsersRound, anyOf: ["users.view"], color: "sky", description: "People, invitations and roles" },
      { label: "Departments & teams", href: "/app/admin/departments", icon: Network, anyOf: ["users.edit"], color: "teal", description: "Organisation structure" },
      { label: "Roles", href: "/app/admin/roles", icon: ShieldCheck, anyOf: ["roles.manage"], color: "violet", description: "Custom roles and permissions" },
      { label: "Learning paths", href: "/app/admin/learning-paths", icon: Route, anyOf: ["enrolments.manage"], color: "emerald", description: "Programs and training assignments" },
      { label: "Organisation analytics", href: "/app/admin/analytics", icon: PieChart, anyOf: ["analytics.view"], color: "teal", description: "Compliance, skill gaps, departments and top performers" },
      { label: "Reports", href: "/app/admin/reports", icon: ScrollText, anyOf: ["reports.export"], color: "amber", description: "PDF, CSV and Excel reports" },
      { label: "AI settings", href: "/app/admin/ai", icon: Sparkles, anyOf: ["ai.manage"], color: "fuchsia", description: "Providers, models, usage and budgets" },
      { label: "Billing", href: "/app/admin/billing", icon: CreditCard, anyOf: ["billing.manage"], color: "indigo", description: "Plan, seats and invoices" },
      { label: "Audit logs", href: "/app/admin/audit-logs", icon: FileClock, anyOf: ["audit.view"], color: "rose", description: "Immutable activity trail" },
      { label: "API keys", href: "/app/admin/api-keys", icon: KeyRound, anyOf: ["api_keys.manage"], color: "orange", description: "Machine access and integrations" },
      { label: "Settings", href: "/app/admin/settings", icon: Settings, anyOf: ["organisation.manage"], color: "indigo", description: "Branding, domain, SSO and retention" },
    ],
  },
  {
    id: "platform",
    label: "Platform",
    items: [
      { label: "Platform admin", href: "/app/platform", icon: Building2, superadmin: true, color: "rose", description: "Organisations, revenue, AI usage, health" },
    ],
  },
];

export function visibleNav(can: (p: string) => boolean, isSuperadmin: boolean): NavSection[] {
  return NAV.map((s) => ({
    ...s,
    items: s.items.filter((i) => (i.superadmin ? isSuperadmin : !i.anyOf || i.anyOf.some((p) => can(p)))),
  })).filter((s) => s.items.length > 0);
}

/** Routes that are not nav entries themselves but live under one (course player, lessons, quizzes). */
const ROUTE_PARENTS: Record<string, string> = { "/app/learn": "/app/learning", "/app/quiz": "/app/learning" };

/** The single nav item a path belongs to (longest matching href), used for the active highlight and breadcrumbs. */
export function findNavItem(pathname: string): NavItem | undefined {
  let best: NavItem | undefined;
  for (const s of NAV)
    for (const i of s.items)
      if ((pathname === i.href || pathname.startsWith(`${i.href}/`)) && (!best || i.href.length > best.href.length)) best = i;
  if (best) return best;
  for (const [prefix, parent] of Object.entries(ROUTE_PARENTS))
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return NAV.flatMap((s) => s.items).find((i) => i.href === parent);
  return undefined;
}
