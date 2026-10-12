/**
 * Colour helpers: category colour-coding, performance bands and status tones.
 *
 * Tailwind only generates classes it can see as literal strings, so every class used for
 * colour-coding is spelled out in full here. Use these helpers instead of building class names
 * dynamically (e.g. never `bg-${color}-500`).
 */

export const CATEGORY_COLORS = [
  "indigo",
  "sky",
  "emerald",
  "amber",
  "rose",
  "fuchsia",
  "teal",
  "orange",
  "violet",
] as const;

export type CategoryColor = (typeof CATEGORY_COLORS)[number];

export interface ColorClasses {
  /** Solid fill (bars, dots, icons on white). */
  solid: string;
  /** Very light tinted surface (pills, tiles). */
  soft: string;
  /** Accessible text colour on white or `soft` (>= 4.5:1). */
  text: string;
  /** Icon colour on `soft` surface. */
  icon: string;
  border: string;
  ring: string;
  /** `from-* to-*` pair for gradient bars / avatars. */
  gradient: string;
  /** Soft gradient tint for KPI tiles / cards. */
  tint: string;
  hex: string;
  hexSoft: string;
}

const MAP: Record<CategoryColor, ColorClasses> = {
  indigo: {
    solid: "bg-indigo-500",
    soft: "bg-indigo-50",
    text: "text-indigo-700",
    icon: "text-indigo-600",
    border: "border-indigo-200",
    ring: "ring-indigo-200",
    gradient: "from-indigo-500 to-violet-500",
    tint: "from-indigo-50 via-white to-white",
    hex: "#6366f1",
    hexSoft: "#e0e7ff",
  },
  sky: {
    solid: "bg-sky-500",
    soft: "bg-sky-50",
    text: "text-sky-700",
    icon: "text-sky-600",
    border: "border-sky-200",
    ring: "ring-sky-200",
    gradient: "from-sky-400 to-blue-500",
    tint: "from-sky-50 via-white to-white",
    hex: "#0ea5e9",
    hexSoft: "#e0f2fe",
  },
  emerald: {
    solid: "bg-emerald-500",
    soft: "bg-emerald-50",
    text: "text-emerald-700",
    icon: "text-emerald-600",
    border: "border-emerald-200",
    ring: "ring-emerald-200",
    gradient: "from-emerald-400 to-teal-500",
    tint: "from-emerald-50 via-white to-white",
    hex: "#10b981",
    hexSoft: "#d1fae5",
  },
  amber: {
    solid: "bg-amber-500",
    soft: "bg-amber-50",
    text: "text-amber-800",
    icon: "text-amber-600",
    border: "border-amber-200",
    ring: "ring-amber-200",
    gradient: "from-amber-400 to-orange-500",
    tint: "from-amber-50 via-white to-white",
    hex: "#f59e0b",
    hexSoft: "#fef3c7",
  },
  rose: {
    solid: "bg-rose-500",
    soft: "bg-rose-50",
    text: "text-rose-700",
    icon: "text-rose-600",
    border: "border-rose-200",
    ring: "ring-rose-200",
    gradient: "from-rose-400 to-pink-500",
    tint: "from-rose-50 via-white to-white",
    hex: "#f43f5e",
    hexSoft: "#ffe4e6",
  },
  fuchsia: {
    solid: "bg-fuchsia-500",
    soft: "bg-fuchsia-50",
    text: "text-fuchsia-700",
    icon: "text-fuchsia-600",
    border: "border-fuchsia-200",
    ring: "ring-fuchsia-200",
    gradient: "from-fuchsia-500 to-purple-500",
    tint: "from-fuchsia-50 via-white to-white",
    hex: "#d946ef",
    hexSoft: "#fae8ff",
  },
  teal: {
    solid: "bg-teal-500",
    soft: "bg-teal-50",
    text: "text-teal-700",
    icon: "text-teal-600",
    border: "border-teal-200",
    ring: "ring-teal-200",
    gradient: "from-teal-400 to-cyan-500",
    tint: "from-teal-50 via-white to-white",
    hex: "#14b8a6",
    hexSoft: "#ccfbf1",
  },
  orange: {
    solid: "bg-orange-500",
    soft: "bg-orange-50",
    text: "text-orange-700",
    icon: "text-orange-600",
    border: "border-orange-200",
    ring: "ring-orange-200",
    gradient: "from-orange-400 to-rose-500",
    tint: "from-orange-50 via-white to-white",
    hex: "#f97316",
    hexSoft: "#ffedd5",
  },
  violet: {
    solid: "bg-violet-500",
    soft: "bg-violet-50",
    text: "text-violet-700",
    icon: "text-violet-600",
    border: "border-violet-200",
    ring: "ring-violet-200",
    gradient: "from-violet-500 to-fuchsia-500",
    tint: "from-violet-50 via-white to-white",
    hex: "#8b5cf6",
    hexSoft: "#ede9fe",
  },
};

