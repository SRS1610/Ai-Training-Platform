"use client";

import * as React from "react";
import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip } from "recharts";

export interface RadarDatum {
  subject: string;
  value: number;
  benchmark?: number;
}

/** Split a skill name into at most two lines of ~`max` chars, ellipsising only what still doesn't fit. */
function wrap(text: string, max = 14): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + " " + w).length <= max) cur += " " + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length <= 2) return lines.map((l) => (l.length > max + 2 ? `${l.slice(0, max)}…` : l));
  const second = lines.slice(1).join(" ");
  return [lines[0]!, second.length > max ? `${second.slice(0, max - 1)}…` : second];
}

interface TickProps {
  x?: number | string;
  y?: number | string;
  cy?: number;
  textAnchor?: "start" | "middle" | "end" | "inherit";
  payload?: { value?: string };
}

function WrappedTick({ x = 0, y = 0, cy = 0, textAnchor = "middle", payload, compact }: TickProps & { compact?: boolean }) {
  const label = String(payload?.value ?? "");
  const lines = wrap(label, compact ? 11 : 14);
  const nx = Number(x);
  const ny = Number(y);
  const lh = 13;
  // Labels above the centre grow upwards, below grow downwards, beside are vertically centred.
  const dy = ny < cy - 4 ? -(lines.length - 1) * lh : ny > cy + 4 ? 4 : -((lines.length - 1) * lh) / 2 + 4;
  return (
    <text x={nx} y={ny + dy} textAnchor={textAnchor} fill="#475569" fontSize={compact ? 10 : 11} fontWeight={500}>
      <title>{label}</title>
      {lines.map((l, i) => (
        <tspan key={i} x={nx} dy={i === 0 ? 0 : lh}>
          {l}
        </tspan>
      ))}
    </text>
  );
}

function RadarTip({ active, payload }: { active?: boolean; payload?: { name?: string; value?: number; payload?: RadarDatum }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-lift">
      <p className="font-semibold text-slate-900">{d?.subject}</p>
      <p className="mt-0.5 tabular-nums text-slate-600">
        Proficiency <strong className="text-indigo-700">{d?.value}%</strong>
        {d?.benchmark !== undefined ? <> · target {d.benchmark}%</> : null}
      </p>
    </div>
  );
}

/**
 * Skill-profile radar with full, wrapped axis labels (the shared chart abbreviates them) and an
 * initial size so Recharts never measures a 0×0 container on first paint.
 */
export function SkillRadar({ data, height = 340, label }: { data: RadarDatum[]; height?: number; label: string }) {
  const id = React.useId().replace(/:/g, "");
  const hasBenchmark = data.some((d) => d.benchmark !== undefined);
  // Phones: smaller radius, tighter wrapping and more side margin so edge labels never clip.
  const ref = React.useRef<HTMLDivElement>(null);
  const [compact, setCompact] = React.useState(false);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setCompact((e?.contentRect.width ?? 999) < 440));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className="w-full" style={{ height }} role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%" minWidth={200} initialDimension={{ width: 360, height }}>
        <RadarChart data={data} outerRadius={compact ? "56%" : "62%"} margin={compact ? { top: 16, right: 44, bottom: 16, left: 44 } : { top: 18, right: 36, bottom: 18, left: 36 }}>
          <defs>
            <linearGradient id={`sr${id}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#6366f1" stopOpacity={0.55} />
              <stop offset="100%" stopColor="#d946ef" stopOpacity={0.35} />
            </linearGradient>
          </defs>
          <PolarGrid stroke="#e2e8f0" />
          <PolarAngleAxis dataKey="subject" tick={(p: TickProps) => <WrappedTick {...p} compact={compact} />} />
          <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
          <Tooltip content={<RadarTip />} />
          {hasBenchmark && <Radar name="Target" dataKey="benchmark" stroke="#f59e0b" strokeDasharray="4 4" fill="none" strokeWidth={2} isAnimationActive={false} />}
          <Radar name="Proficiency" dataKey="value" stroke="#6366f1" strokeWidth={2.5} fill={`url(#sr${id})`} dot={{ r: 3, fill: "#6366f1" }} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Dependency-free inline sparkline (no ResponsiveContainer, so no 0-size warnings when hidden). */
export function MiniSparkline({ data, color, height = 30 }: { data: number[]; color: string; height?: number }) {
  const id = React.useId().replace(/:/g, "");
  if (data.length < 2) return null;
  const w = 100;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, height - 3 - ((v - min) / span) * (height - 6)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="block w-full" style={{ height }} aria-hidden>
      <defs>
        <linearGradient id={`ms${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.3} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={`${line} L${w},${height} L0,${height} Z`} fill={`url(#ms${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
