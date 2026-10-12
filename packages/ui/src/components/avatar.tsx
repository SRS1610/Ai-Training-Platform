"use client";

import * as AvatarPrimitive from "@radix-ui/react-avatar";
import * as React from "react";
import { cn } from "../lib/cn";
import { colorClasses, colorFor } from "../lib/colors";

export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

const SIZES = {
  xs: "size-6 text-2xs",
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-12 text-base",
  xl: "size-16 text-lg",
  "2xl": "size-24 text-2xl",
} as const;

export interface AvatarProps {
  name?: string | null;
  src?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
  shape?: "circle" | "rounded";
}

/** Avatar with image + colourful gradient initials fallback (stable colour per name). */
export function Avatar({ name, src, size = "md", className, shape = "circle" }: AvatarProps) {
  const c = colorClasses(colorFor(name ?? ""));
  return (
    <AvatarPrimitive.Root
      className={cn(
        "relative inline-flex shrink-0 select-none overflow-hidden ring-2 ring-white",
        shape === "circle" ? "rounded-full" : "rounded-xl",
        SIZES[size],
        className,
      )}
    >
      {src && <AvatarPrimitive.Image src={src} alt={name ?? ""} className="aspect-square size-full object-cover" />}
      <AvatarPrimitive.Fallback
        delayMs={src ? 400 : 0}
        className={cn("flex size-full items-center justify-center bg-gradient-to-br font-semibold text-white", c.gradient)}
        aria-label={name ?? undefined}
      >
        {initials(name)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}

export function AvatarGroup({ people, max = 4, size = "sm" }: { people: { name: string; src?: string | null }[]; max?: number; size?: keyof typeof SIZES }) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <div className="flex -space-x-2">
      {shown.map((p, i) => (
        <Avatar key={`${p.name}-${i}`} name={p.name} src={p.src} size={size} />
      ))}
      {rest > 0 && (
        <span className={cn("inline-flex items-center justify-center rounded-full bg-slate-100 font-semibold text-slate-700 ring-2 ring-white", SIZES[size])}>
          +{rest}
        </span>
      )}
    </div>
  );
}
