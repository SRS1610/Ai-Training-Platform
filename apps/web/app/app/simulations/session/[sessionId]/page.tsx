"use client";

import { Skeleton } from "@praxis/ui";
import { Suspense, use } from "react";
import { SessionScreen } from "@/components/simulation/session-screen";

export default function SimulationSessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params);
  return (
    <Suspense fallback={<Skeleton className="h-[70dvh] rounded-3xl" />}>
      <SessionScreen sessionId={sessionId} />
    </Suspense>
  );
}
