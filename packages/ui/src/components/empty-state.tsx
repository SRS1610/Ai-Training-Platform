import * as React from "react";
import { cn } from "../lib/cn";
import { illustrations, type IllustrationName } from "../illustrations";

export interface EmptyStateProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  illustration?: IllustrationName | React.ReactNode;
  action?: React.ReactNode;
  secondaryAction?: React.ReactNode;
  className?: string;
  size?: "sm" | "md" | "lg";
  /** Render inside a dashed, tinted panel. */
  bordered?: boolean;
}

export function EmptyState({
  title,
  description,
  illustration = "learning",
  action,
  secondaryAction,
  className,
  size = "md",
  bordered,
}: EmptyStateProps) {
  const art =
    typeof illustration === "string" && illustration in illustrations
      ? React.createElement(illustrations[illustration as IllustrationName], {
          className: cn("h-auto", size === "sm" ? "w-28" : size === "lg" ? "w-56" : "w-40"),
        })
      : illustration;
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        size === "sm" ? "gap-2 py-6" : size === "lg" ? "gap-4 py-16" : "gap-3 py-10",
        bordered && "rounded-2xl border border-dashed border-slate-300 bg-gradient-to-b from-slate-50 to-white px-6",
        className,
      )}
    >
      {art}
      <div className="max-w-md">
        <h3 className={cn("font-display font-semibold tracking-tight text-slate-900", size === "lg" ? "text-xl" : "text-base")}>
          {title}
        </h3>
        {description && <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {(action || secondaryAction) && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}
