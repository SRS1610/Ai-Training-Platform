import { Check } from "lucide-react";
import * as React from "react";
import { cn } from "../lib/cn";

export interface Step {
  label: React.ReactNode;
  description?: React.ReactNode;
}

/** Horizontal (md+) / vertical (mobile) stepper. `current` is 0-based. */
export function Stepper({ steps, current, className }: { steps: Step[]; current: number; className?: string }) {
  return (
    <ol className={cn("flex flex-col gap-4 md:flex-row md:items-start md:gap-0", className)}>
      {steps.map((s, i) => {
        const state = i < current ? "done" : i === current ? "current" : "todo";
        return (
          <li key={i} className="relative flex flex-1 items-start gap-3 md:flex-col md:items-center md:text-center" aria-current={state === "current" ? "step" : undefined}>
            {i < steps.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  "absolute left-4 top-9 h-[calc(100%-1.25rem)] w-0.5 md:left-[calc(50%+1.25rem)] md:top-4 md:h-0.5 md:w-[calc(100%-2.5rem)]",
                  i < current ? "bg-gradient-to-r from-brand-500 to-violet-500" : "bg-slate-200",
                )}
              />
            )}
            <span
              className={cn(
                "relative z-10 grid size-8 shrink-0 place-items-center rounded-full text-sm font-semibold ring-4 ring-white transition-colors",
                state === "done" && "bg-brand-gradient text-white",
                state === "current" && "bg-white text-brand-700 shadow-glow ring-brand-100 outline outline-2 outline-brand-500",
                state === "todo" && "bg-slate-100 text-slate-500",
              )}
            >
              {state === "done" ? <Check className="size-4" strokeWidth={3} aria-hidden /> : i + 1}
            </span>
            <span className="min-w-0 md:mt-2 md:px-2">
              <span className={cn("block text-sm font-semibold", state === "todo" ? "text-slate-500" : "text-slate-900")}>{s.label}</span>
              {s.description && <span className="block text-xs text-muted-foreground">{s.description}</span>}
              <span className="sr-only">{state === "done" ? "(completed)" : state === "current" ? "(current step)" : ""}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
