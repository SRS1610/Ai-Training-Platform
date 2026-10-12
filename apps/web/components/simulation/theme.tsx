/**
 * Industry / environment theming for simulations: colour, icon, label and a small illustrated scene.
 * Illustrations are inline SVG (decorative, aria-hidden) built from the category palette.
 */
import { colorClasses, colorFor, humanize, type CategoryColor } from "@praxis/ui";
import {
  Activity,
  BookOpen,
  Building2,
  ChefHat,
  ClipboardList,
  Cpu,
  FileText,
  HeartPulse,
  Landmark,
  LayoutDashboard,
  ListChecks,
  type LucideIcon,
  Mail,
  MessageSquare,
  Monitor,
  ScrollText,
  Settings,
  ShieldAlert,
  ShieldCheck,
  ShoppingBag,
  Terminal,
  Ticket,
  UserRound,
  Users,
  UtensilsCrossed,
  Wrench,
} from "lucide-react";
import * as React from "react";

const INDUSTRY: Record<string, { color: CategoryColor; label: string; icon: LucideIcon }> = {
  it: { color: "sky", label: "IT support", icon: Cpu },
  cybersecurity: { color: "rose", label: "Cybersecurity", icon: ShieldAlert },
  security: { color: "rose", label: "Security", icon: ShieldAlert },
  hospitality: { color: "orange", label: "Hospitality", icon: UtensilsCrossed },
  healthcare: { color: "emerald", label: "Healthcare", icon: HeartPulse },
  finance: { color: "teal", label: "Finance", icon: Landmark },
  retail: { color: "amber", label: "Retail", icon: ShoppingBag },
  customer_service: { color: "teal", label: "Customer service", icon: Users },
  manufacturing: { color: "amber", label: "Manufacturing", icon: Wrench },
};

export function industryMeta(industry: string | null | undefined) {
  const key = (industry ?? "").toLowerCase().replace(/[\s-]+/g, "_");
  const known = INDUSTRY[key];
  const color = known?.color ?? colorFor(industry ?? "general");
  return { color, label: known?.label ?? humanize(industry || "General"), icon: known?.icon ?? Building2, classes: colorClasses(color) };
}

export const DIFFICULTY: Record<string, { label: string; color: CategoryColor; level: number }> = {
  beginner: { label: "Beginner", color: "emerald", level: 1 },
  intermediate: { label: "Intermediate", color: "sky", level: 2 },
  advanced: { label: "Advanced", color: "violet", level: 3 },
  expert: { label: "Expert", color: "rose", level: 4 },
};

export function difficultyMeta(d: string | null | undefined) {
  return DIFFICULTY[(d ?? "").toLowerCase()] ?? { label: humanize(d || "Intermediate"), color: "sky" as CategoryColor, level: 2 };
}

const ENV_LABELS: Record<string, string> = {
  helpdesk: "Service desk",
  soc: "Security operations centre",
  front_of_house: "Restaurant floor",
  clinic: "Clinic",
  ward: "Hospital ward",
  call_centre: "Contact centre",
  retail_floor: "Store floor",
};

export function environmentLabel(env: string | null | undefined) {
  return ENV_LABELS[(env ?? "").toLowerCase()] ?? humanize(env || "Workplace");
}

/** Icon for a tool/panel (engine `icon` hint first, then panel type). */
const ICONS: Record<string, LucideIcon> = {
  ticket: Ticket,
  message: MessageSquare,
  chat: MessageSquare,
  terminal: Terminal,
  monitor: Monitor,
  system_info: Monitor,
  book: BookOpen,
  knowledge_base: BookOpen,
  users: Users,
  admin_console: Users,
  mail: Mail,
  email_inbox: Mail,
  email_viewer: ScrollText,
  shield: ShieldCheck,
  url_sandbox: ShieldCheck,
  activity: Activity,
  siem_alerts: Activity,
  settings: Settings,
  dashboard: LayoutDashboard,
  chef: ChefHat,
  log_viewer: ScrollText,
  checklist: ListChecks,
  clipboard: ClipboardList,
  document: FileText,
  case_file: FileText,
  crm_record: UserRound,
  patient_chart: HeartPulse,
};

export function toolIcon(...hints: (string | null | undefined)[]): LucideIcon {
  for (const h of hints) if (h && ICONS[h.toLowerCase()]) return ICONS[h.toLowerCase()]!;
  return LayoutDashboard;
}

/** Stable colour per panel type, so each "app" in the workspace has its own accent. */
const PANEL_COLORS: Record<string, CategoryColor> = {
  ticket: "indigo",
  chat: "violet",
  terminal: "teal",
  system_info: "sky",
  knowledge_base: "amber",
  admin_console: "fuchsia",
  email_inbox: "sky",
  email_viewer: "indigo",
  url_sandbox: "rose",
  siem_alerts: "orange",
  dashboard: "violet",
  crm_record: "teal",
  log_viewer: "amber",
  checklist: "emerald",
  document: "indigo",
  patient_chart: "emerald",
  case_file: "indigo",
};

