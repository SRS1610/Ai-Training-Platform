"use client";

import { cn } from "@praxis/ui";
import { Timer } from "lucide-react";

export function formatClock(secs: number) {
  const s = Math.max(0, Math.floor(secs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}

/** Countdown chip: neutral → amber under 5 minutes → rose (pulsing) under 1 minute. */
export function TimerChip({ seconds, total }: { seconds: number; total: number | null }) {
  const critical = seconds <= 60;
  const warn = !critical && seconds <= 300;
  const pct = total ? Math.max(0, Math.min(100, (seconds / total) * 100)) : 100;
  return (
    <div
      role="timer"
      aria-label={`Time remaining ${formatClock(seconds)}`}
      className={cn(
        "relative flex items-center gap-2 overflow-hidden rounded-xl px-3 py-1.5 font-mono text-sm font-bold tabular-nums ring-1 ring-inset transition-colors",
        critical ? "bg-rose-50 text-rose-700 ring-rose-200 motion-safe:animate-pulse" : warn ? "bg-amber-50 text-amber-800 ring-amber-200" : "bg-slate-50 text-slate-800 ring-slate-200",
      )}
    >
      <Timer className="size-4" aria-hidden />
      {formatClock(seconds)}
      <span
        className={cn("absolute bottom-0 left-0 h-0.5 transition-[width] duration-1000", critical ? "bg-rose-500" : warn ? "bg-amber-500" : "bg-brand-500")}
        style={{ width: `${pct}%` }}
        aria-hidden
      />
    </div>
  );
}
