"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import * as React from "react";
import { Toaster as SonnerToaster, toast } from "sonner";
import { cn } from "../lib/cn";

/* ------------------------------------------------------------------ Skeleton */

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn(
        "relative overflow-hidden rounded-lg bg-slate-200/70 before:absolute before:inset-0 before:-translate-x-full before:animate-shimmer before:bg-gradient-to-r before:from-transparent before:via-white/60 before:to-transparent",
        className,
      )}
      {...props}
    />
  );
}

/* ------------------------------------------------------------------ Alert */

const alertVariants = cva("relative flex gap-3 rounded-2xl border p-4 text-sm [&>svg]:mt-0.5 [&>svg]:size-5 [&>svg]:shrink-0", {
  variants: {
    tone: {
      info: "border-sky-200 bg-sky-50 text-sky-900 [&>svg]:text-sky-600",
      success: "border-emerald-200 bg-emerald-50 text-emerald-900 [&>svg]:text-emerald-600",
      warning: "border-amber-200 bg-amber-50 text-amber-900 [&>svg]:text-amber-600",
      danger: "border-rose-200 bg-rose-50 text-rose-900 [&>svg]:text-rose-600",
      brand: "border-brand-200 bg-brand-50 text-brand-900 [&>svg]:text-brand-600",
    },
  },
  defaultVariants: { tone: "info" },
});

const ICONS = { info: Info, success: CheckCircle2, warning: AlertTriangle, danger: XCircle, brand: Info };

export interface AlertProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title">, VariantProps<typeof alertVariants> {
  title?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}

export function Alert({ className, tone = "info", title, icon, action, children, ...props }: AlertProps) {
  const Icon = ICONS[tone ?? "info"];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn(alertVariants({ tone }), className)} {...props}>
      {icon ?? <Icon aria-hidden />}
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title && "mt-0.5", "opacity-90")}>{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ Toast */

/** Mount once near the root. Use `toast.success("Saved")` etc. anywhere. */
export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      closeButton
      richColors
      toastOptions={{
        classNames: {
          toast: "!rounded-2xl !border !shadow-lift !font-sans",
          title: "!font-semibold",
        },
      }}
    />
  );
}

export { toast };

/* ------------------------------------------------------------------ Kbd / Separator / Spinner */

export function Kbd({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-slate-200 bg-white px-1.5 font-sans text-2xs font-semibold text-slate-600 shadow-[0_1px_0_rgb(15_23_42/0.08)]",
        className,
      )}
      {...props}
    />
  );
}

export function Separator({ className, orientation = "horizontal" }: { className?: string; orientation?: "horizontal" | "vertical" }) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cn("shrink-0 bg-slate-200", orientation === "horizontal" ? "h-px w-full" : "h-full w-px", className)}
    />
  );
}

export function Spinner({ className, label = "Loading" }: { className?: string; label?: string }) {
  return (
    <span role="status" className={cn("inline-flex items-center", className)}>
      <svg className="size-5 animate-spin text-brand-600" viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity=".2" strokeWidth="3" />
        <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <span className="sr-only">{label}</span>
    </span>
  );
}
