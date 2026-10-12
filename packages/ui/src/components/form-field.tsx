"use client";

import { AlertCircle } from "lucide-react";
import * as React from "react";
import { cn } from "../lib/cn";
import { Label } from "./label";

export interface FormFieldProps {
  label?: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: string | null;
  required?: boolean;
  className?: string;
  labelAction?: React.ReactNode;
  /** Render function receives aria props to spread on the control, or pass a single element child. */
  children: React.ReactElement | ((aria: FieldAria) => React.ReactNode);
}

export interface FieldAria {
  id: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  "aria-required"?: boolean;
}

/**
 * Label + control + hint + error with correct aria wiring.
 * A single element child automatically receives `id`, `aria-invalid` and `aria-describedby`.
 */
export function FormField({ label, htmlFor, hint, error, required, className, labelAction, children }: FormFieldProps) {
  const autoId = React.useId();
  const id = htmlFor ?? `f${autoId.replace(/:/g, "")}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  const aria: FieldAria = {
    id,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
    "aria-required": required || undefined,
  };
  const control =
    typeof children === "function"
      ? children(aria)
      : React.cloneElement(children as React.ReactElement<Record<string, unknown>>, aria as unknown as Record<string, unknown>);

  return (
    <div className={cn("space-y-1.5", className)}>
      {(label || labelAction) && (
        <div className="flex items-center justify-between gap-2">
          {label && (
            <Label htmlFor={id} required={required}>
              {label}
            </Label>
          )}
          {labelAction}
        </div>
      )}
      {control}
      {hint && !error && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="flex items-center gap-1.5 text-xs font-medium text-rose-700">
          <AlertCircle className="size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </div>
  );
}
