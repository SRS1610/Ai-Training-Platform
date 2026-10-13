import { colorClasses, type CategoryColor } from "@praxis/ui";
import { BookOpen, Dumbbell, Gauge, MonitorPlay, RefreshCcw, ShieldCheck, Sparkles, Trophy } from "lucide-react";
import type { LucideIcon } from "lucide-react";

const STAGES: { label: string; icon: LucideIcon; color: CategoryColor; hint: string }[] = [
  { label: "Learn", icon: BookOpen, color: "indigo", hint: "Bite-size lessons" },
  { label: "Practice", icon: Dumbbell, color: "sky", hint: "Adaptive quizzes" },
  { label: "Simulate", icon: MonitorPlay, color: "violet", hint: "Real work, safely" },
  { label: "Perform", icon: Gauge, color: "emerald", hint: "Scored scenarios" },
  { label: "Assess", icon: ShieldCheck, color: "amber", hint: "Rubrics + AI" },
  { label: "Improve", icon: RefreshCcw, color: "rose", hint: "Personal plan" },
];

const R = 39;

/**
 * Node positions around the ring, rounded once to fixed precision. Raw `Math.cos`/`Math.sin` output is not
 * guaranteed to be bit-identical across JS engines, and full-precision floats in `style` attributes are a classic
 * source of server/client hydration mismatches, so the attribute strings are made deterministic here.
 */
const POSITIONS = STAGES.map((_, i) => {
  const a = ((-90 + i * 60) * Math.PI) / 180;
  return { left: `${(50 + R * Math.cos(a)).toFixed(2)}%`, top: `${(50 + R * Math.sin(a)).toFixed(2)}%` };
});

/** The Learn → Practice → Simulate → Perform → Assess → Improve loop, as an illustration. */
export function LoopVisual() {
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[520px]" role="img" aria-label="The Praxis loop: Learn, Practice, Simulate, Perform, Get assessed, Improve — then repeat.">
      {/* Rings */}
      <svg viewBox="0 0 100 100" className="absolute inset-0 size-full" aria-hidden>
        <defs>
          <linearGradient id="loop-ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#6366f1" />
            <stop offset=".35" stopColor="#0ea5e9" />
            <stop offset=".6" stopColor="#10b981" />
            <stop offset=".8" stopColor="#f59e0b" />
            <stop offset="1" stopColor="#f43f5e" />
          </linearGradient>
          <radialGradient id="loop-core" cx="50%" cy="40%" r="60%">
            <stop offset="0" stopColor="#a78bfa" />
            <stop offset=".6" stopColor="#6366f1" />
            <stop offset="1" stopColor="#4338ca" />
          </radialGradient>
        </defs>
        <circle cx="50" cy="50" r="46" fill="none" stroke="#e0e7ff" strokeWidth=".4" strokeDasharray="1 1.6" />
        <circle cx="50" cy="50" r={R} fill="none" stroke="url(#loop-ring)" strokeWidth="1.1" strokeLinecap="round" strokeDasharray="6 3" opacity=".9" />
        <circle cx="50" cy="50" r="26" fill="#eef2ff" opacity=".7" />
        <g className="origin-center motion-safe:animate-spin-slow">
          <circle cx="50" cy={50 - R} r="1.6" fill="#7c3aed" />
          <circle cx={50 + R} cy="50" r="1.1" fill="#0ea5e9" />
          <circle cx="50" cy={50 + R} r="1.3" fill="#10b981" />
        </g>
        <circle cx="50" cy="50" r="17" fill="url(#loop-core)" />
      </svg>

      {/* Core */}
      <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center text-center text-white">
        <Sparkles className="size-6 text-amber-200" aria-hidden />
        <span className="mt-1 font-display text-sm font-bold leading-tight sm:text-base">Proven</span>
        <span className="font-display text-sm font-bold leading-tight sm:text-base">competence</span>
      </div>

      {/* Stage nodes */}
      {STAGES.map((s, i) => {
        const { left, top } = POSITIONS[i]!;
        const c = colorClasses(s.color);
        const Icon = s.icon;
        return (
          // The centring transform lives on the wrapper: the fade-up keyframes animate `transform` on the inner node and
          // would otherwise replace -translate-x/y-1/2, anchoring each node by its top-left corner instead of its centre.
          <div key={s.label} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left, top }}>
            <div
              className="flex items-center gap-2 rounded-2xl border border-white bg-white/95 py-1.5 pl-1.5 pr-3 shadow-lift backdrop-blur motion-safe:animate-fade-up sm:gap-2.5 sm:py-2 sm:pl-2 sm:pr-4"
              style={{ animationDelay: `${i * 90}ms` }}
            >
              <span className={`grid size-8 place-items-center rounded-xl bg-gradient-to-br text-white sm:size-10 ${c.gradient}`}>
                <Icon className="size-4 sm:size-5" aria-hidden />
              </span>
              <span className="leading-tight">
                <span className="block text-xs font-bold text-slate-900 sm:text-sm">{s.label}</span>
                <span className="hidden text-2xs text-slate-500 sm:block">{s.hint}</span>
              </span>
            </div>
          </div>
        );
      })}

      {/* Floating proof cards */}
      <div className="absolute -left-6 top-[3%] hidden -rotate-2 rounded-2xl border border-slate-100 bg-white p-3 shadow-lift motion-safe:animate-float lg:block" aria-hidden>
        <p className="text-2xs font-semibold uppercase tracking-wider text-slate-500">SOC triage simulation</p>
        <div className="mt-1 flex items-center gap-2">
          <span className="font-display text-xl font-bold text-slate-900">94</span>
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-2xs font-semibold text-emerald-700 ring-1 ring-emerald-200">Expert</span>
        </div>
      </div>
      <div className="absolute -left-[8%] bottom-0 hidden rotate-2 items-center gap-2 rounded-2xl border border-slate-100 bg-white p-3 shadow-lift motion-safe:animate-float lg:flex" style={{ animationDelay: "1.5s" }} aria-hidden>
        <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-amber-400 to-rose-500 text-white">
          <Trophy className="size-4" />
        </span>
        <span>
          <span className="block text-xs font-bold text-slate-900">Certificate earned</span>
          <span className="block text-2xs text-slate-500">Incident Response · Level 2</span>
        </span>
      </div>
    </div>
  );
}
