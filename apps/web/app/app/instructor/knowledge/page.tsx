"use client";

import { Skeleton } from "@praxis/ui";
import { Suspense } from "react";
import { KnowledgePage } from "@/components/authoring/knowledge/knowledge-page";
import { AUTHORING_PERMS, AuthoringGate } from "@/components/authoring/gate";

export default function KnowledgeBasePage() {
  return (
    <AuthoringGate anyOf={AUTHORING_PERMS.knowledge} area="the knowledge base">
      <Suspense fallback={<Skeleton className="h-96 rounded-3xl" />}>
        <KnowledgePage />
      </Suspense>
    </AuthoringGate>
  );
}
