"use client";

import { Skeleton } from "@praxis/ui";
import { useParams } from "next/navigation";
import { Suspense } from "react";
import { CourseBuilder } from "@/components/authoring/course/builder";
import { AUTHORING_PERMS, AuthoringGate } from "@/components/authoring/gate";

export default function CourseBuilderPage() {
  const { courseId } = useParams<{ courseId: string }>();
  return (
    <AuthoringGate anyOf={AUTHORING_PERMS.courses} area="the course builder">
      <Suspense fallback={<Skeleton className="h-[600px] rounded-3xl" />}>
        <CourseBuilder courseId={courseId} />
      </Suspense>
    </AuthoringGate>
  );
}
