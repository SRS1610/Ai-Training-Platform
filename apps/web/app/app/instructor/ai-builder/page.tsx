"use client";

import { Skeleton } from "@praxis/ui";
import { Suspense } from "react";
import { AIBuilder } from "@/components/authoring/ai/ai-builder";

export default function AIBuilderPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-3xl" />}>
      <AIBuilder />
    </Suspense>
  );
}
