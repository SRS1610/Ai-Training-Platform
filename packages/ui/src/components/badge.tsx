import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "../lib/cn";
import { bandMeta, colorClasses, colorFor, humanize, statusTone, type CategoryColor, type Tone } from "../lib/colors";

export const badgeVariants = cva(
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-semibold ring-1 ring-inset [&_svg]:size-3.5",
  {
    variants: {
      tone: {
        neutral: "bg-slate-100 text-slate-700 ring-slate-200",
        brand: "bg-brand-50 text-brand-700 ring-brand-200",
        info: "bg-sky-50 text-sky-700 ring-sky-200",
        success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
        warning: "bg-amber-50 text-amber-800 ring-amber-200",
        danger: "bg-rose-50 text-rose-700 ring-rose-200",
        violet: "bg-violet-50 text-violet-700 ring-violet-200",
        solid: "bg-brand-600 text-white ring-brand-600",
        gradient: "bg-brand-gradient text-white ring-transparent",
      },
      size: {
        sm: "px-2 py-0.5 text-2xs",
        md: "px-2.5 py-0.5 text-xs",
        lg: "px-3 py-1 text-sm",
      },
    },
    defaultVariants: { tone: "neutral", size: "md" },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {
  dot?: boolean;
}

const DOT: Record<string, string> = {
  neutral: "bg-slate-400",
  brand: "bg-brand-500",
  info: "bg-sky-500",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-rose-500",
  violet: "bg-violet-500",
  solid: "bg-white",
  gradient: "bg-white",
};

export function Badge({ className, tone, size, dot, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone, size }), className)} {...props}>
      {dot && <span className={cn("size-1.5 rounded-full", DOT[tone ?? "neutral"])} aria-hidden />}
      {children}
    </span>
  );
}

/** Status pill: maps a backend status string (e.g. "in_progress", "overdue") to a tone + label. */
export function StatusPill({
  status,
  label,
  tone,
  className,
  size,
}: {
  status: string | null | undefined;
  label?: string;
  tone?: Tone;
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <Badge tone={tone ?? statusTone(status)} size={size} dot className={className}>
      {label ?? humanize(status)}
    </Badge>
  );
}

/** Colour-coded category tag (stable colour per category name). */
export function CategoryBadge({
  category,
  color,
  className,
  size = "md",
}: {
  category: string;
  color?: CategoryColor;
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const c = colorClasses(color ?? colorFor(category));
  return (
    <span className={cn(badgeVariants({ size }), c.soft, c.text, c.ring, className)}>
      <span className={cn("size-1.5 rounded-full", c.solid)} aria-hidden />
      {category}
    </span>
  );
}

/** Simulation / assessment band chip: Fail (rose), Needs improvement (amber), Competent (sky), Advanced (violet), Expert (emerald). */
export function BandChip({ band, className, size = "md" }: { band: string; className?: string; size?: "sm" | "md" | "lg" }) {
  const meta = bandMeta(band);
  const c = colorClasses(meta.color);
  return (
    <span className={cn(badgeVariants({ size }), c.soft, c.text, c.ring, className)} title={meta.description}>
      <span className={cn("size-1.5 rounded-full", c.solid)} aria-hidden />
      {meta.label}
    </span>
  );
}

/** Small coloured dot, e.g. for legends and lists. */
export function ColorDot({ color, category, className }: { color?: CategoryColor; category?: string; className?: string }) {
  const c = colorClasses(color ?? colorFor(category));
  return <span aria-hidden className={cn("inline-block size-2.5 shrink-0 rounded-full", c.solid, className)} />;
}
