"use client";

import * as ProgressPrimitive from "@radix-ui/react-progress";
import * as React from "react";
import { cn } from "../lib/cn";
import { colorClasses, type CategoryColor } from "../lib/colors";

export interface ProgressProps extends React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> {
  value: number;
  color?: CategoryColor | "brand";
  size?: "xs" | "sm" | "md" | "lg";
  indicatorClassName?: string;
}

/** Linear progress bar with gradient fill. */
export const Progress = React.forwardRef<React.ElementRef<typeof ProgressPrimitive.Root>, ProgressProps>(
  ({ className, value, color = "brand", size = "sm", indicatorClassName, ...props }, ref) => {
    const v = Math.max(0, Math.min(100, value || 0));
    const h = { xs: "h-1", sm: "h-1.5", md: "h-2.5", lg: "h-3.5" }[size];
    const fill = color === "brand" ? "from-brand-500 via-violet-500 to-fuchsia-500" : colorClasses(color).gradient;
    return (
      <ProgressPrimitive.Root
        ref={ref}
        value={v}
        className={cn("relative w-full overflow-hidden rounded-full bg-slate-100", h, className)}
        {...props}
      >
        <ProgressPrimitive.Indicator
          className={cn("h-full rounded-full bg-gradient-to-r transition-[width] duration-700 ease-spring", fill, indicatorClassName)}
          style={{ width: `${v}%` }}
        />
      </ProgressPrimitive.Root>
    );
  },
);
Progress.displayName = "Progress";

export interface ProgressRingProps {
  value: number;
  size?: number;
  stroke?: number;
  color?: CategoryColor | "brand";
  label?: React.ReactNode;
  sublabel?: React.ReactNode;
  className?: string;
  /** Accessible name, e.g. "Course progress". */
  "aria-label"?: string;
  showValue?: boolean;
}

/** Circular progress ring with gradient stroke. */
export function ProgressRing({
  value,
  size = 64,
  stroke = 7,
  color = "brand",
  label,
  sublabel,
  className,
  showValue = true,
  "aria-label": ariaLabel = "Progress",
}: ProgressRingProps) {
  const v = Math.max(0, Math.min(100, value || 0));
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const id = React.useId().replace(/:/g, "");
  const [from, to] =
    color === "brand" ? ["#6366f1", "#c026d3"] : [colorClasses(color).hex, colorClasses(color).hex];
  return (
    <div
      className={cn("relative inline-grid shrink-0 place-items-center", className)}
      style={{ width: size, height: size }}
      role="progressbar"
      aria-valuenow={Math.round(v)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={ariaLabel}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <defs>
          <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={from} />
            <stop offset="100%" stopColor={to} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#eef2f7" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#g${id})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ - (v / 100) * circ}
          className="transition-[stroke-dashoffset] duration-1000 ease-spring"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center leading-none">
        {label ?? (showValue && <span className="font-display text-[0.8em] font-bold tabular-nums text-slate-900" style={{ fontSize: Math.max(11, size * 0.22) }}>{Math.round(v)}%</span>)}
        {sublabel && <span className="mt-0.5 text-2xs text-muted-foreground">{sublabel}</span>}
      </div>
    </div>
  );
}
