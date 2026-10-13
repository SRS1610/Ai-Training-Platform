"use client";

import { Skeleton } from "@praxis/ui";
import { Suspense } from "react";
import { AIBuilder } from "@/components/authoring/ai/ai-builder";
import { AUTHORING_PERMS, AuthoringGate } from "@/components/authoring/gate";

export default function AIBuilderPage() {
  return (
    <AuthoringGate anyOf={AUTHORING_PERMS.aiBuilder} area="the AI Course Builder">
      <Suspense fallback={<Skeleton className="h-96 rounded-3xl" />}>
        <AIBuilder />
      </Suspense>
    </AuthoringGate>
  );
}
