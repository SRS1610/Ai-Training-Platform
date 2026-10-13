"use client";

import { AccessGate } from "@/components/grading/access-gate";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <AccessGate anyOf={["submissions.review"]} area="grading">
      {children}
    </AccessGate>
  );
}
