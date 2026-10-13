"use client";

import { TabsList, cn } from "@praxis/ui";
import * as React from "react";

/**
 * A horizontally scrollable pill TabsList that keeps the active tab in view (deep links on phones) and shows
 * soft edge fades when more tabs are hidden to either side.
 */
export function ScrollTabsList({ active, className, children, ...props }: React.ComponentPropsWithoutRef<typeof TabsList> & { active: string }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [edges, setEdges] = React.useState({ left: false, right: false });

  const measure = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEdges({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
  }, []);

  React.useEffect(() => {
    const el = ref.current;
    const tab = el?.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
    if (el && tab) {
      const target = tab.offsetLeft - (el.clientWidth - tab.offsetWidth) / 2;
      el.scrollTo({ left: Math.max(0, target), behavior: "auto" });
    }
    measure();
  }, [active, measure]);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  return (
    <div className="relative max-w-full">
      <TabsList ref={ref} onScroll={measure} className={cn("w-full sm:w-auto", className)} {...props}>
        {children}
      </TabsList>
      <span
        aria-hidden
        className={cn("pointer-events-none absolute inset-y-0 left-0 w-8 rounded-l-xl bg-gradient-to-r from-slate-100 to-transparent transition-opacity", edges.left ? "opacity-100" : "opacity-0")}
      />
      <span
        aria-hidden
        className={cn("pointer-events-none absolute inset-y-0 right-0 w-8 rounded-r-xl bg-gradient-to-l from-slate-100 to-transparent transition-opacity", edges.right ? "opacity-100" : "opacity-0")}
      />
    </div>
  );
}