export function panelColor(type: string | null | undefined, fallbackKey?: string): CategoryColor {
  return PANEL_COLORS[(type ?? "").toLowerCase()] ?? colorFor(fallbackKey ?? type ?? "panel");
}

/* ------------------------------------------------------------------ environment illustrations */

function Frame({ color, children, className }: { color: CategoryColor; children: React.ReactNode; className?: string }) {
  const c = colorClasses(color);
  const id = React.useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 240 150" className={className} aria-hidden focusable="false">
      <defs>
        <linearGradient id={`bg${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={c.hexSoft} />
          <stop offset="100%" stopColor="#ffffff" />
        </linearGradient>
        <linearGradient id={`ac${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={c.hex} />
          <stop offset="100%" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      <rect width="240" height="150" fill={`url(#bg${id})`} />
      <circle cx="210" cy="18" r="46" fill={c.hex} opacity="0.08" />
      <circle cx="20" cy="140" r="38" fill="#8b5cf6" opacity="0.07" />
      <g style={{ ["--ac" as string]: `url(#ac${id})` }}>{children}</g>
    </svg>
  );
}

function Helpdesk({ className }: { className?: string }) {
  return (
    <Frame color="sky" className={className}>
      {/* monitor */}
      <rect x="44" y="26" width="112" height="76" rx="8" fill="#0f172a" />
      <rect x="50" y="32" width="100" height="64" rx="4" fill="#0b1220" />
      <text x="56" y="46" fontFamily="ui-monospace,monospace" fontSize="7" fill="#5eead4">PS C:\&gt; ipconfig /all</text>
      <rect x="56" y="52" width="60" height="3" rx="1.5" fill="#334155" />
      <rect x="56" y="59" width="78" height="3" rx="1.5" fill="#334155" />
      <rect x="56" y="66" width="48" height="3" rx="1.5" fill="#38bdf8" />
      <rect x="56" y="73" width="70" height="3" rx="1.5" fill="#334155" />
      <rect x="56" y="82" width="6" height="7" fill="#5eead4" className="motion-safe:animate-pulse" />
      <rect x="90" y="102" width="20" height="12" fill="#cbd5e1" />
      <rect x="74" y="113" width="52" height="5" rx="2.5" fill="#94a3b8" />
      {/* ticket card */}
      <g transform="translate(150 54)">
        <rect width="70" height="50" rx="8" fill="#fff" stroke="#e0e7ff" />
        <rect x="8" y="9" width="26" height="8" rx="4" fill="#6366f1" />
        <rect x="8" y="23" width="52" height="4" rx="2" fill="#cbd5e1" />
        <rect x="8" y="31" width="40" height="4" rx="2" fill="#e2e8f0" />
        <rect x="40" y="9" width="22" height="8" rx="4" fill="#fde68a" />
      </g>
      {/* chat bubbles */}
      <g transform="translate(16 40)">
        <rect width="38" height="20" rx="10" fill="#8b5cf6" />
        <circle cx="12" cy="10" r="2" fill="#fff" />
        <circle cx="19" cy="10" r="2" fill="#fff" />
        <circle cx="26" cy="10" r="2" fill="#fff" />
      </g>
      <g transform="translate(10 68)">
        <rect width="34" height="16" rx="8" fill="#fff" stroke="#e2e8f0" />
        <rect x="7" y="6" width="20" height="4" rx="2" fill="#94a3b8" />
      </g>
    </Frame>
  );
}

function Soc({ className }: { className?: string }) {
  return (
    <Frame color="rose" className={className}>
      {/* radar */}
      <g transform="translate(62 75)">
        <circle r="42" fill="#fff" stroke="#fecdd3" />
        <circle r="28" fill="none" stroke="#fecdd3" />
        <circle r="14" fill="none" stroke="#fecdd3" />
        <path d="M0 0 L0 -42 A42 42 0 0 1 36 -21 Z" fill="#f43f5e" opacity="0.18" />
        <circle cx="18" cy="-20" r="4" fill="#f43f5e" />
        <circle cx="-16" cy="12" r="3" fill="#f59e0b" />
        <circle cx="8" cy="22" r="2.5" fill="#0ea5e9" />
      </g>
      {/* alert table */}
      <g transform="translate(118 30)">
        <rect width="104" height="92" rx="10" fill="#fff" stroke="#e2e8f0" />
        {[0, 1, 2, 3].map((i) => (
          <g key={i} transform={`translate(10 ${12 + i * 19})`}>
            <rect width="10" height="10" rx="3" fill={["#f43f5e", "#f97316", "#f59e0b", "#0ea5e9"][i]} />
            <rect x="16" y="1" width={[60, 48, 66, 40][i]} height="4" rx="2" fill="#cbd5e1" />
            <rect x="16" y="7" width={[36, 50, 30, 44][i]} height="3" rx="1.5" fill="#e2e8f0" />
          </g>
        ))}
      </g>
      {/* shield */}
      <path d="M200 112 l14 -6 l14 6 v10 c0 9 -6 15 -14 19 c-8 -4 -14 -10 -14 -19z" fill="#8b5cf6" opacity="0.9" />
      <path d="M208 121 l4 4 l8 -8" stroke="#fff" strokeWidth="2.5" fill="none" strokeLinecap="round" />
    </Frame>
  );
}

function FrontOfHouse({ className }: { className?: string }) {
  return (
    <Frame color="orange" className={className}>
      {/* table */}
      <ellipse cx="96" cy="104" rx="70" ry="16" fill="#fed7aa" />
      <rect x="92" y="104" width="8" height="30" fill="#fdba74" />
      {/* plate + cloche */}
      <ellipse cx="96" cy="94" rx="36" ry="8" fill="#fff" stroke="#e2e8f0" />
      <path d="M68 92 a28 26 0 0 1 56 0 z" fill="#f97316" />
      <circle cx="96" cy="64" r="4" fill="#fb923c" />
      <path d="M78 84 a20 18 0 0 1 14 -14" stroke="#fff" strokeWidth="3" fill="none" opacity="0.6" strokeLinecap="round" />
      {/* docket */}
      <g transform="translate(160 26)">
        <rect width="58" height="80" rx="6" fill="#fff" stroke="#e2e8f0" />
        <rect x="8" y="10" width="30" height="5" rx="2.5" fill="#f43f5e" />
        <rect x="8" y="22" width="42" height="4" rx="2" fill="#cbd5e1" />
        <rect x="8" y="30" width="34" height="4" rx="2" fill="#e2e8f0" />
        <rect x="8" y="38" width="38" height="4" rx="2" fill="#e2e8f0" />
        <rect x="8" y="52" width="42" height="12" rx="4" fill="#fef3c7" />
        <rect x="12" y="56" width="26" height="4" rx="2" fill="#f59e0b" />
      </g>
      {/* speech */}
      <g transform="translate(18 26)">
        <rect width="44" height="22" rx="11" fill="#f43f5e" />
        <text x="22" y="15" textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff">!</text>
      </g>
    </Frame>
  );
}

function Clinical({ className }: { className?: string }) {
  return (
    <Frame color="emerald" className={className}>
      <rect x="40" y="28" width="120" height="84" rx="10" fill="#fff" stroke="#d1fae5" />
      <path d="M50 76 h26 l8 -22 l12 40 l10 -28 l8 10 h36" stroke="#10b981" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="170" y="38" width="48" height="64" rx="8" fill="#fff" stroke="#e2e8f0" />
      <rect x="178" y="48" width="32" height="5" rx="2.5" fill="#14b8a6" />
      <rect x="178" y="60" width="26" height="4" rx="2" fill="#cbd5e1" />
      <rect x="178" y="68" width="30" height="4" rx="2" fill="#e2e8f0" />
      <rect x="178" y="80" width="20" height="12" rx="4" fill="#d1fae5" />
    </Frame>
  );
}

function Generic({ className, color }: { className?: string; color: CategoryColor }) {
  const c = colorClasses(color);
  return (
    <Frame color={color} className={className}>
      <rect x="36" y="24" width="168" height="100" rx="12" fill="#fff" stroke="#e2e8f0" />
      <rect x="36" y="24" width="168" height="16" rx="12" fill={c.hexSoft} />
      <circle cx="48" cy="32" r="3" fill="#f43f5e" />
      <circle cx="58" cy="32" r="3" fill="#f59e0b" />
      <circle cx="68" cy="32" r="3" fill="#10b981" />
      <rect x="48" y="52" width="60" height="60" rx="8" fill={c.hexSoft} />
      <rect x="118" y="52" width="74" height="6" rx="3" fill="#cbd5e1" />
      <rect x="118" y="64" width="60" height="6" rx="3" fill="#e2e8f0" />
      <rect x="118" y="88" width="44" height="14" rx="7" fill={c.hex} />
    </Frame>
  );
}

export function EnvironmentIllustration({
  environment,
  industry,
  className,
}: {
  environment: string | null | undefined;
  industry?: string | null;
  className?: string;
}) {
  const env = (environment ?? "").toLowerCase();
  const ind = (industry ?? "").toLowerCase();
  if (env === "helpdesk" || ind === "it") return <Helpdesk className={className} />;
  if (env === "soc" || ind === "cybersecurity" || ind === "security") return <Soc className={className} />;
  if (env === "front_of_house" || ind === "hospitality") return <FrontOfHouse className={className} />;
  if (ind === "healthcare" || env === "clinic" || env === "ward") return <Clinical className={className} />;
  return <Generic className={className} color={industryMeta(industry).color} />;
}
