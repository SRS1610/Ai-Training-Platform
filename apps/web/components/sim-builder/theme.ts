/**
 * Builder colour system. Class strings are spelled out in full so Tailwind generates them.
 */
import { CATEGORY_COLORS, colorClasses, type CategoryColor } from "@praxis/ui";
import {
  ArrowUpRight,
  FileText,
  ListChecks,
  MessageSquare,
  Search,
  Send,
  Terminal,
  type LucideIcon,
} from "lucide-react";

/** Score dimensions use the category palette in order. */
export const DIM_COLORS = CATEGORY_COLORS.map((c) => {
  const k = colorClasses(c);
  return { name: c, dot: k.solid, chip: `${k.soft} ${k.text} ${k.ring}`, hex: k.hex };
});

export const dimColor = (index: number) => DIM_COLORS[((index % DIM_COLORS.length) + DIM_COLORS.length) % DIM_COLORS.length]!;

/** Phase colours rotate through a vivid subset (left-to-right flow reads like a rainbow). */
const PHASE_ORDER: CategoryColor[] = ["indigo", "sky", "teal", "emerald", "amber", "orange", "rose", "fuchsia", "violet"];
export const phaseColor = (index: number): CategoryColor => PHASE_ORDER[index % PHASE_ORDER.length]!;

export const ACTION_KIND: Record<string, { label: string; icon: LucideIcon; chip: string }> = {
  ask: { label: "Ask", icon: MessageSquare, chip: "bg-sky-100 text-sky-700" },
  command: { label: "Command", icon: Terminal, chip: "bg-slate-800 text-emerald-300" },
  inspect: { label: "Inspect", icon: Search, chip: "bg-indigo-100 text-indigo-700" },
  select: { label: "Select", icon: ListChecks, chip: "bg-violet-100 text-violet-700" },
  submit: { label: "Submit", icon: Send, chip: "bg-emerald-100 text-emerald-700" },
  document: { label: "Document", icon: FileText, chip: "bg-amber-100 text-amber-800" },
  escalate: { label: "Escalate", icon: ArrowUpRight, chip: "bg-rose-100 text-rose-700" },
};

export const CLASS_STYLE: Record<string, { stripe: string; text: string; soft: string; label: string }> = {
  correct: { stripe: "bg-emerald-500", text: "text-emerald-700", soft: "bg-emerald-50 text-emerald-700 ring-emerald-200", label: "Correct" },
  neutral: { stripe: "bg-slate-300", text: "text-slate-600", soft: "bg-slate-100 text-slate-600 ring-slate-200", label: "Neutral" },
  incorrect: { stripe: "bg-amber-500", text: "text-amber-800", soft: "bg-amber-50 text-amber-800 ring-amber-200", label: "Incorrect" },
  critical: { stripe: "bg-rose-500", text: "text-rose-700", soft: "bg-rose-50 text-rose-700 ring-rose-200", label: "Critical" },
};

/** `color` strokes the edge; `text` is an AA-contrast shade for labels on white. */
export const EDGE_STYLE = {
  transition: { color: "#6366f1", text: "#4338ca", label: "Transition" },
  auto: { color: "#8b5cf6", text: "#6d28d9", label: "Auto-advance" },
  contains: { color: "#94a3b8", text: "#475569", label: "Available in" },
  branch: { color: "#14b8a6", text: "#0f766e", label: "Branch" },
  effect_transition: { color: "#d946ef", text: "#a21caf", label: "Forces phase" },
  triggers: { color: "#f59e0b", text: "#b45309", label: "Triggers" },
} as const;

export const NODE_MINIMAP: Record<string, string> = {
  phase: "#6366f1",
  action: "#0ea5e9",
  branch: "#14b8a6",
  event: "#f59e0b",
};

export const INDUSTRY_COLOR = (industry: string | null | undefined): CategoryColor => {
  const k = (industry ?? "").toLowerCase();
  if (["it", "technology", "helpdesk"].includes(k)) return "sky";
  if (["cybersecurity", "security", "soc"].includes(k)) return "rose";
  if (["hospitality", "restaurant", "food"].includes(k)) return "orange";
  if (["healthcare", "clinical"].includes(k)) return "emerald";
  if (["finance", "banking"].includes(k)) return "teal";
  if (["sales", "retail"].includes(k)) return "amber";
  if (["customer_service", "customer service", "support"].includes(k)) return "violet";
  if (["manufacturing", "safety"].includes(k)) return "fuchsia";
  return "indigo";
};

export const INDUSTRIES = [
  { value: "it", label: "IT & helpdesk" },
  { value: "cybersecurity", label: "Cybersecurity" },
  { value: "hospitality", label: "Hospitality" },
  { value: "healthcare", label: "Healthcare" },
  { value: "finance", label: "Finance & banking" },
  { value: "sales", label: "Sales & retail" },
  { value: "customer_service", label: "Customer service" },
  { value: "manufacturing", label: "Manufacturing & safety" },
  { value: "general", label: "General" },
];

export const DIFFICULTIES = [
  { value: "beginner", label: "Beginner" },
  { value: "intermediate", label: "Intermediate" },
  { value: "advanced", label: "Advanced" },
  { value: "expert", label: "Expert" },
];
