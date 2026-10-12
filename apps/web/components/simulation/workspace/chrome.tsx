"use client";

import { cn, colorClasses, Tooltip } from "@praxis/ui";
import { AlertTriangle, Check, Frown, Meh, Smile, Timer } from "lucide-react";
import * as React from "react";
import type { PhaseItem, Problem, SessionView, ViewCharacter } from "../types";
import { CharacterAvatar } from "./chat-panel";
import { patienceTone, simClock, statusVariables } from "./model";

/* ------------------------------------------------------------------ phase stepper */

export function PhaseStepper({ phases, className }: { phases: PhaseItem[]; className?: string }) {
  const ref = React.useRef<HTMLOListElement>(null);
  const current = phases.find((p) => p.status === "current")?.id;
  React.useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>("[aria-current=step]");
    el?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [current]);
  return (
    <ol ref={ref} className={cn("no-scrollbar flex items-center overflow-x-auto", className)} aria-label="Scenario phases">
      {phases.map((p, i) => (
        <li key={p.id} className="flex shrink-0 items-center" aria-current={p.status === "current" ? "step" : undefined}>
          {i > 0 && <span className={cn("mx-1 h-0.5 w-3 rounded-full transition-colors duration-700 sm:w-5", p.status === "upcoming" ? "bg-slate-200" : "bg-gradient-to-r from-brand-500 to-violet-500")} aria-hidden />}
          <span
            className={cn(
              "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold transition-all duration-500",
              p.status === "done" && "bg-brand-50 text-brand-800 ring-1 ring-inset ring-brand-100",
              p.status === "current" && "bg-brand-gradient text-white shadow-glow",
              p.status === "upcoming" && "text-slate-500",
            )}
          >
            {p.status === "done" ? (
              <span className="grid size-4 place-items-center rounded-full bg-brand-600 text-white">
                <Check className="size-2.5" strokeWidth={3.5} aria-hidden />
              </span>
            ) : (
              <span className={cn("grid size-4 place-items-center rounded-full text-[10px]", p.status === "current" ? "bg-white/25" : "bg-slate-100")}>{i + 1}</span>
            )}
            {p.name}
            <span className="sr-only">{p.status === "done" ? "(done)" : p.status === "current" ? "(current)" : "(upcoming)"}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------------ sim clock */

export function SimClock({ minutes, target }: { minutes: number; target: number | null }) {
  const ratio = target ? minutes / target : 0;
  const tone = !target ? "slate" : ratio < 0.75 ? "emerald" : ratio <= 1 ? "amber" : "rose";
  const ring = { slate: "#94a3b8", emerald: "#10b981", amber: "#f59e0b", rose: "#f43f5e" }[tone];
  const pct = Math.min(1, ratio);
  const r = 9;
  const circ = 2 * Math.PI * r;
  return (
    <Tooltip content={target ? `Simulated time used: ${simClock(minutes)} of a ${target}-minute target. Time only moves when you act.` : "Simulated time. It only moves when you act."}>
      <button type="button" className="flex cursor-default items-center gap-2 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 focus-visible:focus-ring" aria-label={`Simulated time ${simClock(minutes)}${target ? ` of ${target} minutes target` : ""}`}>
        <svg width="22" height="22" viewBox="0 0 22 22" className="-rotate-90" aria-hidden>
          <circle cx="11" cy="11" r={r} fill="none" stroke="#eef2f7" strokeWidth="3" />
          {target ? <circle cx="11" cy="11" r={r} fill="none" stroke={ring} strokeWidth="3" strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ - pct * circ} className="transition-[stroke-dashoffset] duration-700" /> : null}
        </svg>
        <span className="font-mono text-sm font-semibold tabular-nums text-slate-900">{simClock(minutes)}</span>
        {target ? <span className="hidden font-mono text-xs text-slate-500 sm:inline">/ {target}:00</span> : <Timer className="size-3.5 text-slate-400" aria-hidden />}
      </button>
    </Tooltip>
  );
}

/* ------------------------------------------------------------------ patience / mood meter */

export function PatienceMeter({ character, compact }: { character: ViewCharacter; compact?: boolean }) {
  const p = Math.round(character.patience ?? 0);
  const tone = patienceTone(p);
  const c = colorClasses(tone.color);
  const Face = p >= 70 ? Smile : p >= 45 ? Meh : Frown;
  const prev = React.useRef(p);
  const [flash, setFlash] = React.useState<"down" | "up" | null>(null);
  React.useEffect(() => {
    if (p !== prev.current) {
      setFlash(p < prev.current ? "down" : "up");
      prev.current = p;
      const t = setTimeout(() => setFlash(null), 1200);
      return () => clearTimeout(t);
    }
  }, [p]);
  return (
    <Tooltip content={`${character.name}'s patience: ${p}% (${tone.label.toLowerCase()}). Keep them informed and avoid wasting their time.`}>
      <button
        type="button"
        aria-label={`${character.name}: patience ${p}% (${tone.label})`}
        className={cn(
          "flex cursor-default items-center gap-2 rounded-xl border bg-white px-2 py-1.5 transition-colors focus-visible:focus-ring",
          flash === "down" ? "border-rose-300 bg-rose-50" : flash === "up" ? "border-emerald-300 bg-emerald-50" : "border-slate-200",
        )}
      >
        <CharacterAvatar c={character} size="sm" className="size-6 text-[9px]" />
        {!compact && (
          <div className="w-[5.5rem]">
            <div className="flex items-center justify-between text-2xs">
              <span className={cn("truncate font-semibold", c.text)}>{tone.label}</span>
              <span className="tabular-nums text-slate-500">{p}%</span>
            </div>
            <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className={cn("h-full rounded-full transition-all duration-700", c.solid)} style={{ width: `${p}%` }} />
            </div>
          </div>
        )}
        <Face className={cn("size-4", c.icon, flash === "down" && "motion-safe:animate-bounce")} aria-hidden />
      </button>
    </Tooltip>
  );
}

/* ------------------------------------------------------------------ status chips */

export function StatusChips({ view, className }: { view: SessionView; className?: string }) {
  const vars = statusVariables(view);
  if (!vars.length) return null;
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      {vars.map((v) => (
        <span key={v.key} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs">
          <span className="text-slate-500">{v.label}</span>
          <span className={cn("font-semibold", /resolv|clos|contain|done/i.test(v.value) ? "text-emerald-700" : /progress|investig/i.test(v.value) ? "text-sky-700" : "text-slate-900")}>{v.value}</span>
        </span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ problems */

const SEVERITY: Record<string, string> = {
  critical: "border-rose-300 bg-rose-50 text-rose-900",
  high: "border-rose-200 bg-rose-50 text-rose-900",
  medium: "border-amber-200 bg-amber-50 text-amber-900",
  low: "border-sky-200 bg-sky-50 text-sky-900",
};

export function ProblemsList({ problems, className }: { problems: Problem[]; className?: string }) {
  if (!problems.length) return null;
  return (
    <ul className={cn("space-y-2", className)} aria-label="Open problems">
      {problems.map((p) => (
        <li key={p.id} className={cn("flex items-start gap-2.5 rounded-xl border px-3 py-2 text-sm motion-safe:animate-fade-up", SEVERITY[p.severity] ?? SEVERITY.medium)}>
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            <span className="block text-2xs font-bold uppercase tracking-wider opacity-80">{p.severity} priority problem</span>
            {p.text}
          </span>
        </li>
      ))}
    </ul>
  );
}
