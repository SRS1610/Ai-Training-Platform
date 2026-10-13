"use client";

import { Card, CardContent, CardHeader, CardTitle, Skeleton, cn, colorClasses, type CategoryColor } from "@praxis/ui";
import type { LucideIcon } from "lucide-react";
import * as React from "react";

/** Card with a coloured icon chip, title, optional description/action. */
export function ChartCard({
  title,
  description,
  icon: Icon,
  color = "indigo",
  action,
  children,
  className,
  contentClassName,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon: LucideIcon;
  color?: CategoryColor;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  const c = colorClasses(color);
  return (
    <Card className={cn("flex min-w-0 flex-col", className)}>
      <CardHeader>
        <div className="flex min-w-0 items-center gap-3">
          <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", c.soft, c.icon)}>
            <Icon className="size-[18px]" aria-hidden />
          </span>
          <div className="min-w-0">
            <CardTitle as="h2">{title}</CardTitle>
            {description && <p className="text-xs text-muted-foreground">{description}</p>}
          </div>
        </div>
        {action}
      </CardHeader>
      <CardContent className={cn("flex-1", contentClassName)}>{children}</CardContent>
    </Card>
  );
}

export function KpiSkeletonRow({ n = 6 }: { n?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6" aria-hidden>
      {Array.from({ length: n }).map((_, i) => (
        <Skeleton key={i} className="h-32 rounded-2xl" />
      ))}
    </div>
  );
}

/** Horizontal funnel bars (value / max) with optional secondary drop-off figure. */
export function FunnelBars({
  rows,
  max,
  valueLabel = (v: number) => String(v),
  "aria-label": ariaLabel,
}: {
  rows: { key: string; label: React.ReactNode; value: number; sub?: React.ReactNode; color?: CategoryColor }[];
  max: number;
  valueLabel?: (v: number) => React.ReactNode;
  "aria-label"?: string;
}) {
  const palette: CategoryColor[] = ["indigo", "sky", "teal", "emerald", "amber", "orange", "rose", "fuchsia", "violet"];
  return (
    <ol className="space-y-2.5" aria-label={ariaLabel}>
      {rows.map((r, i) => {
        const pct = max > 0 ? Math.max(2, (r.value / max) * 100) : 0;
        const c = colorClasses(r.color ?? palette[i % palette.length]!);
        return (
          <li key={r.key} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 sm:grid-cols-[minmax(0,12rem)_1fr_auto]">
            <span className="truncate text-sm font-medium text-slate-700" title={typeof r.label === "string" ? r.label : undefined}>
              {r.label}
            </span>
            <div className="h-7 overflow-hidden rounded-lg bg-slate-100">
              <div className={cn("flex h-full items-center rounded-lg bg-gradient-to-r px-2 transition-[width] duration-700 ease-spring", c.gradient)} style={{ width: `${pct}%` }}>
                <span className="whitespace-nowrap text-2xs font-bold tabular-nums text-white drop-shadow-sm">{pct > 22 ? valueLabel(r.value) : ""}</span>
              </div>
            </div>
            <span className="min-w-[4.5rem] text-right text-xs tabular-nums text-slate-600">
              {pct <= 22 && <span className="mr-1 font-semibold text-slate-900">{valueLabel(r.value)}</span>}
              {r.sub}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Text colour scale for a 0..1 (or 0..100) value: rose → amber → sky → emerald. */
export function scaleClasses(v: number | null | undefined, thresholds: [number, number, number]): string {
  if (v === null || v === undefined) return "bg-slate-100 text-slate-500";
  if (v < thresholds[0]) return "bg-rose-100 text-rose-800";
  if (v < thresholds[1]) return "bg-amber-100 text-amber-900";
  if (v < thresholds[2]) return "bg-sky-100 text-sky-800";
  return "bg-emerald-100 text-emerald-800";
}

export const pct = (v: number | null | undefined, digits = 0) => (v === null || v === undefined ? "—" : `${v.toFixed(digits)}%`);
export const num = (v: number | null | undefined, digits = 1) => (v === null || v === undefined ? "—" : Number.isInteger(v) ? String(v) : v.toFixed(digits));

/** Accessible data table fallback for a chart. */
export function ChartDataTable({ caption, columns, rows }: { caption: string; columns: string[]; rows: (string | number | null)[][] }) {
  return (
    <details className="mt-3 text-xs">
      <summary className="cursor-pointer font-medium text-slate-500 hover:text-slate-800">View as table</summary>
      <table className="mt-2 w-full text-left">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-slate-200">
            {columns.map((c) => (
              <th key={c} scope="col" className="py-1 pr-3 font-semibold text-slate-600">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-slate-100">
              {r.map((v, j) => (
                <td key={j} className="py-1 pr-3 tabular-nums text-slate-700">
                  {v ?? "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
