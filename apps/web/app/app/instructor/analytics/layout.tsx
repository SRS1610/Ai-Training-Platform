"use client";

import { AccessGate } from "@/components/grading/access-gate";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <AccessGate anyOf={["analytics.view"]} area="instructor analytics">
      {children}
    </AccessGate>
  );
}
