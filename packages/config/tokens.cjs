/**
 * Praxis design tokens (light theme only).
 * Single source of truth consumed by the Tailwind preset and by chart/colour helpers in @praxis/ui.
 */

/** Brand: indigo -> violet. Values are "r g b" channels so Tailwind opacity modifiers work. */
const brand = {
  50: "238 242 255",
  100: "224 231 255",
  200: "199 210 254",
  300: "165 180 252",
  400: "129 140 248",
  500: "99 102 241",
  600: "79 70 229",
  700: "67 56 202",
  800: "55 48 163",
  900: "49 46 129",
  950: "30 27 75",
};

/** Category colours used for course/module colour-coding, tags and chart series (in this order). */
const categoryColors = ["indigo", "sky", "emerald", "amber", "rose", "fuchsia", "teal", "orange", "violet"];

/** Chart series palette (hex, Tailwind 500/600 shades chosen for >= 3:1 non-text contrast on white). */
const chartPalette = [
  "#6366f1", // indigo-500
  "#0ea5e9", // sky-500
  "#10b981", // emerald-500
  "#f59e0b", // amber-500
  "#f43f5e", // rose-500
  "#d946ef", // fuchsia-500
  "#14b8a6", // teal-500
  "#f97316", // orange-500
  "#8b5cf6", // violet-500
];

/** Simulation / assessment performance bands. */
const bands = {
  fail: { label: "Fail", color: "rose", hex: "#e11d48" },
  needs_improvement: { label: "Needs improvement", color: "amber", hex: "#d97706" },
  competent: { label: "Competent", color: "sky", hex: "#0284c7" },
  advanced: { label: "Advanced", color: "violet", hex: "#7c3aed" },
  expert: { label: "Expert", color: "emerald", hex: "#059669" },
};

/** Semantic surface + text tokens ("r g b" channels). */
const semantic = {
  background: "247 248 252", // app canvas
  foreground: "15 23 42", // slate-900
  card: "255 255 255",
  "card-foreground": "15 23 42",
  popover: "255 255 255",
  "popover-foreground": "15 23 42",
  muted: "241 245 249", // slate-100
  "muted-foreground": "71 85 105", // slate-600 (7.2:1 on white)
  subtle: "100 116 139", // slate-500 (4.7:1 on white) - only for >= 14px text
  border: "226 232 240", // slate-200
  input: "203 213 225", // slate-300
  ring: brand[500],
  primary: brand[600],
  "primary-foreground": "255 255 255",
  secondary: "241 245 249",
  "secondary-foreground": "30 41 59",
  accent: "245 243 255", // violet-50
  "accent-foreground": "91 33 182", // violet-800
  destructive: "225 29 72", // rose-600
  "destructive-foreground": "255 255 255",
  success: "5 150 105", // emerald-600
  warning: "217 119 6", // amber-600
  info: "2 132 199", // sky-600
};

module.exports = { brand, categoryColors, chartPalette, bands, semantic };
