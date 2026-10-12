"use client";

import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as React from "react";
import { cn } from "../lib/cn";

export const Tabs = TabsPrimitive.Root;

/** `variant="pill"` (segmented, default) or `variant="underline"`. */
export const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & { variant?: "pill" | "underline" }
>(({ className, variant = "pill", ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    data-variant={variant}
    className={cn(
      "group/tabs no-scrollbar inline-flex max-w-full items-center overflow-x-auto",
      variant === "pill" ? "gap-1 rounded-xl bg-slate-100 p-1" : "w-full gap-6 border-b border-slate-200",
      className,
    )}
    {...props}
  />
));
TabsList.displayName = "TabsList";

export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium text-slate-600 transition-all focus-visible:focus-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4",
      "group-data-[variant=pill]/tabs:rounded-lg group-data-[variant=pill]/tabs:px-3 group-data-[variant=pill]/tabs:py-1.5 group-data-[variant=pill]/tabs:hover:text-slate-900 group-data-[variant=pill]/tabs:data-[state=active]:bg-white group-data-[variant=pill]/tabs:data-[state=active]:text-slate-900 group-data-[variant=pill]/tabs:data-[state=active]:shadow-sm",
      "group-data-[variant=underline]/tabs:-mb-px group-data-[variant=underline]/tabs:border-b-2 group-data-[variant=underline]/tabs:border-transparent group-data-[variant=underline]/tabs:pb-3 group-data-[variant=underline]/tabs:pt-1 group-data-[variant=underline]/tabs:hover:text-slate-900 group-data-[variant=underline]/tabs:data-[state=active]:border-brand-600 group-data-[variant=underline]/tabs:data-[state=active]:text-brand-700",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = "TabsTrigger";

export const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content ref={ref} className={cn("mt-5 focus-visible:outline-none data-[state=active]:animate-fade-in", className)} {...props} />
));
TabsContent.displayName = "TabsContent";
