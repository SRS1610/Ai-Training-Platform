"use client";

import { Skeleton } from "@praxis/ui";
import { useParams } from "next/navigation";
import { Suspense } from "react";
import { AssessmentBuilder } from "@/components/authoring/assessments/assessment-builder";
import { AUTHORING_PERMS, AuthoringGate } from "@/components/authoring/gate";

export default function AssessmentBuilderPage() {
  const { assessmentId } = useParams<{ assessmentId: string }>();
  return (
    <AuthoringGate anyOf={AUTHORING_PERMS.assessments} area="assessment authoring">
      <Suspense fallback={<Skeleton className="h-[600px] rounded-3xl" />}>
        <AssessmentBuilder assessmentId={assessmentId} />
      </Suspense>
    </AuthoringGate>
  );
}
