"use client";

import { cn } from "@praxis/ui";
import { Check, Loader2 } from "lucide-react";
import * as React from "react";
import { createPortal } from "react-dom";
import { EnvironmentIllustration, environmentLabel } from "./theme";

/**
 * Full-screen "entering the environment" transition shown while a session starts.
 * Purely presentational: the parent navigates when the API call resolves; `ready` ticks the last step.
 */
export function EnteringEnvironment({
  open,
  title,
  environment,
  industry,
  ready,
}: {
  open: boolean;
  title: string;
  environment: string | null | undefined;
  industry?: string | null;
  ready?: boolean;
}) {
  const steps = React.useMemo(
    () => [`Preparing the ${environmentLabel(environment).toLowerCase()}`, "Loading your tools and records", "Connecting you with the people involved"],
    [environment],
  );
  const [step, setStep] = React.useState(0);
  React.useEffect(() => {
    if (!open) {
      setStep(0);
      return;
    }
    const t = setInterval(() => setStep((s) => Math.min(s + 1, steps.length - 1)), 420);
    return () => clearInterval(t);
  }, [open, steps.length]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[60] grid place-items-center bg-gradient-to-br from-indigo-50 via-white to-fuchsia-50 p-6 motion-safe:animate-fade-in"
    >
      <div className="pointer-events-none absolute inset-0 bg-grid-faint opacity-60" aria-hidden />
      <div className="relative w-full max-w-md text-center">
        <div className="mx-auto w-64 overflow-hidden rounded-3xl border border-white shadow-lift ring-1 ring-slate-200/70 motion-safe:animate-float">
          <EnvironmentIllustration environment={environment} industry={industry} className="h-40 w-full" />
        </div>
        <p className="mt-8 text-xs font-semibold uppercase tracking-wider text-brand-700">Entering environment</p>
        <h2 className="mt-1 font-display text-2xl font-bold tracking-tight text-slate-900">{title}</h2>
        <ol className="mx-auto mt-6 max-w-xs space-y-2.5 text-left">
          {steps.map((s, i) => {
            const done = ready || i < step;
            const current = i === step && !done;
            return (
              <li key={s} className={cn("flex items-center gap-3 text-sm transition-opacity", i > step && !ready ? "opacity-40" : "opacity-100")}>
                <span
                  className={cn(
                    "grid size-6 shrink-0 place-items-center rounded-full",
                    done ? "bg-emerald-500 text-white" : current ? "bg-brand-100 text-brand-700" : "bg-slate-100 text-slate-400",
                  )}
                >
                  {done ? <Check className="size-3.5" strokeWidth={3} aria-hidden /> : current ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
                </span>
                <span className={cn(done || current ? "text-slate-800" : "text-slate-500")}>{s}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>,
    document.body,
  );
}
