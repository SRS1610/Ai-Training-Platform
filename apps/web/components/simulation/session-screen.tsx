"use client";

import { Button, EmptyState, Skeleton } from "@praxis/ui";
import { Loader2, Sparkles } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { createPortal } from "react-dom";
import { ErrorState } from "@/components/common/error-state";
import { ApiError } from "@/lib/api";
import { SessionResults } from "./results";
import type { StepOut } from "./types";
import { useSimSession, type Pending } from "./workspace/use-sim-session";
import { Workspace } from "./workspace/workspace";

function WorkspaceSkeleton() {
  return (
    <div className="space-y-2 lg:-mx-8 lg:-mt-8" aria-busy aria-label="Loading workspace">
      <Skeleton className="h-14 rounded-none" />
      <div className="flex gap-2 px-2" style={{ height: "calc(100dvh - 9rem)" }}>
        <Skeleton className="hidden w-[300px] rounded-2xl xl:block" />
        <Skeleton className="flex-1 rounded-2xl" />
        <Skeleton className="hidden w-[380px] rounded-2xl lg:block" />
      </div>
    </div>
  );
}

function CompletionOverlay() {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div role="status" aria-live="assertive" className="fixed inset-0 z-[60] grid place-items-center bg-white/80 p-6 backdrop-blur-md motion-safe:animate-fade-in">
      <div className="text-center">
        <span className="mx-auto grid size-20 place-items-center rounded-3xl bg-brand-gradient text-white shadow-glow motion-safe:animate-float">
          <Sparkles className="size-9" aria-hidden />
        </span>
        <p className="mt-6 text-xs font-semibold uppercase tracking-wider text-brand-700">Simulation complete</p>
        <h2 className="mt-1 font-display text-2xl font-bold text-slate-900">Scoring your performance…</h2>
        <p className="mt-2 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Preparing your debrief and replay
        </p>
      </div>
    </div>,
    document.body,
  );
}

export function SessionScreen({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [fresh] = React.useState(() => params.get("fresh") === "1");
  const handler = React.useRef<((s: StepOut, p: Pending) => void) | null>(null);
  const { query, session, pending, act, chat } = useSimSession(sessionId, (s, p) => handler.current?.(s, p));
  const register = React.useCallback((fn: (s: StepOut, p: Pending) => void) => {
    handler.current = fn;
  }, []);
  const [completing, setCompleting] = React.useState(false);
  const wasActive = React.useRef<boolean | null>(null);

  React.useEffect(() => {
    if (fresh) router.replace(pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const status = session?.status;
  React.useEffect(() => {
    if (!status) return;
    const activeNow = status === "active";
    if (wasActive.current === true && !activeNow) setCompleting(true);
    wasActive.current = activeNow;
  }, [status]);
  React.useEffect(() => {
    if (!completing) return;
    const t = setTimeout(() => setCompleting(false), 2200);
    return () => clearTimeout(t);
  }, [completing]);

  if (query.isError) {
    if (query.error instanceof ApiError && query.error.status === 404)
      return (
        <EmptyState
          size="lg"
          illustration="search"
          title="Session not found"
          description="This simulation session doesn't exist or belongs to someone else."
          action={
            <Button asChild variant="secondary">
              <Link href="/app/simulations">Back to simulations</Link>
            </Button>
          }
        />
      );
    return <ErrorState error={query.error} onRetry={() => query.refetch()} size="lg" />;
  }
  if (!session) return <WorkspaceSkeleton />;

  if (session.status !== "active" && !completing) return <SessionResults session={session} />;

  return (
    <>
      <Workspace session={session} pending={pending} act={act} chat={chat} registerStepHandler={register} fresh={fresh} />
      {completing && <CompletionOverlay />}
    </>
  );
}
