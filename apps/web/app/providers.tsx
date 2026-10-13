"use client";

import { Toaster, TooltipProvider } from "@praxis/ui";
import { QueryClientProvider } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import * as React from "react";
import { makeQueryClient } from "@/lib/query-client";

/** Routes whose pages end in a sticky bottom action bar ("Submit grade"): toasts go top-right, under the topbar. */
const STICKY_ACTION_ROUTES = [/^\/app\/instructor\/grading(\/|$)/];

function AppToaster() {
  const pathname = usePathname() ?? "";
  if (STICKY_ACTION_ROUTES.some((r) => r.test(pathname))) {
    // 64px topbar + 16px gap; on phones keep clear of the topbar and the safe area.
    return <Toaster position="top-right" offset={{ top: 80, right: 24 }} mobileOffset={{ top: "calc(env(safe-area-inset-top, 0px) + 4.5rem)", left: 16, right: 16 }} />;
  }
  return <Toaster />;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(makeQueryClient);
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider delayDuration={250}>
        {children}
        <AppToaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
