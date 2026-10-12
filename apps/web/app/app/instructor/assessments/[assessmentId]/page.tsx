"use client";

import { Skeleton } from "@praxis/ui";
import { useParams } from "next/navigation";
import { Suspense } from "react";
import { AssessmentBuilder } from "@/components/authoring/assessments/assessment-builder";

export default function AssessmentBuilderPage() {
  const { assessmentId } = useParams<{ assessmentId: string }>();
  return (
    <Suspense fallback={<Skeleton className="h-[600px] rounded-3xl" />}>
      <AssessmentBuilder assessmentId={assessmentId} />
    </Suspense>
  );
}
