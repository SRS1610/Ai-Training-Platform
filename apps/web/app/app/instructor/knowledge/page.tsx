"use client";

import { Skeleton } from "@praxis/ui";
import { Suspense } from "react";
import { KnowledgePage } from "@/components/authoring/knowledge/knowledge-page";

export default function KnowledgeBasePage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-3xl" />}>
      <KnowledgePage />
    </Suspense>
  );
}
