"use client";

import { Button, EmptyState } from "@praxis/ui";
import { RefreshCw } from "lucide-react";
import { ApiError, errorMessage } from "@/lib/api";

/** Standard error block for failed queries. */
export function ErrorState({
  error,
  onRetry,
  title,
  className,
  size = "md",
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const forbidden = error instanceof ApiError && error.status === 403;
  return (
    <EmptyState
      className={className}
      size={size}
      illustration={forbidden ? "shield" : "error"}
      title={title ?? (forbidden ? "You don't have access to this" : "We couldn't load this")}
      description={
        <>
          {errorMessage(error)}
          {error instanceof ApiError && error.requestId && (
            <span className="mt-1 block font-mono text-2xs text-slate-400">Ref: {error.requestId}</span>
          )}
        </>
      }
      action={
        onRetry && !forbidden ? (
          <Button variant="secondary" leftIcon={<RefreshCw />} onClick={onRetry}>
            Try again
          </Button>
        ) : undefined
      }
    />
  );
}

/** True when an optional, concurrently-built endpoint is simply not deployed yet. */
export function isNotDeployed(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 404 || err.status === 405 || err.status === 501);
}
