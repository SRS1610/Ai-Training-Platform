import { TrendingDown, TrendingUp } from "lucide-react";
import * as React from "react";
import { cn } from "../lib/cn";
import { colorClasses, type CategoryColor } from "../lib/colors";

export interface KpiTileProps {
  label: React.ReactNode;
  value: React.ReactNode;
  icon?: React.ReactNode;
  color?: CategoryColor;
  /** e.g. "+12%" with direction */
  delta?: { value: React.ReactNode; direction: "up" | "down" | "flat"; good?: boolean };
  hint?: React.ReactNode;
  className?: string;
  footer?: React.ReactNode;
}

/** KPI tile with soft gradient tint, coloured icon chip and optional delta. */
export function KpiTile({ label, value, icon, color = "indigo", delta, hint, className, footer }: KpiTileProps) {
  const c = colorClasses(color);
  const good = delta?.good ?? delta?.direction === "up";
  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-gradient-to-br p-4 shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift sm:p-5",
        c.tint,
        className,
      )}
    >
      <div className={cn("pointer-events-none absolute -right-8 -top-8 size-28 rounded-full opacity-[0.12] blur-2xl", c.solid)} aria-hidden />
      <div className="relative flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-slate-600">{label}</p>
        {icon && (
          <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-white shadow-sm [&_svg]:size-[18px]", c.gradient)}>
            {icon}
          </span>
        )}
      </div>
      <div className="relative mt-2 flex items-baseline gap-2">
        <span className="font-display text-2xl font-bold tracking-tight text-slate-900 tabular-nums sm:text-3xl">{value}</span>
        {delta && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-2xs font-semibold",
              delta.direction === "flat" ? "bg-slate-100 text-slate-600" : good ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700",
            )}
          >
            {delta.direction === "up" ? <TrendingUp className="size-3" aria-hidden /> : delta.direction === "down" ? <TrendingDown className="size-3" aria-hidden /> : null}
            {delta.value}
          </span>
        )}
      </div>
      {hint && <p className="relative mt-1 text-xs text-muted-foreground">{hint}</p>}
      {footer && <div className="relative mt-3">{footer}</div>}
    </div>
  );
}

/** Alias kept for readability in admin pages. */
export const StatCard = KpiTile;

/** Animated streak flame with day count. */
export function StreakFlame({ days, size = 40, className }: { days: number; size?: number; className?: string }) {
  const active = days > 0;
  return (
    <span className={cn("relative inline-grid place-items-center", className)} style={{ width: size, height: size }}>
      <svg viewBox="0 0 32 40" width={size * 0.8} height={size} aria-hidden className={cn(active && "origin-bottom motion-safe:animate-flicker")}>
        <defs>
          <linearGradient id="flame-outer" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor={active ? "#f43f5e" : "#cbd5e1"} />
            <stop offset="60%" stopColor={active ? "#f97316" : "#cbd5e1"} />
            <stop offset="100%" stopColor={active ? "#f59e0b" : "#e2e8f0"} />
          </linearGradient>
          <linearGradient id="flame-inner" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor={active ? "#f59e0b" : "#e2e8f0"} />
            <stop offset="100%" stopColor={active ? "#fde68a" : "#f1f5f9"} />
          </linearGradient>
        </defs>
        <path d="M16 1 C18 9 27 13 27 25 C27 33 22 39 16 39 C10 39 5 33 5 25 C5 18 9 15 11 10 C12 15 14 16 15 16 C15 10 14 6 16 1 Z" fill="url(#flame-outer)" />
        <path d="M16 18 C17 23 22 25 22 31 C22 35 19 38 16 38 C13 38 10 35 10 31 C10 27 13 25 14 22 C15 24 16 24 16 18 Z" fill="url(#flame-inner)" />
      </svg>
      <span className="sr-only">{days} day streak</span>
    </span>
  );
}
