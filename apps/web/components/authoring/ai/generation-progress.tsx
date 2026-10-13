"use client";

import { Alert, Button, cn } from "@praxis/ui";
import { useQuery } from "@tanstack/react-query";
import { motion, useReducedMotion } from "framer-motion";
import { Check, CreditCard, Loader2, Sparkles, WifiOff } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { api, ApiError, errorMessage } from "@/lib/api";
import { ak } from "../keys";
import type { Generation } from "../types";

export const ACTIVE = new Set(["pending", "running"]);

/** Fetch a generation; polls every 1.5s while it is queued / running. */
export function useGeneration(id: string | null | undefined) {
  return useQuery({
    queryKey: ak.generations.detail(id ?? ""),
    enabled: !!id,
    queryFn: ({ signal }) => api.get<Generation>(`/ai/generations/${id}`, { signal }),
    refetchInterval: (q) => (q.state.data && ACTIVE.has(q.state.data.status) ? 1500 : false),
    staleTime: 0,
  });
}

const STEPS: Record<string, string[]> = {
  course: ["Reading your brief", "Designing the learning path", "Writing lessons & examples", "Building quizzes, assignments & rubric", "Final quality & safety checks"],
  default: ["Reading the source material", "Drafting content", "Checking answers & structure"],
};

/** Animated progress for a running generation (time-based estimate; real status from polling). */
export function GenerationProgress({ gen, compact }: { gen: Generation; compact?: boolean }) {
  const reduce = useReducedMotion();
  const steps = STEPS[gen.kind] ?? STEPS.default!;
  const expected = gen.kind === "course" ? 45 : 15; // seconds
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const started = new Date(gen.created_at).getTime();
  const elapsed = Math.max(0, (now - started) / 1000);
  const pct = gen.status === "pending" ? Math.min(8, elapsed * 2) : Math.min(94, 10 + (elapsed / expected) * 84);
  const stepIdx = Math.min(steps.length - 1, Math.floor((pct / 100) * steps.length));

  return (
    <div className={cn("relative overflow-hidden rounded-3xl border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-fuchsia-50", compact ? "p-5" : "p-6 sm:p-10")} role="status" aria-live="polite">
      <div className="pointer-events-none absolute -right-20 -top-20 size-72 rounded-full bg-fuchsia-300/30 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute -bottom-24 -left-10 size-72 rounded-full bg-indigo-300/30 blur-3xl" aria-hidden />
      <div className={cn("relative flex flex-col items-center text-center", compact ? "gap-4" : "gap-6")}>
        <div className="relative grid size-24 place-items-center">
          <motion.span
            className="absolute inset-0 rounded-full bg-brand-gradient opacity-30 blur-xl"
            animate={reduce ? undefined : { scale: [1, 1.25, 1], opacity: [0.25, 0.5, 0.25] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
            aria-hidden
          />
          <motion.span
            className="absolute inset-2 rounded-full border-2 border-dashed border-violet-300"
            animate={reduce ? undefined : { rotate: 360 }}
            transition={{ duration: 12, repeat: Infinity, ease: "linear" }}
            aria-hidden
          />
          <span className="relative grid size-16 place-items-center rounded-2xl bg-brand-gradient text-white shadow-glow">
            <Sparkles className="size-8" aria-hidden />
          </span>
        </div>
        <div>
          <p className="font-display text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            {gen.status === "pending" ? "Queued — starting shortly…" : `Generating your ${gen.kind.replace("_", " ")}…`}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{steps[stepIdx]} · {Math.round(elapsed)}s</p>
        </div>
        <div className="w-full max-w-md">
          <div className="h-2.5 overflow-hidden rounded-full bg-white shadow-inner ring-1 ring-violet-100">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500"
              initial={false}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.6, ease: "easeOut" }}
            />
          </div>
        </div>
        {!compact && (
          <ol className="grid w-full max-w-md gap-2 text-left">
            {steps.map((s, i) => {
              const done = i < stepIdx;
              const cur = i === stepIdx;
              return (
                <li key={s} className={cn("flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors", cur ? "bg-white shadow-sm ring-1 ring-violet-200" : "")}>
                  <span className={cn("grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold", done ? "bg-emerald-500 text-white" : cur ? "bg-violet-600 text-white" : "bg-slate-200 text-slate-500")}>
                    {done ? <Check className="size-3.5" aria-hidden /> : cur ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : i + 1}
                  </span>
                  <span className={cn(done ? "text-slate-500 line-through decoration-slate-300" : cur ? "font-semibold text-slate-900" : "text-slate-500")}>{s}</span>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}

export function OfflineNotice({ className }: { className?: string }) {
  return (
    <Alert tone="warning" icon={<WifiOff aria-hidden />} title="Generated with the offline template provider" className={className}>
      No AI provider is configured for your organisation, so Praxis built a structured starter from templates. It&apos;s a solid
      skeleton to edit — connect a provider in{" "}
      <Link href="/app/admin/ai" className="font-semibold underline underline-offset-2">
        AI settings
      </Link>{" "}
      for richer, topic-specific content.
    </Alert>
  );
}

/** Friendly rendering of generation request errors (plan limits, AI disabled, budget). */
export function GenerationError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const plan = error instanceof ApiError && (error.code === "plan_limit" || error.code === "feature_unavailable");
  return (
    <Alert
      tone={plan ? "brand" : "danger"}
      icon={plan ? <CreditCard aria-hidden /> : undefined}
      title={plan ? "AI course generation isn't included in your plan" : "We couldn't start the generation"}
      action={
        plan ? (
          <Button asChild size="sm" variant="primary">
            <Link href="/app/admin/billing">View plans</Link>
          </Button>
        ) : onRetry ? (
          <Button size="sm" variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        ) : undefined
      }
    >
      {plan ? "Upgrade your plan to draft courses, quizzes, assignments and more with AI." : errorMessage(error)}
    </Alert>
  );
}
