"use client";

/**
 * Colourful chart wrappers over Recharts with Praxis styling (palette, grid, tooltip, legend).
 * All charts are responsive: give the parent a height (or use the `height` prop).
 * Each chart takes an `aria-label`; wrap in a <figure> with a caption or provide a data table for
 * screen-reader users when the chart carries essential information.
 */

import * as React from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "../lib/cn";
import { CHART_COLORS } from "../lib/colors";

export { CHART_COLORS };

export interface Series {
  key: string;
  label?: string;
  color?: string;
}

const axisProps = {
  tickLine: false,
  axisLine: false,
  tick: { fill: "#64748b", fontSize: 12 },
} as const;

type TooltipPayload = { name?: string; value?: number | string; color?: string; dataKey?: string | number; payload?: Record<string, unknown> };

function ChartTooltip({
  active,
  payload,
  label,
  formatter,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
  label?: React.ReactNode;
  formatter?: (v: number | string) => React.ReactNode;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-[8rem] rounded-xl border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-lift backdrop-blur">
      {label !== undefined && label !== "" && <p className="mb-1 font-semibold text-slate-900">{label}</p>}
      <ul className="space-y-0.5">
        {payload.map((p, i) => (
          <li key={i} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-slate-600">
              <span className="size-2 rounded-full" style={{ background: p.color }} aria-hidden />
              {p.name}
            </span>
            <span className="font-semibold tabular-nums text-slate-900">{formatter && p.value !== undefined ? formatter(p.value) : p.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Frame({ height, className, label, children }: { height: number; className?: string; label?: string; children: React.ReactElement }) {
  return (
    <div className={cn("w-full", className)} style={{ height }} role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

const color = (s: Series, i: number) => s.color ?? CHART_COLORS[i % CHART_COLORS.length];

export interface CartesianChartProps<T> {
  data: T[];
  xKey: keyof T & string;
  series: Series[];
  height?: number;
  className?: string;
  "aria-label"?: string;
  valueFormatter?: (v: number | string) => React.ReactNode;
  showLegend?: boolean;
  stacked?: boolean;
}

/** Smooth gradient-filled area chart for trends. */
export function TrendAreaChart<T extends Record<string, unknown>>({
  data,
  xKey,
  series,
  height = 260,
  className,
  valueFormatter,
  showLegend,
  stacked,
  "aria-label": label,
}: CartesianChartProps<T>) {
  const id = React.useId().replace(/:/g, "");
  return (
    <Frame height={height} className={className} label={label}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
        <defs>
          {series.map((s, i) => (
            <linearGradient key={s.key} id={`a${id}${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color(s, i)} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color(s, i)} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid vertical={false} stroke="#eef2f7" />
        <XAxis dataKey={xKey as string} {...axisProps} />
        <YAxis {...axisProps} />
        <Tooltip content={<ChartTooltip formatter={valueFormatter} />} cursor={{ stroke: "#c7d2fe", strokeWidth: 2 }} />
        {showLegend && <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />}
        {series.map((s, i) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label ?? s.key}
            stroke={color(s, i)}
            strokeWidth={2.5}
            fill={`url(#a${id}${i})`}
            stackId={stacked ? "1" : undefined}
            activeDot={{ r: 5, strokeWidth: 2, stroke: "#fff" }}
          />
        ))}
      </AreaChart>
    </Frame>
  );
}

/** Line chart for comparisons over time. */
export function TrendLineChart<T extends Record<string, unknown>>({
  data,
  xKey,
  series,
  height = 260,
  className,
  valueFormatter,
  showLegend = true,
  "aria-label": label,
}: CartesianChartProps<T>) {
  return (
    <Frame height={height} className={className} label={label}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
        <CartesianGrid vertical={false} stroke="#eef2f7" />
        <XAxis dataKey={xKey as string} {...axisProps} />
        <YAxis {...axisProps} />
        <Tooltip content={<ChartTooltip formatter={valueFormatter} />} />
        {showLegend && <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />}
        {series.map((s, i) => (
          <Line key={s.key} type="monotone" dataKey={s.key} name={s.label ?? s.key} stroke={color(s, i)} strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} />
        ))}
      </LineChart>
    </Frame>
  );
}

/** Rounded bar chart. `layout="horizontal"` draws horizontal bars (category on Y axis). `colorByIndex` paints each bar a different category colour. */
export function ColorBarChart<T extends Record<string, unknown>>({
  data,
  xKey,
  series,
  height = 260,
  className,
  valueFormatter,
  showLegend,
  stacked,
  layout = "vertical",
  colorByIndex,
  "aria-label": label,
}: CartesianChartProps<T> & { layout?: "vertical" | "horizontal"; colorByIndex?: boolean }) {
  const horizontal = layout === "horizontal";
  return (
    <Frame height={height} className={className} label={label}>
      <BarChart
        data={data}
        layout={horizontal ? "vertical" : "horizontal"}
        margin={{ top: 8, right: 8, bottom: 0, left: horizontal ? 8 : -16 }}
        barCategoryGap="22%"
      >
        <CartesianGrid vertical={horizontal} horizontal={!horizontal} stroke="#eef2f7" />
        {horizontal ? (
          <>
            <XAxis type="number" {...axisProps} />
            <YAxis type="category" dataKey={xKey as string} width={110} {...axisProps} />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey as string} {...axisProps} />
            <YAxis {...axisProps} />
          </>
        )}
        <Tooltip content={<ChartTooltip formatter={valueFormatter} />} cursor={{ fill: "#eef2ff", opacity: 0.6 }} />
        {showLegend && <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />}
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label ?? s.key}
            fill={color(s, i)}
            radius={horizontal ? [0, 8, 8, 0] : [8, 8, 0, 0]}
            stackId={stacked ? "1" : undefined}
            maxBarSize={44}
          >
            {colorByIndex && data.map((_, di) => <Cell key={di} fill={CHART_COLORS[di % CHART_COLORS.length]} />)}
          </Bar>
        ))}
      </BarChart>
    </Frame>
  );
}

export interface DonutDatum {
  name: string;
  value: number;
  color?: string;
}

/** Donut chart with optional centre label and legend list. */
export function DonutChart({
  data,
  height = 220,
  className,
  centerLabel,
  centerSub,
  valueFormatter,
  showLegend = true,
  "aria-label": label,
}: {
  data: DonutDatum[];
  height?: number;
  className?: string;
  centerLabel?: React.ReactNode;
  centerSub?: React.ReactNode;
  valueFormatter?: (v: number | string) => React.ReactNode;
  showLegend?: boolean;
  "aria-label"?: string;
}) {
  const total = data.reduce((a, d) => a + d.value, 0);
  return (
    <div className={cn("flex flex-col items-center gap-4 sm:flex-row", className)}>
      <div className="relative w-full max-w-[240px]" style={{ height }} role="img" aria-label={label}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip content={<ChartTooltip formatter={valueFormatter} />} />
            <Pie data={data} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="92%" paddingAngle={3} cornerRadius={6} stroke="none">
              {data.map((d, i) => (
                <Cell key={d.name} fill={d.color ?? CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        {(centerLabel !== undefined || centerSub) && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-display text-2xl font-bold text-slate-900">{centerLabel ?? total}</span>
            {centerSub && <span className="text-xs text-muted-foreground">{centerSub}</span>}
          </div>
        )}
      </div>
      {showLegend && (
        <ul className="w-full flex-1 space-y-2 text-sm">
          {data.map((d, i) => (
            <li key={d.name} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-slate-700">
                <span className="size-2.5 rounded-full" style={{ background: d.color ?? CHART_COLORS[i % CHART_COLORS.length] }} aria-hidden />
                {d.name}
              </span>
              <span className="font-semibold tabular-nums text-slate-900">
                {valueFormatter ? valueFormatter(d.value) : d.value}
                {total > 0 && <span className="ml-1.5 text-xs font-normal text-slate-500">{Math.round((d.value / total) * 100)}%</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Radar chart for competency / skill profiles (values 0-100). */
export function SkillRadarChart({
  data,
  height = 280,
  className,
  color: stroke = "#6366f1",
  "aria-label": label = "Skill profile",
}: {
  data: { subject: string; value: number; benchmark?: number }[];
  height?: number;
  className?: string;
  color?: string;
  "aria-label"?: string;
}) {
  const id = React.useId().replace(/:/g, "");
  const hasBenchmark = data.some((d) => d.benchmark !== undefined);
  return (
    <Frame height={height} className={className} label={label}>
      <RadarChart data={data} outerRadius="72%">
        <defs>
          <linearGradient id={`r${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#6366f1" stopOpacity={0.55} />
            <stop offset="100%" stopColor="#d946ef" stopOpacity={0.35} />
          </linearGradient>
        </defs>
        <PolarGrid stroke="#e2e8f0" />
        <PolarAngleAxis dataKey="subject" tick={{ fill: "#475569", fontSize: 12 }} />
        <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
        <Tooltip content={<ChartTooltip formatter={(v) => `${v}%`} />} />
        {hasBenchmark && <Radar name="Target" dataKey="benchmark" stroke="#f59e0b" strokeDasharray="4 4" fill="none" strokeWidth={2} />}
        <Radar name="Proficiency" dataKey="value" stroke={stroke} strokeWidth={2.5} fill={`url(#r${id})`} dot={{ r: 3, fill: stroke }} />
      </RadarChart>
    </Frame>
  );
}

/** Tiny inline sparkline. */
export function Sparkline({ data, color: stroke = "#6366f1", height = 36, className }: { data: number[]; color?: string; height?: number; className?: string }) {
  const id = React.useId().replace(/:/g, "");
  const rows = data.map((v, i) => ({ i, v }));
  return (
    <div className={cn("w-full", className)} style={{ height }} aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
          <defs>
            <linearGradient id={`s${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.3} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="v" stroke={stroke} strokeWidth={2} fill={`url(#s${id})`} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ------------------------------------------------------------------ Activity heatmap (no Recharts) */

const HEAT = ["bg-slate-100", "bg-violet-200", "bg-violet-400", "bg-fuchsia-500", "bg-rose-500"];

/**
 * GitHub-style activity heatmap. `days` is a list of {day: "YYYY-MM-DD", seconds}.
 * Renders `weeks` columns ending today; missing days count as zero.
 */
export function ActivityHeatmap({
  days,
  weeks = 12,
  className,
  endDate,
}: {
  days: { day: string; seconds: number }[];
  weeks?: number;
  className?: string;
  endDate?: Date;
}) {
  const byDay = new Map(days.map((d) => [d.day, d.seconds]));
  const end = endDate ? new Date(endDate) : new Date();
  end.setHours(0, 0, 0, 0);
  // Align so the last column ends on the end date's weekday (Mon=0 .. Sun=6).
  const endDow = (end.getDay() + 6) % 7;
  const start = new Date(end);
  start.setDate(end.getDate() - (weeks - 1) * 7 - endDow);
  const cols: { date: Date; key: string; seconds: number; future: boolean }[][] = [];
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  for (let w = 0; w < weeks; w++) {
    const col = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(start);
      date.setDate(start.getDate() + w * 7 + d);
      const key = fmt(date);
      col.push({ date, key, seconds: byDay.get(key) ?? 0, future: date > end });
    }
    cols.push(col);
  }
  const level = (s: number) => (s <= 0 ? 0 : s < 600 ? 1 : s < 1800 ? 2 : s < 3600 ? 3 : 4);
  const totalMin = Math.round(days.reduce((a, d) => a + d.seconds, 0) / 60);
  const activeDays = days.filter((d) => d.seconds > 0).length;
  const dayLabels = ["Mon", "", "Wed", "", "Fri", "", "Sun"];
  return (
    <figure className={cn("w-full", className)}>
      <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
        <div className="grid grid-rows-7 gap-1 pt-0 text-2xs text-slate-500" aria-hidden>
          {dayLabels.map((l, i) => (
            <span key={i} className="flex h-3.5 items-center sm:h-4">
              {l}
            </span>
          ))}
        </div>
        <div className="flex flex-1 justify-between gap-1" role="grid" aria-label={`Learning activity over the last ${weeks} weeks`}>
          {cols.map((col, ci) => (
            <div key={ci} className="grid grid-rows-7 gap-1" role="row">
              {col.map((c) => (
                <span
                  key={c.key}
                  role="gridcell"
                  title={c.future ? undefined : `${c.date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}: ${Math.round(c.seconds / 60)} min`}
                  aria-label={c.future ? undefined : `${c.key}: ${Math.round(c.seconds / 60)} minutes`}
                  className={cn("size-3.5 rounded-[4px] sm:size-4", c.future ? "bg-transparent" : HEAT[level(c.seconds)])}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <figcaption className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span>
          <span className="font-semibold text-slate-800">{totalMin.toLocaleString()} min</span> across{" "}
          <span className="font-semibold text-slate-800">{activeDays}</span> active days
        </span>
        <span className="flex items-center gap-1" aria-hidden>
          Less
          {HEAT.map((h) => (
            <span key={h} className={cn("size-3 rounded-[3px]", h)} />
          ))}
          More
        </span>
      </figcaption>
    </figure>
  );
}