/** Well-known category names get a fixed colour so they are consistent across orgs. */
const KNOWN: Record<string, CategoryColor> = {
  compliance: "rose",
  security: "rose",
  cybersecurity: "rose",
  "it support": "sky",
  it: "sky",
  technology: "sky",
  engineering: "sky",
  leadership: "violet",
  management: "violet",
  sales: "amber",
  "customer service": "teal",
  "customer success": "teal",
  support: "teal",
  healthcare: "emerald",
  clinical: "emerald",
  "health & safety": "orange",
  safety: "orange",
  onboarding: "indigo",
  finance: "emerald",
  marketing: "fuchsia",
  design: "fuchsia",
  "soft skills": "amber",
  communication: "amber",
  data: "indigo",
};

function hash(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Stable colour for any category/tag/name. Known categories map to fixed colours. */
export function colorFor(key: string | null | undefined): CategoryColor {
  if (!key) return "indigo";
  const k = key.trim().toLowerCase();
  if (k in KNOWN) return KNOWN[k] as CategoryColor;
  if ((CATEGORY_COLORS as readonly string[]).includes(k)) return k as CategoryColor;
  return CATEGORY_COLORS[hash(k) % CATEGORY_COLORS.length] as CategoryColor;
}

export function colorClasses(color: CategoryColor): ColorClasses {
  return MAP[color];
}

/** Shorthand: classes for a category name. */
export function categoryClasses(key: string | null | undefined): ColorClasses {
  return MAP[colorFor(key)];
}

/* ------------------------------------------------------------------ performance bands */

export type Band = "fail" | "needs_improvement" | "competent" | "advanced" | "expert";

export const BAND_META: Record<Band, { label: string; color: CategoryColor; description: string }> = {
  fail: { label: "Fail", color: "rose", description: "Below the passing standard" },
  needs_improvement: { label: "Needs improvement", color: "amber", description: "Close - practise the weak areas" },
  competent: { label: "Competent", color: "sky", description: "Meets the standard" },
  advanced: { label: "Advanced", color: "violet", description: "Above the standard" },
  expert: { label: "Expert", color: "emerald", description: "Exemplary performance" },
};

export function bandMeta(band: string | null | undefined) {
  const key = (band ?? "").toLowerCase().replace(/[\s-]+/g, "_") as Band;
  return BAND_META[key] ?? { label: band ?? "Unknown", color: "indigo" as CategoryColor, description: "" };
}

/* ------------------------------------------------------------------ status tones */

export type Tone = "neutral" | "brand" | "info" | "success" | "warning" | "danger" | "violet";

const STATUS_TONES: Record<string, Tone> = {
  draft: "neutral",
  not_started: "neutral",
  archived: "neutral",
  pending: "warning",
  in_review: "violet",
  review: "violet",
  submitted: "info",
  in_progress: "info",
  active: "success",
  published: "success",
  completed: "success",
  passed: "success",
  approved: "success",
  graded: "success",
  overdue: "danger",
  failed: "danger",
  rejected: "danger",
  revoked: "danger",
  expired: "danger",
  suspended: "danger",
  due_soon: "warning",
  invited: "brand",
};

export function statusTone(status: string | null | undefined): Tone {
  if (!status) return "neutral";
  return STATUS_TONES[status.toLowerCase()] ?? "neutral";
}

export function humanize(value: string | null | undefined): string {
  if (!value) return "";
  const s = value.replace(/[_-]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Chart series palette (hex) in category order. */
export const CHART_COLORS = CATEGORY_COLORS.map((c) => MAP[c].hex);
