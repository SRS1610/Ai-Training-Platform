"use client";

import { Badge, BandChip, cn, colorClasses } from "@praxis/ui";
import { ArrowRight, CircleDot, Clock, GraduationCap, PlayCircle, RotateCcw, Trophy } from "lucide-react";
import Link from "next/link";
import type { AttemptStats } from "./queries";
import { difficultyMeta, EnvironmentIllustration, environmentLabel, industryMeta } from "./theme";
import type { Simulation } from "./types";

export function DifficultyMeter({ difficulty, className }: { difficulty: string; className?: string }) {
  const d = difficultyMeta(difficulty);
  const c = colorClasses(d.color);
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium text-slate-600", className)}>
      <span className="flex items-end gap-0.5" aria-hidden>
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={cn("w-1 rounded-full", i <= d.level ? c.solid : "bg-slate-200")} style={{ height: 4 + i * 2.5 }} />
        ))}
      </span>
      {d.label}
    </span>
  );
}

export function SimulationCard({ sim, stats, className }: { sim: Simulation; stats?: AttemptStats; className?: string }) {
  const ind = industryMeta(sim.industry);
  const IndIcon = ind.icon;
  const used = stats?.attempts ?? 0;
  const remaining = sim.max_attempts ? Math.max(0, sim.max_attempts - used) : null;
  const cta = stats?.active ? "Resume" : used > 0 ? "Try again" : "Start";
  const CtaIcon = stats?.active ? PlayCircle : used > 0 ? RotateCcw : ArrowRight;
  return (
    <Link
      href={`/app/simulations/${sim.id}`}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-soft transition-all duration-200 ease-spring hover:-translate-y-0.5 hover:shadow-lift focus-visible:focus-ring",
        className,
      )}
    >
      <div className="relative">
        <EnvironmentIllustration environment={sim.environment_type} industry={sim.industry} className="h-40 w-full" />
        <div className={cn("absolute inset-x-0 top-0 h-1 bg-gradient-to-r", ind.classes.gradient)} aria-hidden />
        <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
          <span className={cn("inline-flex items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-1 text-xs font-semibold shadow-sm ring-1 backdrop-blur", ind.classes.text, ind.classes.ring)}>
            <IndIcon className="size-3.5" aria-hidden />
            {ind.label}
          </span>
        </div>
        {stats?.active && (
          <span className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white shadow-sm">
            <CircleDot className="size-3.5 motion-safe:animate-pulse" aria-hidden />
            In progress
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{environmentLabel(sim.environment_type)}</p>
          <DifficultyMeter difficulty={sim.difficulty} />
        </div>
        <div>
          <h3 className="font-display text-lg font-semibold leading-snug tracking-tight text-slate-900 group-hover:text-brand-700">{sim.title}</h3>
          <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">{sim.description}</p>
        </div>
        <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-600">
          <span className="inline-flex items-center gap-1.5">
            <Clock className="size-3.5 text-slate-400" aria-hidden />~{sim.estimated_minutes} min
          </span>
          <span className="inline-flex items-center gap-1.5">
            <GraduationCap className="size-3.5 text-slate-400" aria-hidden />
            {sim.is_graded ? "Graded" : "Practice"}
          </span>
          <span className="inline-flex items-center gap-1.5 tabular-nums">
            <RotateCcw className="size-3.5 text-slate-400" aria-hidden />
            {used} {used === 1 ? "attempt" : "attempts"}
            {sim.max_attempts ? ` of ${sim.max_attempts}` : ""}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
          {stats?.best?.band ? (
            <span className="inline-flex items-center gap-2 text-xs text-slate-600">
              <Trophy className="size-3.5 text-amber-500" aria-hidden />
              Best
              <BandChip band={stats.best.band} size="sm" />
              <span className="font-semibold tabular-nums text-slate-900">{Math.round(stats.best.total_score ?? 0)}</span>
            </span>
          ) : remaining === 0 ? (
            <Badge tone="danger" size="sm">
              No attempts left
            </Badge>
          ) : (
            <span className="text-xs text-slate-500">Not attempted yet</span>
          )}
          <span className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700">
            {cta}
            <CtaIcon className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </span>
        </div>
      </div>
    </Link>
  );
}
